use crate::consts;
use anyhow::Result;
use hound::{SampleFormat, WavSpec, WavWriter};
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use std::io::Cursor;
use symphonia::{
    core::{
        audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions,
        io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
    },
    default::{get_codecs, get_probe},
};

fn resample_audio(audio: Vec<f64>, in_fs: u32, out_fs: u32) -> Result<Vec<f64>> {
    let in_samples = audio.len();
    let out_samples = (in_samples as f64 * out_fs as f64 / in_fs as f64) as usize;
    let mut resampled: Vec<f64> = Vec::with_capacity(out_samples);

    let resampler_params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 1.,
        oversampling_factor: 128,
        interpolation: SincInterpolationType::Cubic,
        window: WindowFunction::Hann,
    };
    let mut resampler =
        SincFixedIn::<f64>::new(out_fs as f64 / in_fs as f64, 2., resampler_params, 1024, 1)?;

    for i in (0..in_samples).step_by(1024) {
        let end = (i + 1024).min(in_samples);
        let mut chunk = audio[i..end].to_vec();
        if chunk.len() < 1024 {
            chunk.resize(1024, 0.0);
        }

        let chunk = vec![chunk];
        let mut res = resampler.process(&chunk, None)?;
        resampled.append(&mut res[0]);
    }
    Ok(resampled)
}

pub fn read_audio(audio_data: &[u8]) -> Result<Vec<f64>> {
    let source = Box::new(Cursor::new(audio_data.to_vec()));
    let mss = MediaSourceStream::new(source, Default::default());

    let hint = Hint::new();

    let format_opts: FormatOptions = Default::default();
    let metadata_opts: MetadataOptions = Default::default();
    let decoder_opts: DecoderOptions = Default::default();

    let probed = get_probe().format(&hint, mss, &format_opts, &metadata_opts)?;

    let mut format = probed.format;
    let track = format.default_track().unwrap();
    let mut decoder = get_codecs().make(&track.codec_params, &decoder_opts)?;
    let track_id = track.id;

    let mut audio: Vec<f64> = Vec::new();
    let mut channels = 1;
    let mut fs = 1;
    let mut packet_buffer = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded_packet) => {
                if packet_buffer.is_none() {
                    let spec = *decoded_packet.spec();
                    channels = spec.channels.count();
                    fs = spec.rate;
                    let duration = decoded_packet.capacity() as u64;
                    packet_buffer = Some(SampleBuffer::<f64>::new(duration, spec));
                }

                if let Some(buffer) = &mut packet_buffer {
                    buffer.copy_interleaved_ref(decoded_packet);
                    let samples = buffer.samples();
                    for s in 0..samples.len() / channels {
                        let mut a = 0.;
                        for c in 0..channels {
                            a += samples[s * channels + c];
                        }
                        audio.push(a / channels as f64);
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
