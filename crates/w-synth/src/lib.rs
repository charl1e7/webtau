use bincode::config;
use serde::Deserialize;
use std::collections::HashMap;
use std::ffi::CStr;
use std::os::raw::c_char;
use std::ptr;

mod audio;
mod consts;
mod filter;
mod flags;
mod interpolator;
mod oto;
mod parser;
mod resample;
mod util;
mod world;
use oto::{OtoMap, PrefixMap, parse_oto_ini, parse_prefix_map};
use std::panic;
use world::features::{WorldFeatures, generate_features};

#[derive(Deserialize, Debug)]
struct PitchbendPointInfo {
    offset: f64,
    value: f64,
}

#[derive(Deserialize, Debug)]
struct NoteInfo {
    alias: String,
    pitch: i32,
    start_time: f64,
    duration: f64,
    pitchbend: Vec<PitchbendPointInfo>,
    flags: String,
    velocity: f64,
    volume: f64,
    modulation: f64,
}

#[derive(Deserialize, Debug)]
struct ProjectInfo {
    notes: Vec<NoteInfo>,
    tempo: f64,
}

pub struct WSynthEngine {
    oto: OtoMap,
    features_cache: HashMap<String, WorldFeatures>,
    prefix_map: PrefixMap,
}

impl WSynthEngine {
    pub fn new() -> Self {
        Self {
            oto: HashMap::new(),
            features_cache: HashMap::new(),
            prefix_map: HashMap::new(),
        }
    }
}

#[repr(C)]
pub struct WasmBuffer {
    ptr: *mut u8,
    len: usize,
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_init() {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_create() -> *mut WSynthEngine {
    Box::into_raw(Box::new(WSynthEngine::new()))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_destroy(engine_ptr: *mut WSynthEngine) {
    if !engine_ptr.is_null() {
        unsafe {
            drop(Box::from_raw(engine_ptr));
        }
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_load_oto(
    engine_ptr: *mut WSynthEngine,
    data: *const u8,
    len: usize,
) -> bool {
    if engine_ptr.is_null() {
        return false;
    }
    let engine = unsafe { &mut *engine_ptr };
    let data_slice = unsafe { std::slice::from_raw_parts(data, len) };

    match parse_oto_ini(std::io::Cursor::new(data_slice)) {
        Ok(oto_map) => {
            engine.oto = oto_map;
            true
        }
        Err(_) => false,
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_load_prefix_map(
    engine_ptr: *mut WSynthEngine,
    data: *const u8,
    len: usize,
) -> bool {
    if engine_ptr.is_null() {
        return false;
    }
    let engine = unsafe { &mut *engine_ptr };
    let data_slice = unsafe { std::slice::from_raw_parts(data, len) };

    match parse_prefix_map(std::io::Cursor::new(data_slice)) {
        Ok(prefix_map) => {
            engine.prefix_map = prefix_map;
            true
        }
        Err(_) => false,
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_analyze_wav(data: *const u8, len: usize) -> *mut WasmBuffer {
    let data_slice = unsafe { std::slice::from_raw_parts(data, len) };

    let audio = match audio::read_write::read_audio(data_slice) {
        Ok(a) => a,
        Err(_) => return ptr::null_mut(),
    };

    match generate_features(audio, None) {
        Ok(features) => {
            let bincode_config = config::standard();
            match bincode::encode_to_vec(&features, bincode_config) {
                Ok(mut serialized_bytes) => {
                    serialized_bytes.shrink_to_fit();
                    let ptr = serialized_bytes.as_mut_ptr();
                    let len = serialized_bytes.len();
                    std::mem::forget(serialized_bytes);

                    let buffer = Box::new(WasmBuffer { ptr, len });
                    Box::into_raw(buffer)
                }
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(_) => ptr::null_mut(),
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_cache_features(
    engine_ptr: *mut WSynthEngine,
    filename_ptr: *const c_char,
    data: *const u8,
    len: usize,
) -> bool {
    if engine_ptr.is_null() {
        return false;
    }
    let engine = unsafe { &mut *engine_ptr };
    let filename = unsafe { CStr::from_ptr(filename_ptr).to_str().unwrap_or("") };
    if filename.is_empty() {
        return false;
    }

    let data_slice = unsafe { std::slice::from_raw_parts(data, len) };
    let bincode_config = config::standard();

    match bincode::decode_from_slice::<WorldFeatures, _>(data_slice, bincode_config) {
        Ok((features, _)) => {
            engine.features_cache.insert(filename.to_string(), features);
            true
        }
        Err(_) => false,
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_synthesize_project(
    engine_ptr: *mut WSynthEngine,
    json_str_ptr: *const c_char,
) -> *mut WasmBuffer {
    if engine_ptr.is_null() || json_str_ptr.is_null() {
        return ptr::null_mut();
    }
    let engine = unsafe { &*engine_ptr };
    let json_str = unsafe { CStr::from_ptr(json_str_ptr).to_str().unwrap_or("") };

    let project: ProjectInfo = match serde_json::from_str(json_str) {
        Ok(p) => p,
        Err(e) => {
            println!("[wsynth-rust] JSON parse error: {}", e);
            return ptr::null_mut();
        }
    };

    if project.notes.is_empty() {
        return ptr::null_mut();
    }

    let last_note = project.notes.last().unwrap();
    let total_duration_ms = last_note.start_time + last_note.duration + 2000.0;
    let total_samples = (total_duration_ms / 1000.0 * consts::SAMPLE_RATE as f64).ceil() as usize;
    let mut master_buffer = vec![0.0f64; total_samples];

    for i in 0..project.notes.len() {
        let current_note = &project.notes[i];

        let mut prev_note_overlap_ms = 0.0;
        let has_prev_note_for_crossfade = if i > 0 {
            let prev_note = &project.notes[i - 1];
            if (prev_note.start_time + prev_note.duration) == current_note.start_time {
                let prev_alias =
                    resample::resolve_alias(prev_note, &engine.prefix_map, &engine.oto);
                if let Some(prev_oto) = engine.oto.get(&prev_alias) {
                    prev_note_overlap_ms = prev_oto.overlap;
                }
                true
            } else {
                false
            }
        } else {
            false
        };

        let has_next_note_for_crossfade = if i < project.notes.len() - 1 {
            let next_note = &project.notes[i + 1];
            (current_note.start_time + current_note.duration) == next_note.start_time
        } else {
            false
        };

        if current_note.alias.to_lowercase() == "r" {
            continue;
        }

        let final_alias = resample::resolve_alias(current_note, &engine.prefix_map, &engine.oto);
        let oto_entry = match engine.oto.get(&final_alias) {
            Some(entry) => entry,
            None => {
                println!(
                    "[wsynth-rust] Warning: Oto entry not found for alias '{}'",
                    final_alias
                );
                continue;
            }
        };

        match resample::render_note(
            current_note,
            oto_entry,
            &engine.features_cache,
            project.tempo,
            prev_note_overlap_ms,
            has_next_note_for_crossfade,
        ) {
            Ok(rendered_pcm) => {
                let pcm_start_ms = current_note.start_time - oto_entry.preutterance;
                let start_sample =
                    (pcm_start_ms / 1000.0 * consts::SAMPLE_RATE as f64).round() as isize;

                for (j, sample) in rendered_pcm.iter().enumerate() {
                    let master_index = start_sample + j as isize;
                    if master_index >= 0 {
                        if let Some(master_sample) = master_buffer.get_mut(master_index as usize) {
                            *master_sample += *sample;
                        }
                    }
                }
            }
            Err(e) => {
                println!(
                    "[wsynth-rust] Render error for note '{}': {}",
                    current_note.alias, e
                );
            }
        }
    }
    let peak = master_buffer
        .iter()
        .fold(0.0f64, |max, &val| max.max(val.abs()));
    if peak > 1.0 {
        for sample in master_buffer.iter_mut() {
            *sample /= peak;
        }
    }

    match audio::read_write::write_audio(&master_buffer) {
        Ok(mut wav_bytes) => {
            wav_bytes.shrink_to_fit();
            let ptr = wav_bytes.as_mut_ptr();
            let len = wav_bytes.len();
            std::mem::forget(wav_bytes);

            let buffer = Box::new(WasmBuffer { ptr, len });
            Box::into_raw(buffer)
        }
        Err(_) => ptr::null_mut(),
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_free_buffer(buffer_ptr: *mut WasmBuffer) {
    if !buffer_ptr.is_null() {
        unsafe {
            let buffer = Box::from_raw(buffer_ptr);
            drop(Vec::from_raw_parts(buffer.ptr, buffer.len, buffer.len));
        }
    }
}
