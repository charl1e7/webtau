use crate::consts;
use anyhow::{Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{
    Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};
use std::io::Cursor;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

fn resample_audio(audio: Vec<f64>, in_fs: u32, out_fs: u32) -> Result<Vec<f64>> {
    let in_samples = audio.len();
    let resample_ratio = out_fs as f64 / in_fs as f64;

    let audio_f32: Vec<f32> = audio.iter().map(|&x| x as f32).collect();

    let params = SincInterpolationParameters {
        sinc_len: 64,                                
        f_cutoff: Some(0.95),
        oversampling_factor: 64,
        interpolation: SincInterpolationType::Linear,
        window: WindowFunction::Hann,
    };

    let mut resampler = Async::<f32>::new_sinc(
        resample_ratio,
        2.0,
        &params,
        1024,
        1,
        FixedAsync::Input,
    )
    .context("failed to create resampler")?;

    let input_adapter = InterleavedSlice::new(&audio_f32, 1, in_samples)
        .map_err(|e| anyhow::anyhow!("failed to wrap input audio buffer: {e}"))?;

    let resampled = resampler
        .process_all(&input_adapter, in_samples, None)
        .context("failed to resample audio")?;

    let data_f32 = resampled.take_data();

    Ok(data_f32.into_iter().map(|x| x as f64).collect())
}

pub fn read_audio(audio_data: &[u8]) -> Result<Vec<f64>> {
    let source = Box::new(Cursor::new(audio_data));
    let mss = MediaSourceStream::new(source, Default::default());


    let hint = Hint::new();

    let fmt_opts: FormatOptions = Default::default();
    let meta_opts: MetadataOptions = Default::default();
    let dec_opts: AudioDecoderOptions = Default::default();

    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, fmt_opts, meta_opts)
        .context("failed to probe audio format")?;

    let track = format
        .default_track(TrackType::Audio)
        .context("no audio track found")?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(
            track
                .codec_params
                .as_ref()
                .context("missing codec parameters")?
                .audio()
                .context("not an audio codec")?,
            &dec_opts,
        )
        .context("unsupported codec")?;

    let mut audio: Vec<f64> = Vec::new();
    let mut channels = 1usize;
    let mut fs = 1u32;
    let mut interleaved: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(Error::ResetRequired) => break,
            Err(_) => break,
        };

        if packet.track_id != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = audio_buf.spec();
                channels = spec.channels().count();
                fs = spec.rate();

                let n = audio_buf.samples_interleaved();
                interleaved.resize(n, 0.0);
                audio_buf.copy_to_slice_interleaved(&mut interleaved);

                let frames = interleaved.len() / channels;

                audio.reserve(frames);

                if channels == 1 {
                    audio.extend(interleaved.iter().map(|&s| s as f64));
                } else {
                    let inv_channels = 1.0 / channels as f64;
                    for s in 0..frames {
                        let mut a = 0.0f64;
                        let offset = s * channels;
                        for c in 0..channels {
                            a += interleaved[offset + c] as f64;
                        }
                        audio.push(a * inv_channels);
                    }
                }
            }
            Err(Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }

    if fs == consts::SAMPLE_RATE {
        Ok(audio)
    } else {
        resample_audio(audio, fs, consts::SAMPLE_RATE)
    }
}

pub fn write_audio(audio: &[f64]) -> Result<Vec<u8>> {
    let out_spec = WavSpec {
        channels: 1,
        sample_rate: consts::SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };

    let expected_bytes = 44 + audio.len() * 2;
    let mut cursor = Cursor::new(Vec::with_capacity(expected_bytes));
    let mut writer = WavWriter::new(&mut cursor, out_spec)?;

    let mut error = 0.0;
    for &sample in audio {
        let scaled = (sample * i16::MAX as f64).clamp(i16::MIN as f64, i16::MAX as f64) + error;
        let quantized = scaled.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16;
        error = scaled - quantized as f64;
        writer.write_sample(quantized)?;
    }

    writer.finalize()?;
    Ok(cursor.into_inner())
}