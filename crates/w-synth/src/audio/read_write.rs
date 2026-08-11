use crate::consts;
use anyhow::{Context, Result};
use hound::{SampleFormat, WavSpec, WavWriter};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};
use std::io::Cursor;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

fn resample_audio(audio: Vec<f64>, in_fs: u32, out_fs: u32) -> Result<Vec<f64>> {
    let in_samples = audio.len();
    let mut resampler = Fft::<f64>::new(in_fs as usize, out_fs as usize, 1024, 1, FixedSync::Both)
        .context("failed to create resampler")?;

    let input_adapter = InterleavedSlice::new(&audio, 1, in_samples)
        .map_err(|e| anyhow::anyhow!("failed to wrap input audio buffer: {e}"))?;

    let resampled = resampler
        .process_all(&input_adapter, in_samples, None)
        .context("failed to resample audio")?;

    Ok(resampled.take_data())
}

pub fn read_audio(audio_data: &[u8]) -> Result<Vec<f64>> {
    let source = Box::new(Cursor::new(audio_data.to_vec()));
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
    let mut interleaved: Vec<f64> = Vec::new();

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
                let spec = audio_buf.spec().clone();
                channels = spec.channels().count();
                fs = spec.rate();

                let n = audio_buf.samples_interleaved();
                interleaved.resize(n, 0.0);
                audio_buf.copy_to_slice_interleaved(&mut interleaved);

                for s in 0..interleaved.len() / channels {
                    let mut a = 0.;
                    for c in 0..channels {
                        a += interleaved[s * channels + c];
                    }
                    audio.push(a / channels as f64);
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

pub fn write_audio(audio: &Vec<f64>) -> Result<Vec<u8>> {
    let out_spec = WavSpec {
        channels: 1,
        sample_rate: consts::SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    let mut writer = WavWriter::new(&mut cursor, out_spec)?;
    let mut scaled_audio: Vec<f64> = audio
        .iter()
        .map(|x| (x * i16::MAX as f64).clamp(i16::MIN as f64, i16::MAX as f64))
        .collect();
    let mut error = 0.0;
    for s in scaled_audio.iter_mut() {
        *s += error;
        let quantized = s.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16;
        error = *s - quantized as f64;
        writer.write_sample(quantized)?;
    }

    writer.finalize()?;
    Ok(cursor.into_inner())
}