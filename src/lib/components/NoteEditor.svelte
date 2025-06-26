<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { appState, updateNote, addPitchbendPoint, updatePitchbendPoint, deletePitchbendPoint, gridSettings } from '$lib/stores';
	import type { Note, PitchbendPoint } from '$lib/types';
	import { midiToNoteName } from '$lib/utils/midi';
	import { PIANO_ROLL_CONFIG } from '$lib/utils/constants';
	import { v4 as uuidv4 } from 'uuid';
	import { onMount, onDestroy } from 'svelte';

	export let noteId: string;

	const dispatch = createEventDispatcher();

	let editingNote: Note | undefined;
	let durationMs: number; 
	let pitchbendCanvas: HTMLCanvasElement;
	let pitchbendCtx: CanvasRenderingContext2D;
	let escHandler: (e: KeyboardEvent) => void;

	let msPerBeat: number;
	gridSettings.subscribe(value => {
		msPerBeat = value.msPerBeat;
	});

	$: {
		editingNote = $appState.notes.find((n) => n.id === noteId);
		if (editingNote && msPerBeat) {
			durationMs = editingNote.durationBeat * msPerBeat;
		}
		if (pitchbendCtx && editingNote) {
			drawPitchbend();
		}
	}

	function handleDurationChange(value: number) {
		if (editingNote && msPerBeat > 0) {
			const newDurationBeat = value / msPerBeat;
			updateNote(noteId, { durationBeat: newDurationBeat });
		}
	}

	function handleNotePropertyChange(key: keyof Note, value: any) {
		if (editingNote) {
			if (key === 'durationBeat') return;
			updateNote(noteId, { [key]: value });
		}
	}

	function handlePitchbendMouseDown(event: MouseEvent) {
		if (!editingNote || !pitchbendCtx) return;

		const rect = pitchbendCanvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		const currentPitchbendPoints = editingNote.pitchbend;
		let clickedPoint: PitchbendPoint | null = null;
		for (const point of currentPitchbendPoints) {
			const pointX = (point.offset / editingNote.duration) * pitchbendCanvas.width;
			const pointY = pitchbendToCanvasY(point.value);
			const hitRadius = 5;
			if (
				x >= pointX - hitRadius && x <= pointX + hitRadius &&
				y >= pointY - hitRadius && y <= pointY + hitRadius
			) {
				clickedPoint = point;
				break;
			}
		}

		if (event.button === 0) { 
			if (clickedPoint) {
				console.log("Started dragging pitchbend point:", clickedPoint);
			} else {
				const newOffset = (x / pitchbendCanvas.width) * editingNote.duration;
				const newValue = canvasYToPitchbend(y);
				addPitchbendPoint(noteId, { id: uuidv4(), offset: newOffset, value: newValue });
			}
		} else if (event.button === 2 && clickedPoint) {
			deletePitchbendPoint(noteId, clickedPoint.id);
		}

		drawPitchbend();
	}


	function drawPitchbend() {
		if (!pitchbendCtx || !editingNote) return;

		const canvasWidth = pitchbendCanvas.width;
		const canvasHeight = pitchbendCanvas.height;
		const noteDurationMs = editingNote.durationBeat * msPerBeat;


		pitchbendCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		pitchbendCtx.strokeStyle = '#ccc';
		pitchbendCtx.lineWidth = 1;
		pitchbendCtx.beginPath();
		pitchbendCtx.moveTo(0, canvasHeight / 2);
		pitchbendCtx.lineTo(canvasWidth, canvasHeight / 2);
		pitchbendCtx.stroke();

		if (editingNote.pitchbend.length === 0) return;
		pitchbendCtx.strokeStyle = 'red';
		pitchbendCtx.lineWidth = 2;
		pitchbendCtx.beginPath();
		if (editingNote.pitchbend[0].offset > 0) {
			const firstPoint = editingNote.pitchbend[0];
			pitchbendCtx.moveTo(0, pitchbendToCanvasY(0));
			pitchbendCtx.lineTo(
				(firstPoint.offset / noteDurationMs) * canvasWidth,
				pitchbendToCanvasY(firstPoint.value)
			);
		} else {
			const firstPoint = editingNote.pitchbend[0];
			pitchbendCtx.moveTo(
				(firstPoint.offset / noteDurationMs) * canvasWidth,
				pitchbendToCanvasY(firstPoint.value)
			);
		}


		editingNote.pitchbend.forEach((point) => {
			const x = (point.offset / noteDurationMs) * canvasWidth;
			const y = pitchbendToCanvasY(point.value);
			pitchbendCtx.lineTo(x, y);
		});
		if (editingNote.pitchbend[editingNote.pitchbend.length - 1].offset < noteDurationMs) {
			const lastPoint = editingNote.pitchbend[editingNote.pitchbend.length - 1];
			pitchbendCtx.lineTo(
				canvasWidth,
				pitchbendToCanvasY(0)
			);
		}

		pitchbendCtx.stroke();
		editingNote.pitchbend.forEach((point) => {
			const x = (point.offset / noteDurationMs) * canvasWidth;
			const y = pitchbendToCanvasY(point.value);
			pitchbendCtx.fillStyle = 'white';
			pitchbendCtx.strokeStyle = 'red';
			pitchbendCtx.lineWidth = 1;
			pitchbendCtx.beginPath();
			pitchbendCtx.arc(x, y, 4, 0, Math.PI * 2);
			pitchbendCtx.fill();
			pitchbendCtx.stroke();
		});
	}

	function pitchbendToCanvasY(value: number): number {
		return pitchbendCanvas.height / 2 - (value / 100) * (pitchbendCanvas.height / 2);
	}

	function canvasYToPitchbend(y: number): number {
		return ((pitchbendCanvas.height / 2 - y) / (pitchbendCanvas.height / 2)) * 100;
	}

	onMount(() => {
		escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch('close'); };
		window.addEventListener('keydown', escHandler);
		pitchbendCtx = pitchbendCanvas.getContext('2d')!;
		drawPitchbend();
	});

	onDestroy(() => {
		window.removeEventListener('keydown', escHandler);
	});
	function pitchbendToString(points: PitchbendPoint[]): string {
		if (!points || points.length === 0) return 'P0';
		return points.map(p => `P${p.value}O${p.offset}`).join(',');
	}
</script>

{#if editingNote}
	<div class="note-editor-overlay" role="dialog" aria-modal="true" on:click|self={() => dispatch('close')}>
		<section class="note-editor-modal" role="document" on:click|stopPropagation>
			<h3>Editing note: {editingNote?.alias}</h3>
			<div class="form-group">
				<label for="alias">Alias:</label>
				<input
					type="text"
					id="alias"
					value={editingNote?.alias}
					on:input={(e) => handleNotePropertyChange('alias', e.currentTarget.value)}
				/>
			</div>
			<div class="form-group">
				<label for="midiPitch">Pitch (MIDI): {editingNote ? midiToNoteName(editingNote?.midiPitch ?? 0) : ''}</label>
				<input
					type="number"
					id="midiPitch"
					min={PIANO_ROLL_CONFIG.MIN_MIDI_PITCH}
					max={PIANO_ROLL_CONFIG.MAX_MIDI_PITCH}
					value={editingNote?.midiPitch}
					on:input={(e) => handleNotePropertyChange('midiPitch', parseInt(e.currentTarget.value, 10))}
				/>
			</div>
			<div class="form-group">
				<label for="duration">Duration (ms):</label>
				<input
					type="number"
					id="duration"
					min={PIANO_ROLL_CONFIG.MIN_NOTE_DURATION_MS}
					value={durationMs}
					on:input={(e) => handleDurationChange(parseInt(e.currentTarget.value, 10))}
				/>
			</div>
			<div class="form-group">
				<label for="velocity">Velocity (0-100):</label>
				<input type="number" id="velocity" min="0" max="100" value={editingNote?.velocity ?? 100} on:input={(e) => handleNotePropertyChange('velocity', parseInt(e.currentTarget.value, 10))} />
			</div>
			<div class="form-group">
				<label for="flags">Flags:</label>
				<input type="text" id="flags" value={editingNote?.flags ?? ''} on:input={(e) => handleNotePropertyChange('flags', e.currentTarget.value)} />
			</div>
			<h4>Pitchbend Editing</h4>
			<div class="pitchbend-editor">
				<canvas
					bind:this={pitchbendCanvas}
					width="500"
					height="150"
					on:mousedown={handlePitchbendMouseDown}
					on:contextmenu|preventDefault|stopPropagation
				></canvas>
				<p>Click to add a point. Right-click on a point to delete.</p>
				<p>Current points: {editingNote ? pitchbendToString(editingNote?.pitchbend ?? []) : ''}</p>
			</div>
			<button on:click={() => dispatch('close')}>Close</button>
		</section>
	</div>
{/if}