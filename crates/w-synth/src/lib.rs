use std::ptr;

mod audio;
mod consts;
mod engine;
mod flags;
mod interpolator;
mod oto;
mod resample;
mod util;
mod world;

use engine::{Engine, NoteInfo, ProjectInfo};
use world::features::{AnalysisMode, WorldFeatures, generate_features};

/// Heap block handed to JavaScript: `[ptr: u32, len: u32]`.
#[repr(C)]
pub struct WasmBuffer {
    ptr: *mut u8,
    len: usize,
}

fn into_buffer(bytes: Vec<u8>) -> *mut WasmBuffer {
    let boxed = bytes.into_boxed_slice();
    let len = boxed.len();
    let ptr = Box::into_raw(boxed) as *mut u8;
    Box::into_raw(Box::new(WasmBuffer { ptr, len }))
}

unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

unsafe fn text<'a>(ptr: *const u8, len: usize) -> &'a str {
    std::str::from_utf8(unsafe { bytes(ptr, len) }).unwrap_or("")
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_init() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[w-synth] panic: {info}");
    }));
}

/// Version of the feature format; cached features from other versions are stale.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_analysis_version() -> u32 {
    consts::ANALYSIS_VERSION
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_create() -> *mut Engine {
    Box::into_raw(Box::new(Engine::new()))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_destroy(engine: *mut Engine) {
    if !engine.is_null() {
        drop(unsafe { Box::from_raw(engine) });
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_reset(engine: *mut Engine) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.reset();
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_load_oto(
    engine: *mut Engine,
    data: *const u8,
    len: usize,
) -> bool {
    let Some(engine) = (unsafe { engine.as_mut() }) else {
        return false;
    };
    engine.load_oto(unsafe { bytes(data, len) }).is_ok()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_load_prefix_map(
    engine: *mut Engine,
    data: *const u8,
    len: usize,
) -> bool {
    let Some(engine) = (unsafe { engine.as_mut() }) else {
        return false;
    };
    engine.load_prefix_map(unsafe { bytes(data, len) });
    true
}

/// JSON `{"entries": [[alias, file], ...]}` of the loaded oto.ini.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_oto_json(engine: *mut Engine) -> *mut WasmBuffer {
    let Some(engine) = (unsafe { engine.as_ref() }) else {
        return ptr::null_mut();
    };
    let json = serde_json::json!({ "entries": engine.oto_entries() });
    into_buffer(json.to_string().into_bytes())
}

/// Takes a JSON array of notes, returns `{"files": [...], "missing": [indices]}`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_required_files(
    engine: *mut Engine,
    json: *const u8,
    len: usize,
) -> *mut WasmBuffer {
    let Some(engine) = (unsafe { engine.as_ref() }) else {
        return ptr::null_mut();
    };
    let Ok(notes) = serde_json::from_str::<Vec<NoteInfo>>(unsafe { text(json, len) }) else {
        return ptr::null_mut();
    };
    let (files, missing) = engine.required_files(&notes);
    let json = serde_json::json!({ "files": files, "missing": missing });
    into_buffer(json.to_string().into_bytes())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_has_features(
    engine: *mut Engine,
    name: *const u8,
    name_len: usize,
) -> bool {
    match unsafe { engine.as_ref() } {
        Some(engine) => engine.has_features(unsafe { text(name, name_len) }),
        None => false,
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_cache_features(
    engine: *mut Engine,
    name: *const u8,
    name_len: usize,
    data: *const u8,
    len: usize,
) -> bool {
    let Some(engine) = (unsafe { engine.as_mut() }) else {
        return false;
    };
    let filename = unsafe { text(name, name_len) };
    if filename.is_empty() {
        return false;
    }
    match oxicode::decode_from_slice::<WorldFeatures>(unsafe { bytes(data, len) }) {
        Ok((features, _)) => {
            engine.cache_features(filename, features);
            true
        }
        Err(_) => false,
    }
}

/// Analyzes a WAV file. `mode`: 0 = accurate (Harvest), 1 = fast (DIO).
/// Returns serialized `WorldFeatures` or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_analyze_wav(
    data: *const u8,
    len: usize,
    mode: u32,
) -> *mut WasmBuffer {
    let Ok(audio) = audio::read_write::read_audio(unsafe { bytes(data, len) }) else {
        return ptr::null_mut();
    };
    let Ok(features) = generate_features(&audio, AnalysisMode::from_u32(mode), None) else {
        return ptr::null_mut();
    };
    match oxicode::encode_to_vec(&features) {
        Ok(encoded) => into_buffer(encoded),
        Err(_) => ptr::null_mut(),
    }
}

/// Starts a synthesis session. Returns the number of notes to render, or -1.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_session_begin(
    engine: *mut Engine,
    json: *const u8,
    len: usize,
) -> i32 {
    let Some(engine) = (unsafe { engine.as_mut() }) else {
        return -1;
    };
    match serde_json::from_str::<ProjectInfo>(unsafe { text(json, len) }) {
        Ok(project) if !project.notes.is_empty() => engine.begin(project) as i32,
        _ => -1,
    }
}

/// Renders up to `max_notes` notes. Returns the number still to do, or -1.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_session_step(engine: *mut Engine, max_notes: u32) -> i32 {
    let Some(engine) = (unsafe { engine.as_mut() }) else {
        return -1;
    };
    engine.step(max_notes as usize).map_or(-1, |n| n as i32)
}

/// Finishes the session; returns mono f32 PCM (little endian) at 44.1 kHz.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_session_finish(engine: *mut Engine) -> *mut WasmBuffer {
    let Some(engine) = (unsafe { engine.as_mut() }) else {
        return ptr::null_mut();
    };
    match engine.finish() {
        Ok(pcm) => {
            let mut out = Vec::with_capacity(pcm.len() * 4);
            for s in pcm {
                out.extend_from_slice(&s.to_le_bytes());
            }
            into_buffer(out)
        }
        Err(_) => ptr::null_mut(),
    }
}

/// JSON report of the last finished session.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_engine_report(engine: *mut Engine) -> *mut WasmBuffer {
    let Some(engine) = (unsafe { engine.as_ref() }) else {
        return ptr::null_mut();
    };
    match serde_json::to_vec(engine.report()) {
        Ok(json) => into_buffer(json),
        Err(_) => ptr::null_mut(),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn wsynth_free_buffer(buffer: *mut WasmBuffer) {
    if buffer.is_null() {
        return;
    }
    unsafe {
        let buffer = Box::from_raw(buffer);
        let slice = std::ptr::slice_from_raw_parts_mut(buffer.ptr, buffer.len);
        drop(Box::from_raw(slice));
    }
}

