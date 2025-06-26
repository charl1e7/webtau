import { writable, get, derived } from 'svelte/store';
import { browser } from '$app/environment';
import type { AppState, Note, VoicebankInfo, PitchbendPoint, ProjectInfo, NoteInfo, EditorMode, SettingsState } from './types';
import 'uuid';

function decodeWav(wavBytes: Uint8Array): { pcmData: Float32Array; sampleRate: number } {
	const dataView = new DataView(wavBytes.buffer);

	if (dataView.getUint32(0, false) !== 0x52494646 || dataView.getUint32(8, false) !== 0x57415645) {
		throw new Error('Invalid WAV file format (RIFF/WAVE header).');
	}

	let sampleRate = -1;
	let bitDepth = -1;
	let dataOffset = -1;
	let dataLength = -1;
	let offset = 12;

	while (offset < dataView.byteLength) {
		const chunkId = dataView.getUint32(offset, false);
		const chunkSize = dataView.getUint32(offset + 4, true);

		if (chunkId === 0x666d7420) { // "fmt "
			if (dataView.getUint16(offset + 8, true) !== 1) throw new Error('Only uncompressed PCM format is supported.');
			sampleRate = dataView.getUint32(offset + 12, true);
			bitDepth = dataView.getUint16(offset + 22, true);
		} else if (chunkId === 0x64617461) { // "data"
			dataOffset = offset + 8;
			dataLength = chunkSize;
			break;
		}
		offset += 8 + chunkSize;
	}

	if (dataOffset === -1 || dataLength === -1 || sampleRate === -1 || bitDepth !== 16) {
		throw new Error('Could not find "data" chunk or format is not 16-bit PCM.');
	}

	const numSamples = dataLength / 2;
	const pcmData = new Float32Array(numSamples);
	for (let i = 0; i < numSamples; i++) {
		const int16Value = dataView.getInt16(dataOffset + i * 2, true);
		pcmData[i] = int16Value / 32768.0;
	}
	return { pcmData, sampleRate };
}

function encodeWav(pcmData: Float32Array, sampleRate: number): Uint8Array {
	const dataSize = pcmData.length * 2;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	view.setUint32(0, 0x52494646, false); // "RIFF"
	view.setUint32(4, 36 + dataSize, true); // File size - 8
	view.setUint32(8, 0x57415645, false); // "WAVE"
	view.setUint32(12, 0x666d7420, false); // "fmt "
	view.setUint32(16, 16, true); // chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, 1, true); // Mono
	view.setUint32(24, sampleRate, true); // Sample rate
	view.setUint32(28, sampleRate * 2, true); // Byte rate
	view.setUint16(32, 2, true); // Block align
	view.setUint16(34, 16, true); // Bits per sample
	view.setUint32(36, 0x64617461, false); // "data"
	view.setUint32(40, dataSize, true); // data size

	for (let i = 0; i < pcmData.length; i++) {
		let s = Math.max(-1, Math.min(1, pcmData[i]));
		s = s < 0 ? s * 32768 : s * 32767;
		view.setInt16(44 + i * 2, s, true);
	}
	return new Uint8Array(buffer);
}
const initialSettings: SettingsState = {
    project: {
		analysisCoreCount: 0, 
	},
	pianoRoll: {
		defaultLyric: 'あ',
		playbackStartMode: 'resume', 
		reRenderOnPlay: false,
	},
};

export const settings = writable<SettingsState>(initialSettings);
let audioContext: AudioContext | null = null;
let masterAudioSource: AudioBufferSourceNode | null = null;
let animationFrameId: number | null = null;
let playbackStartTime = 0;
let playAfterNextSynthesis = false;
const initialAppState: AppState = {
	status: 'App is not initialized.',
	currentVoicebank: null,
	notes: [],
	selectedNoteIds: new Set<string>(),
	playback: { isPlaying: false, currentTime: 0, masterAudioBuffer: null },
	synthesis: { isSynthesizing: false, progress: 0, statusMessage: '' },
	tempo: 120,
	gridDivision: 8,
	editorMode: 'select',
	isNoteEditorOpen: false,
	editingNoteId: null,
    playbackMarkerTime: 0, 
	isSettingsModalOpen: false,
};
export const appState = writable<AppState>(initialAppState);

export const gridSettings = derived(appState, $appState => {
    const msPerBeat = 60000 / $appState.tempo;
    const gridMinorMs = msPerBeat * (4 / $appState.gridDivision);
    const gridMajorMs = msPerBeat;
    const beatsPerGridMinor = 4 / $appState.gridDivision;
    return { msPerBeat, gridMinorMs, gridMajorMs, beatsPerGridMinor };
});
export const pianorollViewSettings = writable({
    msPerPixel: 10,
    noteHeightPx: 20
});

let synthesisWorker: Worker | null = null;

export const setStatus = (message: string) => {
    console.log(message)
	appState.update(state => ({ ...state, status: message }));
};

export const initializeClient = () => {
    if (!browser || synthesisWorker) return;
    setStatus('Initializing background worker...');
    synthesisWorker = new Worker(new URL('./synthesis.worker.ts', import.meta.url), { type: 'module' });

    synthesisWorker.onmessage = async (e: MessageEvent) => {
        const { type, payload } = e.data;
        switch (type) {
            case 'init_done':
                setStatus('Engine ready. Please select a voicebank .zip file.');
                break;
            case 'synthesis_started':
                appState.update(s => ({ ...s, synthesis: { ...s.synthesis, progress: 50, statusMessage: 'Synthesizing in background...' } }));
                break;
            case 'synthesis_done':
                appState.update(s => ({ ...s, synthesis: { ...s.synthesis, progress: 90, statusMessage: 'Processing result...' } }));
                const { pcmData, sampleRate } = decodeWav(payload.wavBytes);
                if (!audioContext) audioContext = new AudioContext();
                const masterAudioBuffer = audioContext.createBuffer(1, pcmData.length, sampleRate);
                masterAudioBuffer.copyToChannel(pcmData, 0);
                appState.update(s => ({
                    ...s,
                    playback: { ...s.playback, masterAudioBuffer },
                    synthesis: { isSynthesizing: false, progress: 100, statusMessage: 'Synthesis complete!' }
                }));
                setStatus('Composition is ready for playback.');

				if (playAfterNextSynthesis) {
                    playAfterNextSynthesis = false;
                    playCurrentBuffer();
                }
                break;
            case 'error':
                const errorMessage = payload.message;
                console.error("Worker error:", errorMessage);
                setStatus(`Error: ${errorMessage}`);
                appState.update(s => ({ ...s, synthesis: { isSynthesizing: false, progress: 0, statusMessage: `Error: ${errorMessage}` } }));
                break;
        }
    };

    synthesisWorker.onerror = (e) => {
        console.error('Critical worker error:', e);
        setStatus(`Critical worker error: ${e.message}`);
    };

    synthesisWorker.postMessage({ type: 'init' });
};

export const loadVoicebank = async (
    voicebankInfo: VoicebankInfo,
    otoData: Uint8Array,
    wavFiles: { name: string; data: Uint8Array }[],
    prefixMapData: Uint8Array | null
) => {
    if (!synthesisWorker) {
        setStatus('Error: Engine was not initialized.');
        return;
    }

    setStatus(`Loading voicebank "${voicebankInfo.name}"...`);
    const oldVoicebank = get(appState).currentVoicebank;
    if (oldVoicebank?.image) {
        URL.revokeObjectURL(oldVoicebank.image);
    }
    appState.update(state => ({ ...state, currentVoicebank: null, playback: initialAppState.playback }));

    try {
        synthesisWorker.postMessage({ type: 'load_oto', payload: { data: otoData } }, [otoData.buffer]);
        
        if (prefixMapData) {
            synthesisWorker.postMessage({ type: 'load_prefix_map', payload: { data: prefixMapData } }, [prefixMapData.buffer]);
        }

        setStatus('oto.ini loaded. Starting parallel analysis of WAV files...');

        const analysisPromise = new Promise<void>((resolve, reject) => {
            const totalCores = navigator.hardwareConcurrency || 4;
            const currentSettings = get(settings);
            let numWorkers: number;
            if (currentSettings.project.analysisCoreCount > 0) {
                numWorkers = Math.max(1, Math.min(currentSettings.project.analysisCoreCount, totalCores));
            } else {
                const calculatedWorkers = Math.round(2 + totalCores * 0.1);
                numWorkers = Math.max(1, Math.min(calculatedWorkers, totalCores - 1));
            }
            const workers: Worker[] = [];
            let filesToProcess = [...wavFiles];
            let processedCount = 0;
            const totalFiles = wavFiles.length;

            const onWorkerMessage = async (event: MessageEvent) => {
                const { status, filename, featuresData, error } = event.data;
                if (status === 'success') {
                    synthesisWorker!.postMessage({
                        type: 'cache_features',
                        payload: { filename, featuresData }
                    }, [featuresData.buffer]);
                    
                    processedCount++;
                    setStatus(`WAV analysis: ${processedCount} / ${totalFiles}`);
                } else {
                    console.error(`Worker error for file ${filename}:`, error);
                    processedCount++;
                }

                if (processedCount === totalFiles) {
                    workers.forEach(w => w.terminate());
                    resolve();
                } else if (filesToProcess.length > 0) {
                    const nextFile = filesToProcess.pop()!;
                    (event.target as Worker).postMessage({ filename: nextFile.name, wavData: nextFile.data }, [nextFile.data.buffer]);
                }
            };
            
            for (let i = 0; i < numWorkers; i++) {
                const worker = new Worker(new URL('./wav-analyzer.worker.ts', import.meta.url), { type: 'module' });
                worker.onmessage = onWorkerMessage;
                worker.onerror = (e) => reject(new Error("Worker failed catastrophically."));
                workers.push(worker);
                if (filesToProcess.length > 0) {
                    const file = filesToProcess.pop()!;
                    worker.postMessage({ filename: file.name, wavData: file.data }, [file.data.buffer]);
                }
            }
        });

        await analysisPromise;
        
        appState.update(state => ({
            ...state,
            currentVoicebank: voicebankInfo,
            status: `Voicebank "${voicebankInfo.name}" loaded successfully!`,
        }));

    } catch (error) {
        console.error('Error loading voicebank:', error);
        setStatus(`Error: ${(error as Error).message}`);
        appState.update(state => ({ ...state, currentVoicebank: null }));
    }
};

function stopPlayback() {
    appState.update(s => ({ ...s, playback: { ...s.playback, isPlaying: false } }));
    if (masterAudioSource) {
        masterAudioSource.onended = null;
        masterAudioSource.stop();
        masterAudioSource.disconnect();
        masterAudioSource = null;
    }
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
}

export const startSynthesis = async () => {
    const state = get(appState);
    if (!synthesisWorker || !state.currentVoicebank || state.notes.length === 0) {
        setStatus('No data to synthesize: load a voicebank and add notes.');
        return;
    }
	
	if (state.playback.isPlaying) {
        stopPlayback();
    }

    appState.update(s => ({
        ...s,
        playback: { ...s.playback, isPlaying: false, masterAudioBuffer: null },
        synthesis: { isSynthesizing: true, progress: 0, statusMessage: 'Sending data for synthesis...' }
    }));

    const { tempo, notes } = state;
    const msPerBeat = 60000 / tempo;
    
    const sortedNotes = [...notes].sort((a, b) => a.startBeat - b.startBeat);
    
    const noteInfos: NoteInfo[] = sortedNotes.map(note => ({
        alias: note.alias,
        pitch: note.midiPitch,
        start_time: note.startBeat * msPerBeat,
        duration: note.durationBeat * msPerBeat,
        pitchbend: note.pitchbend.map(({ id, ...rest }) => rest),
        flags: note.flags ?? '',
        velocity: note.velocity ?? 100,
        volume: note.volume ?? 100,
        modulation: note.modulation ?? 0,
    }));

    const projectData: ProjectInfo = {
        notes: noteInfos,
        tempo: state.tempo,
    };

    synthesisWorker.postMessage({ type: 'synthesize', payload: { projectData } });
};

function playCurrentBuffer() {
	if (!browser) return;
    const state = get(appState);
    if (!state.playback.masterAudioBuffer) {
        setStatus("No audio to play. Please synthesize first.");
        return;
    }
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    
    const currentSettings = get(settings);
    const mode = currentSettings.pianoRoll.playbackStartMode;
    
    let startTimeMs = state.playback.currentTime; 

    if (mode === 'from_start') {
        startTimeMs = 0;
    } else if (mode === 'from_marker') {
        startTimeMs = state.playbackMarkerTime;
    }
    
    if (state.playback.masterAudioBuffer && startTimeMs >= state.playback.masterAudioBuffer.duration * 1000 - 10) {
        startTimeMs = 0;
    }

    masterAudioSource = audioContext.createBufferSource();
    masterAudioSource.buffer = state.playback.masterAudioBuffer;
    masterAudioSource.connect(audioContext.destination);
    
    const seekTimeSec = startTimeMs / 1000;
    playbackStartTime = audioContext.currentTime - seekTimeSec;
    
	appState.update(s => ({ ...s, playback: { ...s.playback, isPlaying: true, currentTime: startTimeMs }}));
	
    masterAudioSource.start(0, seekTimeSec);

    masterAudioSource.onended = () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        masterAudioSource = null;
        animationFrameId = null;
        
        const finalState = get(appState);
        if (finalState.playback.isPlaying) {
            const newCurrentTime = finalState.playback.masterAudioBuffer ? finalState.playback.masterAudioBuffer.duration * 1000 : 0;
            appState.update(s => ({ ...s, playback: { ...s.playback, isPlaying: false, currentTime: newCurrentTime } }));
			if (get(settings).pianoRoll.playbackStartMode === 'from_start') {
				appState.update(s => ({ ...s, playback: { ...s.playback, currentTime: 0 } }));
			}
        }
    };
    
    const updatePlaybackCursor = () => {
        if (!audioContext || !masterAudioSource) return;
        const newTime = (audioContext.currentTime - playbackStartTime) * 1000;
        appState.update(s => ({ ...s, playback: { ...s.playback, currentTime: newTime }}));
        animationFrameId = requestAnimationFrame(updatePlaybackCursor);
    };
    updatePlaybackCursor();
}

export const togglePlayback = () => {
    const state = get(appState);
	const reRenderOnPlay = get(settings).pianoRoll.reRenderOnPlay;

    if (state.playback.isPlaying) {
        stopPlayback();
    } else {
        if (reRenderOnPlay) {
			if(state.notes.length === 0) {
				setStatus('No notes to synthesize.');
				return;
			}
            playAfterNextSynthesis = true;
            startSynthesis();
        } else {
            playCurrentBuffer();
        }
    }
};

export const setPlaybackTime = (timeMs: number) => {
    const state = get(appState);
    const buffer = state.playback.masterAudioBuffer;
    if (!buffer) return;

    const durationMs = buffer.duration * 1000;
    const newTime = Math.max(0, Math.min(timeMs, durationMs));

	appState.update(s => {
		const currentSettings = get(settings);
		const newState = {...s, playback: {...s.playback, currentTime: newTime}};
		if (currentSettings.pianoRoll.playbackStartMode === 'from_marker') {
			newState.playbackMarkerTime = newTime;
		}
		return newState;
	});

    if (get(appState).playback.isPlaying) { 
        if (masterAudioSource) {
            masterAudioSource.onended = null;
            masterAudioSource.stop();
        }

        if (!audioContext) return;
        
        masterAudioSource = audioContext.createBufferSource();
        masterAudioSource.buffer = buffer;
        masterAudioSource.connect(audioContext.destination);
        
        const seekTimeSec = newTime / 1000;
        playbackStartTime = audioContext.currentTime - seekTimeSec;
        masterAudioSource.start(0, seekTimeSec);

        masterAudioSource.onended = () => {
             if (animationFrameId) cancelAnimationFrame(animationFrameId);
             masterAudioSource = null;
             animationFrameId = null;
			 appState.update(s => ({ ...s, playback: { ...s.playback, isPlaying: false, currentTime: s.playback.masterAudioBuffer ? s.playback.masterAudioBuffer.duration * 1000 : 0 } }));
			 if (get(settings).pianoRoll.playbackStartMode === 'from_start') {
				appState.update(s => ({ ...s, playback: { ...s.playback, currentTime: 0 } }));
			}
        };
    }
};


export const downloadWav = () => {
    const { playback: { masterAudioBuffer }, currentVoicebank } = get(appState);
    if (!masterAudioBuffer) {
        setStatus('No audio to download. Please synthesize first.');
        return;
    }
    try {
        setStatus('Preparing WAV file...');
        const pcmData = masterAudioBuffer.getChannelData(0);
        const wavBytes = encodeWav(pcmData, masterAudioBuffer.sampleRate);
        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const filename = currentVoicebank ? `${currentVoicebank.name}-export.wav` : 'wsynth-export.wav';
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        setStatus(`File ${filename} downloaded.`);
    } catch (error) {
        console.error("Download error:", error);
        setStatus(`Download error: ${(error as Error).message}`);
    }
};
export const openSettingsModal = () => {
    appState.update(state => ({ ...state, isSettingsModalOpen: true }));
};

export const closeSettingsModal = () => {
    appState.update(state => ({ ...state, isSettingsModalOpen: false }));
};

export const setEditorMode = (mode: EditorMode) => {
    appState.update(state => ({ ...state, editorMode: mode }));
};
export const addNote = (note: Note) => {
    appState.update(state => ({
        ...state,
        notes: [...state.notes, note],
        selectedNoteIds: new Set([note.id])
    }));
};
export const updateNote = (noteId: string, updates: Partial<Note>) => {
    appState.update(state => ({
        ...state,
        notes: state.notes.map(note =>
            note.id === noteId ? { ...note, ...updates } : note
        )
    }));
};
export const deleteNoteById = (noteId: string) => {
	appState.update(state => {
		const newSelectedIds = new Set(state.selectedNoteIds);
		newSelectedIds.delete(noteId);
		return {
			...state,
			notes: state.notes.filter(note => note.id !== noteId),
			selectedNoteIds: newSelectedIds,
		};
	});
};
export const deleteSelectedNotes = () => {
    appState.update(state => ({
        ...state,
        notes: state.notes.filter(note => !state.selectedNoteIds.has(note.id)),
        selectedNoteIds: new Set()
    }));
};
export const selectNote = (noteId: string, multiple: boolean = false) => {
    appState.update(state => {
        const newSelection = new Set(state.selectedNoteIds);
        if (multiple) {
            newSelection.has(noteId) ? newSelection.delete(noteId) : newSelection.add(noteId);
        } else {
            newSelection.clear();
            newSelection.add(noteId);
        }
        return { ...state, selectedNoteIds: newSelection };
    });
};
export const clearSelection = () => {
    appState.update(state => ({ ...state, selectedNoteIds: new Set() }));
};
export const openNoteEditor = (noteId: string | null) => {
    appState.update(state => ({
        ...state,
        isNoteEditorOpen: noteId !== null,
        editingNoteId: noteId,
        selectedNoteIds: noteId ? new Set([noteId]) : new Set()
    }));
};
export const addPitchbendPoint = (noteId: string, point: PitchbendPoint) => {
    appState.update(state => ({
        ...state,
        notes: state.notes.map(note => {
            if (note.id === noteId) {
                const newPitchbend = [...note.pitchbend, point].sort((a, b) => a.offset - b.offset);
                return { ...note, pitchbend: newPitchbend };
            }
            return note;
        })
    }));
};
export const updatePitchbendPoint = (noteId: string, pointId: string, updates: Partial<PitchbendPoint>) => {
    appState.update(state => ({
        ...state,
        notes: state.notes.map(note => {
            if (note.id === noteId) {
                const newPitchbend = note.pitchbend.map(p =>
                        p.id === pointId ? { ...p, ...updates } : p
                    ).sort((a, b) => a.offset - b.offset);
                return { ...note, pitchbend: newPitchbend };
            }
            return note;
        })
    }));
};
export const deletePitchbendPoint = (noteId: string, pointId: string) => {
    appState.update(state => ({
        ...state,
        notes: state.notes.map(note => {
            if (note.id === noteId) {
                return { ...note, pitchbend: note.pitchbend.filter(p => p.id !== pointId) };
            }
            return note;
        })
    }));
};

export const setTempo = (tempo: number) => {
    appState.update(state => ({ ...state, tempo }));
};

export const setGridDivision = (gridDivision: number) => {
    appState.update(state => ({ ...state, gridDivision }));
};