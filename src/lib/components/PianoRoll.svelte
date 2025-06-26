<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { appState, updateNote, addNote, selectNote, clearSelection, gridSettings, deleteNoteById, updatePitchbendPoint, deletePitchbendPoint, addPitchbendPoint, pianorollViewSettings, setPlaybackTime, settings } from '$lib/stores';
	import type { Note, EditorMode } from '../../lib/types';
	import { midiToNoteName } from '$lib/utils/midi';
	import { PIANO_ROLL_CONFIG } from '$lib/utils/constants';
	import { v4 as uuidv4 } from 'uuid';
	import { get } from 'svelte/store';
    import { browser } from '$app/environment';

	export let notes: Note[];
	export let selectedNoteIds: Set<string>;
	let gridCanvas: HTMLCanvasElement;
	let gridCtx: CanvasRenderingContext2D;
	let rulerCanvas: HTMLCanvasElement;
	let rulerCtx: CanvasRenderingContext2D;
	
	let container: HTMLElement;
	let aliasInput: HTMLInputElement;

	let scrollX = 0;
	let scrollY = 0;
	let isDraggingNote = false;
	let isResizingNote = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let draggedNoteOriginal: Note | null = null;
	let resizedNoteOriginal: Note | null = null;
	
	let isDraggingPitchbendPoint = false;
	let draggedPitchbendInfo: { noteId: string, pointId: string } | null = null;

	let editingAlias: { noteId:string | null; style: string } = { noteId: null, style: '' };
    let resizingHoverNoteId: string | null = null;

	const { MIN_NOTE_DURATION_MS } = PIANO_ROLL_CONFIG;
	const RULER_HEIGHT_PX = 30;
	
	let msPerBeat: number;
	let beatsPerGridMinor: number;
	let gridMinorMs: number;
	let gridMajorMs: number;
	let playbackMarkerTime: number; 
	let currentMode: EditorMode;
	appState.subscribe(state => {
		currentMode = state.editorMode;
		playbackMarkerTime = state.playbackMarkerTime;
		if (editingAlias.noteId) {
			finishAliasEdit();
		}
		if (gridCtx && rulerCtx) {
			draw(); 
		}
	});

	gridSettings.subscribe(value => {
		msPerBeat = value.msPerBeat;
		beatsPerGridMinor = value.beatsPerGridMinor;
		gridMinorMs = value.gridMinorMs;
		gridMajorMs = value.gridMajorMs;
		if (gridCtx) {
			updateCanvasDimensions();
			draw();
		}
	});

	const MIN_MIDI = PIANO_ROLL_CONFIG.MIN_MIDI_PITCH;
	const MAX_MIDI = PIANO_ROLL_CONFIG.MAX_MIDI_PITCH;

	let msPerPixel = 10;
	let noteHeightPx = 20;
	pianorollViewSettings.subscribe(v => {
		msPerPixel = v.msPerPixel;
		noteHeightPx = v.noteHeightPx;
		if (gridCtx) {
			updateCanvasDimensions();
			draw();
		}
	});

	$: keyInfos = Array.from({ length: MAX_MIDI - MIN_MIDI + 1 }, (_, i) => {
		const midi = MAX_MIDI - i;
		const name = midiToNoteName(midi);
		return {
			midi,
			name,
			isSharp: name.includes('#'),
			isC: name.startsWith('C'),
		};
	});

	onMount(async () => {
		gridCtx = gridCanvas.getContext('2d')!;
		rulerCtx = rulerCanvas.getContext('2d')!;
		
		updateCanvasDimensions();
		draw();

		await tick();
		if (container) {
			const midiC4 = 60;
			const yC4 = (MAX_MIDI - midiC4) * noteHeightPx;
			const targetScrollTop = yC4 - container.clientHeight / 2 + noteHeightPx / 2;
			container.scrollTop = targetScrollTop;
		}

        if (browser) {
		    window.addEventListener('resize', handleResize);
        }
		rulerCanvas.addEventListener('mousedown', handleRulerMouseDown);
		gridCanvas.addEventListener('mousedown', handleGridMouseDown);
		gridCanvas.addEventListener('mousemove', handleGridMouseMove);
		gridCanvas.addEventListener('mouseup', handleGridMouseUp);
		gridCanvas.addEventListener('dblclick', handleGridDoubleClick);
        gridCanvas.addEventListener('mouseleave', handleGridMouseLeave);
		gridCanvas.addEventListener('contextmenu', handleGridContextMenu);
		container.addEventListener('scroll', handleScroll);
	});

	onDestroy(() => {
        if (browser) {
		    window.removeEventListener('resize', handleResize);
        }
		if (rulerCanvas) rulerCanvas.removeEventListener('mousedown', handleRulerMouseDown);
		if (gridCanvas) {
			gridCanvas.removeEventListener('mousedown', handleGridMouseDown);
			gridCanvas.removeEventListener('mousemove', handleGridMouseMove);
			gridCanvas.removeEventListener('mouseup', handleGridMouseUp);
			gridCanvas.removeEventListener('dblclick', handleGridDoubleClick);
            gridCanvas.removeEventListener('mouseleave', handleGridMouseLeave);
			gridCanvas.removeEventListener('contextmenu', handleGridContextMenu);
		}
		if (container) {
		    container.removeEventListener('scroll', handleScroll);
        }
	});

    function handleResize() {
        updateCanvasDimensions();
        draw();
    }

    function handleGridMouseLeave() {
        if (resizingHoverNoteId) {
            resizingHoverNoteId = null;
            draw();
        }
        gridCanvas.style.cursor = 'default';
    }

	function updateCanvasDimensions() {
		if (!container || !gridCanvas || !rulerCanvas || !notes || !msPerBeat) return;

		const lastNoteEndBeat = Math.max(...notes.map(n => n.startBeat + n.durationBeat), 0);
		const paddingBeats = 30000 / msPerBeat;
		const totalBeats = lastNoteEndBeat + paddingBeats;
		const contentWidth = (totalBeats * msPerBeat) / msPerPixel;
		
		const pianoKeysWidth = 60;
		const visibleWidth = container.clientWidth > pianoKeysWidth ? container.clientWidth - pianoKeysWidth : 0;
		const totalWidth = Math.max(contentWidth, visibleWidth);
		const gridHeight = (MAX_MIDI - MIN_MIDI + 1) * noteHeightPx;
		if (gridCanvas.width !== totalWidth) gridCanvas.width = totalWidth;
		if (gridCanvas.height !== gridHeight) gridCanvas.height = gridHeight;
		if (rulerCanvas.width !== totalWidth) rulerCanvas.width = totalWidth;
		if (rulerCanvas.height !== RULER_HEIGHT_PX) rulerCanvas.height = RULER_HEIGHT_PX;
	}

	function handleScroll() {
		if (container) {
			scrollX = container.scrollLeft;
			scrollY = container.scrollTop;
            if (editingAlias.noteId) {
                finishAliasEdit();
            }
			drawRuler();
			drawPlayhead();
		}
	}

	function getGridMouseCoordinates(event: MouseEvent) {
		const rect = gridCanvas.getBoundingClientRect();
		return { 
			clientX: event.clientX - rect.left, 
			clientY: event.clientY - rect.top 
		};
	}

	function getNoteAtPoint(x: number, y: number): Note | null {
		if (!msPerBeat) return null;
		const mouseTimeBeats = (x * msPerPixel) / msPerBeat;
		for (const note of notes) {
			const noteStartBeat = note.startBeat;
			const noteEndBeat = note.startBeat + note.durationBeat;
			const noteMIDIY = MAX_MIDI - note.midiPitch;
			const noteTopY = noteMIDIY * noteHeightPx;
			const noteBottomY = noteTopY + noteHeightPx;
			if (mouseTimeBeats >= noteStartBeat && mouseTimeBeats <= noteEndBeat && y >= noteTopY && y <= noteBottomY) {
				return note;
			}
		}
		return null;
	}

    function handleRulerMouseDown(event: MouseEvent) {
		const rect = rulerCanvas.getBoundingClientRect();
		const clientX = event.clientX - rect.left;
		const timeMs = clientX * msPerPixel;
		setPlaybackTime(timeMs);
	}

	function handleGridContextMenu(event: MouseEvent) {
		event.preventDefault();
		if (currentMode !== 'select') return;
		const { clientX, clientY } = getGridMouseCoordinates(event);
		const clickedNote = getNoteAtPoint(clientX, clientY);
		if (clickedNote) {
			deleteNoteById(clickedNote.id);
		}
	}

	function handleGridMouseDown(event: MouseEvent) {
		if (editingAlias.noteId) finishAliasEdit();
		if (!msPerBeat) return;

		const { clientX, clientY } = getGridMouseCoordinates(event);
		dragStartX = clientX;
		dragStartY = clientY;
		
		switch (currentMode) {
			case 'select': {
				if (event.button !== 0) return;
				const clickedNote = getNoteAtPoint(clientX, clientY);
				if (clickedNote) {
					if (!selectedNoteIds.has(clickedNote.id)) {
						clearSelection();
						selectNote(clickedNote.id);
					}
					const noteStartPx = (clickedNote.startBeat * msPerBeat) / msPerPixel;
					const noteEndPx = noteStartPx + (clickedNote.durationBeat * msPerBeat) / msPerPixel;
					if (clientX >= noteEndPx - 10) {
						isResizingNote = true;
						resizedNoteOriginal = { ...clickedNote };
					} else {
						if (event.altKey) {
							const newNote: Note = { ...clickedNote, id: uuidv4(), pitchbend: [] };
							addNote(newNote);
							draggedNoteOriginal = newNote;
						} else {
							draggedNoteOriginal = { ...clickedNote };
						}
						isDraggingNote = true;
					}
				} else {
					clearSelection();
				}
				break;
			}
			case 'pitchbend': {
				let clickedPointInfo = null;
				for (const noteId of selectedNoteIds) {
					const note = notes.find(n => n.id === noteId);
					if (!note) continue;
					const noteStartTimeMs = note.startBeat * msPerBeat;
					for (const point of note.pitchbend) {
						const pointX_abs = (noteStartTimeMs + point.offset) / msPerPixel;
						const pointY_abs = getPitchbendCanvasY(point.value, note);
						if (Math.hypot(clientX - pointX_abs, clientY - pointY_abs) < 5) {
							clickedPointInfo = { noteId: note.id, point };
							break;
						}
					}
					if (clickedPointInfo) break;
				}

				if (clickedPointInfo) {
					if (event.button === 2) {
						deletePitchbendPoint(clickedPointInfo.noteId, clickedPointInfo.point.id);
						event.preventDefault(); 
						return; 
					}
					isDraggingPitchbendPoint = true;
					draggedPitchbendInfo = { noteId: clickedPointInfo.noteId, pointId: clickedPointInfo.point.id };
				} else if (event.button === 0) {
					const selectedNotesArray = Array.from(selectedNoteIds);
					if (selectedNotesArray.length === 1) {
						const note = notes.find(n => n.id === selectedNotesArray[0]);
						if (note) {
							const noteStartTimeMs = note.startBeat * msPerBeat;
							const mouseTimeMs = clientX * msPerPixel;
							const offsetMs = mouseTimeMs - noteStartTimeMs;
							const value = getPitchbendValueFromY(clientY, note);
							addPitchbendPoint(note.id, { id: uuidv4(), offset: offsetMs, value });
						}
					} else {
						const clickedNote = getNoteAtPoint(clientX, clientY);
						if (clickedNote) {
							clearSelection();
							selectNote(clickedNote.id);
						} else {
							clearSelection();
						}
					}
				} else if (event.button === 2) {
					const clickedNote = getNoteAtPoint(clientX, clientY);
					if (clickedNote) {
						clearSelection();
						selectNote(clickedNote.id);
					}
				}
				break;
			}
		}
	}

	function handleGridMouseMove(event: MouseEvent) {
		if (msPerPixel <= 0 || !msPerBeat) return;
		const { clientX, clientY } = getGridMouseCoordinates(event);
		
		if (isResizingNote && resizedNoteOriginal) {
			const noteStartPx = (resizedNoteOriginal.startBeat * msPerBeat) / msPerPixel;
			let rawDurationMs = (clientX - noteStartPx) * msPerPixel;
			let newDurationBeat = rawDurationMs / msPerBeat;
			if (!event.shiftKey) newDurationBeat = Math.round(newDurationBeat / beatsPerGridMinor) * beatsPerGridMinor;
			const minDurationBeat = MIN_NOTE_DURATION_MS / msPerBeat;
			if (newDurationBeat < minDurationBeat) newDurationBeat = minDurationBeat;
			updateNote(resizedNoteOriginal.id, { durationBeat: newDurationBeat });
		} else if (isDraggingNote && draggedNoteOriginal) {
			const deltaX_ms = (clientX - dragStartX) * msPerPixel;
			const deltaBeats = deltaX_ms / msPerBeat;
			const deltaY_notes = Math.round((clientY - dragStartY) / noteHeightPx);
			const newMidiPitch = Math.max(MIN_MIDI, Math.min(MAX_MIDI, draggedNoteOriginal.midiPitch - deltaY_notes));
			let newStartBeat = draggedNoteOriginal.startBeat + deltaBeats;
			if (!event.shiftKey) newStartBeat = Math.round(newStartBeat / beatsPerGridMinor) * beatsPerGridMinor;
			if (newStartBeat < 0) newStartBeat = 0;
			updateNote(draggedNoteOriginal.id, { startBeat: newStartBeat, midiPitch: newMidiPitch });
		} else if (currentMode === 'pitchbend' && isDraggingPitchbendPoint && draggedPitchbendInfo) {
			const note = notes.find(n => n.id === draggedPitchbendInfo!.noteId);
			if (!note) return;
			const noteStartTimeMs = note.startBeat * msPerBeat;
			const mouseTimeMs = clientX * msPerPixel;
			let newOffset = mouseTimeMs - noteStartTimeMs;
			const noteDurationMs = note.durationBeat * msPerBeat;
			newOffset = Math.max(0, Math.min(noteDurationMs, newOffset));
			const newValue = getPitchbendValueFromY(clientY, note);
			updatePitchbendPoint(draggedPitchbendInfo.noteId, draggedPitchbendInfo.pointId, { offset: newOffset, value: newValue });
		}

		if (isDraggingNote || isResizingNote || isDraggingPitchbendPoint) {
			updateCanvasDimensions();
			draw();
		}

		if (!isDraggingNote && !isResizingNote && !isDraggingPitchbendPoint && currentMode === 'select') {
			let handleFound = false;
			for (const note of notes) {
				const noteY = (MAX_MIDI - note.midiPitch) * noteHeightPx;
				const noteStartPx = (note.startBeat * msPerBeat) / msPerPixel;
				const noteWidthPx = (note.durationBeat * msPerBeat) / msPerPixel;
				const noteEndPx = noteStartPx + noteWidthPx;
				if (clientY >= noteY && clientY <= noteY + noteHeightPx && clientX >= noteEndPx - 10 && clientX <= noteEndPx) {
					handleFound = true;
					gridCanvas.style.cursor = 'ew-resize';
					if (resizingHoverNoteId !== note.id) {
						resizingHoverNoteId = note.id;
						draw();
					}
					break;
				}
			}
			if (!handleFound) {
				gridCanvas.style.cursor = 'default';
				if (resizingHoverNoteId !== null) {
					resizingHoverNoteId = null;
					draw();
				}
			}
		}
	}

	function handleGridMouseUp() {
		isDraggingNote = false;
		isResizingNote = false;
		draggedNoteOriginal = null;
		resizedNoteOriginal = null;
		isDraggingPitchbendPoint = false;
		draggedPitchbendInfo = null;
		draw();
	}

	async function handleGridDoubleClick(event: MouseEvent) {
		if (msPerPixel <= 0 || gridMinorMs <= 0 || !msPerBeat) return;
		const { clientX, clientY } = getGridMouseCoordinates(event);
		const clickedNote = getNoteAtPoint(clientX, clientY);
		if (currentMode === 'select') {
			if (clickedNote) {
				await startAliasEdit(clickedNote);
			} else {
				const snapX_px = Math.floor(clientX / (gridMinorMs / msPerPixel)) * (gridMinorMs / msPerPixel);
				const snappedStartTimeMs = Math.max(0, snapX_px * msPerPixel);
				const snappedMidiPitch = MAX_MIDI - Math.floor(clientY / noteHeightPx);
				const snappedStartBeat = snappedStartTimeMs / msPerBeat;
				const defaultLyric = get(settings).pianoRoll.defaultLyric;
				addNote({ id: uuidv4(), alias: defaultLyric, midiPitch: snappedMidiPitch, startBeat: snappedStartBeat, durationBeat: beatsPerGridMinor, pitchbend: [] });
			}
		}
	}

	function getPitchbendCanvasY(value: number, note: Note): number {
		const noteY = (MAX_MIDI - note.midiPitch) * noteHeightPx;
		const noteCenterY = noteY + noteHeightPx / 2;
		const maxPitchbendHeight = noteHeightPx * 2;
		return noteCenterY - (value / 100) * (maxPitchbendHeight / 2);
	}

	function getPitchbendValueFromY(canvasY: number, note: Note): number {
		const noteY = (MAX_MIDI - note.midiPitch) * noteHeightPx;
		const noteCenterY = noteY + noteHeightPx / 2;
		const maxPitchbendHeight = noteHeightPx * 2;
		return ((noteCenterY - canvasY) / (maxPitchbendHeight / 2)) * 100;
	}

	async function startAliasEdit(note: Note) {
		if (!msPerBeat) return;
		const noteX = (note.startBeat * msPerBeat) / msPerPixel;
		const noteY = (MAX_MIDI - note.midiPitch) * noteHeightPx;
		const noteWidth = (note.durationBeat * msPerBeat) / msPerPixel;
		editingAlias = {
			noteId: note.id,
			style: `top: ${noteY}px; left: ${noteX}px; width: ${noteWidth}px; height: ${noteHeightPx}px;`
		};
		await tick();
		if (aliasInput) {
			aliasInput.value = note.alias;
			aliasInput.focus();
			aliasInput.select();
		}
		draw();
	}

	function finishAliasEdit() {
		if (!editingAlias.noteId || !aliasInput) return;
		updateNote(editingAlias.noteId, { alias: aliasInput.value.trim() });
		editingAlias = { noteId: null, style: '' };
		draw();
	}

	function handleAliasInputKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			finishAliasEdit();
			event.preventDefault();
		} else if (event.key === 'Escape') {
			editingAlias = { noteId: null, style: '' };
			draw();
		}
	}

	function drawRuler() {
		if (!rulerCtx || !msPerBeat) return;
		const { width, height } = rulerCanvas;
		rulerCtx.clearRect(0, 0, width, height);
		rulerCtx.fillStyle = '#282828';
		rulerCtx.fillRect(0, 0, width, height);
		
		rulerCtx.save();
		rulerCtx.translate(-scrollX, 0);

		rulerCtx.font = '11px Arial';
		rulerCtx.fillStyle = '#e0e0e0';
		rulerCtx.textAlign = 'left';
		rulerCtx.textBaseline = 'middle';
		
		const beatWidthPx = msPerBeat / msPerPixel;
		if (beatWidthPx < 1) return;

		const totalBeats = Math.floor((width + scrollX) * msPerPixel / msPerBeat);
		const beatsPerMeasure = 4;
		const firstVisibleBeat = Math.floor(scrollX / beatWidthPx);
		
		for (let beat = firstVisibleBeat; beat <= totalBeats; beat++) {
			const x = beat * beatWidthPx;
			const isMeasureStart = beat % beatsPerMeasure === 0;

			rulerCtx.beginPath();
			rulerCtx.moveTo(x, height);
			rulerCtx.lineTo(x, isMeasureStart ? height - 15 : height - 8);
			rulerCtx.strokeStyle = isMeasureStart ? '#bbb' : '#777';
			rulerCtx.stroke();
			
			if (isMeasureStart && beatWidthPx * beatsPerMeasure > 40) {
				rulerCtx.fillText(String(beat / beatsPerMeasure + 1), x + 4, height / 2 - 2);
			}
		}
		rulerCtx.restore();
		rulerCtx.strokeStyle = '#666';
		rulerCtx.strokeRect(0, 0, width, height);
	}

	function drawPlayheadOnContext(ctx: CanvasRenderingContext2D, height: number, translationX: number = 0) {
		const playbackState = get(appState).playback;
		if (!playbackState.masterAudioBuffer) return;
		const playbackX = playbackState.currentTime / msPerPixel;
		
		ctx.save();
		ctx.translate(translationX, 0);
		ctx.strokeStyle = 'rgba(255, 69, 0, 0.9)';
		ctx.lineWidth = 2;
		ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.beginPath();
		ctx.moveTo(playbackX, 0);
		ctx.lineTo(playbackX, height);
		ctx.stroke();
		ctx.restore();
	}

	function drawGridAndNotes() {
		if (!gridCtx || !msPerBeat) return;
		const { width, height } = gridCanvas;
		gridCtx.clearRect(0, 0, width, height);
		
		for (let i = MIN_MIDI; i <= MAX_MIDI; i++) {
			const noteY = (MAX_MIDI - i) * noteHeightPx;
			const noteName = midiToNoteName(i);
			gridCtx.fillStyle = noteName.includes('#') ? '#333333' : '#404040';
			if (noteName.startsWith('C')) gridCtx.fillStyle = '#5c5255';
			gridCtx.fillRect(0, noteY, width, noteHeightPx);
		}

		if (gridMinorMs > 0) {
			const majorLineRatio = Math.round(gridMajorMs / gridMinorMs);
			const totalDurationMs = width * msPerPixel;
			for (let ms = 0, step = 0; ms <= totalDurationMs; ms += gridMinorMs, step++) {
				const x = ms / msPerPixel;
				gridCtx.beginPath();
				gridCtx.strokeStyle = (step % majorLineRatio) === 0 ? '#666666' : '#555555';
				gridCtx.lineWidth = 1;
				gridCtx.setLineDash((step % majorLineRatio) === 0 ? [] : [1, 3]);
				gridCtx.moveTo(x, 0);
				gridCtx.lineTo(x, height);
				gridCtx.stroke();
			}
			gridCtx.setLineDash([]);
		}

		notes.forEach((note) => {
			const noteX = (note.startBeat * msPerBeat) / msPerPixel;
			const noteY = (MAX_MIDI - note.midiPitch) * noteHeightPx;
			const noteWidth = (note.durationBeat * msPerBeat) / msPerPixel;
			gridCtx.fillStyle = selectedNoteIds.has(note.id) ? '#FF80AB' : '#E91E63';
			gridCtx.fillRect(noteX, noteY, noteWidth, noteHeightPx);
			gridCtx.strokeStyle = '#880E4F';
			gridCtx.strokeRect(noteX, noteY, noteWidth, noteHeightPx);

			if (resizingHoverNoteId === note.id && !isResizingNote) {
				gridCtx.fillStyle = 'rgba(255, 255, 0, 0.7)';
				gridCtx.fillRect(noteX + noteWidth - 8, noteY, 8, noteHeightPx);
			}

			if (note.id !== editingAlias.noteId) {
				gridCtx.fillStyle = 'white';
				gridCtx.font = '12px Arial';
				gridCtx.textAlign = 'center';
				gridCtx.textBaseline = 'middle';
				gridCtx.fillText(`${note.alias} (${midiToNoteName(note.midiPitch)})`, noteX + noteWidth / 2, noteY + noteHeightPx / 2);
			}

			if (note.pitchbend.length > 0) {
				const pbValueToY = (value: number) => getPitchbendCanvasY(value, note);
				const sortedPoints = [...note.pitchbend].sort((a, b) => a.offset - b.offset);
				gridCtx.beginPath();
				gridCtx.strokeStyle = selectedNoteIds.has(note.id) ? '#00E5FF' : '#00B8D4';
				gridCtx.lineWidth = 1.5;
				if (sortedPoints[0].offset > 0) {
					gridCtx.moveTo(noteX, pbValueToY(0));
				} else {
					gridCtx.moveTo(noteX + sortedPoints[0].offset / msPerPixel, pbValueToY(sortedPoints[0].value));
				}
				sortedPoints.forEach(p => gridCtx.lineTo(noteX + p.offset / msPerPixel, pbValueToY(p.value)));
				if (sortedPoints.length > 0 && sortedPoints[sortedPoints.length - 1].offset < note.durationBeat * msPerBeat) {
					gridCtx.lineTo(noteX + noteWidth, pbValueToY(0));
				}
				gridCtx.stroke();
				if (selectedNoteIds.has(note.id)) {
					note.pitchbend.forEach(point => {
						const px = noteX + point.offset / msPerPixel;
						const py = pbValueToY(point.value);
						gridCtx.fillStyle = 'white';
						gridCtx.beginPath();
						gridCtx.arc(px, py, 4, 0, Math.PI * 2);
						gridCtx.fill();
						gridCtx.stroke();
					});
				}
			}
		});
	}

	function drawPlayhead() {
		drawPlayheadOnContext(rulerCtx, RULER_HEIGHT_PX, -scrollX);
		drawPlayheadOnContext(gridCtx, gridCanvas.height);
	}

	function drawPlaybackMarkerOnContext(ctx: CanvasRenderingContext2D, height: number, translationX: number = 0) {
		const currentSettings = get(settings);
		if (currentSettings.pianoRoll.playbackStartMode !== 'from_marker') return;
		if (!get(appState).playback.masterAudioBuffer) return;

		const markerX = playbackMarkerTime / msPerPixel;
		
		ctx.save();
		ctx.translate(translationX, 0);
		ctx.strokeStyle = 'rgba(6, 214, 160, 0.8)'; 
		ctx.lineWidth = 2;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(markerX, 0);
		ctx.lineTo(markerX, height);
		ctx.stroke();
		ctx.restore();
	}

	function drawPlaybackMarker() {
		drawPlaybackMarkerOnContext(rulerCtx, RULER_HEIGHT_PX, -scrollX);
		drawPlaybackMarkerOnContext(gridCtx, gridCanvas.height);
	}

	function draw() {
		drawRuler();
		drawGridAndNotes();
		drawPlaybackMarker();
		drawPlayhead();
	}

	function zoomHorizontal(delta: number) {
		pianorollViewSettings.update(v => ({ ...v, msPerPixel: Math.max(1, v.msPerPixel + delta) }));
	}
	function zoomVertical(delta: number) {
		pianorollViewSettings.update(v => ({ ...v, noteHeightPx: Math.max(5, v.noteHeightPx + delta) }));
	}
</script>

<div class="piano-roll-container">
	<div class="pianoroll-zoom-panel">
		<span>Hor. zoom:</span>
		<button on:click={() => zoomHorizontal(+2)}>-</button>
		<button on:click={() => zoomHorizontal(-2)}>+</button>
		<span style="margin-left:1em">Vert. zoom:</span>
		<button on:click={() => zoomVertical(-2)}>-</button>
		<button on:click={() => zoomVertical(2)}>+</button>
	</div>
	
	<div class="piano-roll-grid-layout" bind:this={container}>
		<div class="corner-block"></div>
		<div class="ruler-wrapper">
			<canvas bind:this={rulerCanvas}></canvas>
		</div>
		<div class="piano-keys">
			{#each keyInfos as key (key.midi)}
				<div 
					class="piano-key" 
					class:sharp={key.isSharp}
					class:c-note={key.isC}
					style="height: {noteHeightPx}px;"
				>
					{key.name}
				</div>
			{/each}
		</div>
		<div class="canvas-wrapper">
			<canvas bind:this={gridCanvas}></canvas>
			{#if editingAlias.noteId}
				<input 
					bind:this={aliasInput}
					type="text"
					class="alias-input"
					style={editingAlias.style}
					on:blur={finishAliasEdit}
					on:keydown={handleAliasInputKeydown}
				/>
			{/if}
		</div>
	</div>
</div>

<style>
	.piano-roll-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		flex-grow: 1;
		background-color: #2b2b2b;
		color: #e0e0e0;
	}

	.piano-roll-grid-layout {
		flex-grow: 1;
		overflow: auto;
		position: relative;
		display: grid;
		grid-template-areas: "corner ruler" "keys grid";
		grid-template-columns: 60px 1fr;
		grid-template-rows: 30px 1fr;
		background-color: #3C3C3C;
	}

	.corner-block {
		grid-area: corner;
		position: sticky;
		top: 0;
		left: 0;
		z-index: 4;
		background-color: #282828;
		border-right: 1px solid #666;
		border-bottom: 1px solid #666;
	}
	
	.ruler-wrapper {
		grid-area: ruler;
		position: sticky;
		top: 0;
		z-index: 3;
	}
	.ruler-wrapper canvas {
		display: block;
		cursor: ew-resize;
	}

	.piano-keys {
		grid-area: keys;
		position: sticky;
		left: 0;
		z-index: 2;
		background-color: #2b2b2b;
	}

	.canvas-wrapper {
		grid-area: grid;
		position: relative;
	}
	.canvas-wrapper canvas {
		cursor: text;
		display: block;
	}

	.piano-key {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 60px;
		box-sizing: border-box;
		font-family: Arial, sans-serif;
		font-size: 11px;
		font-weight: bold;
		color: white;
		border-bottom: 1px solid #2b2b2b;
		background-color: #E91E63;
	}
	.piano-key.sharp { background-color: #4a4a4a; }
	.piano-key.c-note { background-color: #f8bbd0; color: #333; }

    .alias-input {
        position: absolute;
        background-color: rgba(255, 255, 255, 0.9);
        border: 1px solid var(--primary-color);
        box-sizing: border-box;
        text-align: center;
        font-family: Arial, sans-serif;
        font-size: 12px;
        padding: 0;
        margin: 0;
        color: black;
        outline: none;
        z-index: 10;
    }

	.pianoroll-zoom-panel {
		display: flex;
		align-items: center;
		gap: 0.5em;
		padding: 0.5em;
		background: #2b2b2b;
		border-bottom: 1px solid #444;
		font-size: 14px;
		flex-shrink: 0;
	}
	.pianoroll-zoom-panel button {
		background-color: #444;
		border: 1px solid #555;
		color: #eee;
		cursor: pointer;
		width: 32px;
		height: 32px;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		font-size: 18px;
	}
</style>