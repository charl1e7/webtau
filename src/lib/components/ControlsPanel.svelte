<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { base } from '$app/paths'; 
	export let isPlaying: boolean;
	export let isSynthesizing: boolean;

	export let tempo: number;
	export let gridDivision: number;
	export let editorMode: string;

	const dispatch = createEventDispatcher();
</script>

<div class="controls-panel">
	<div class="logo-section">
		<div class="logo-label">WEBTau</div>
		<div class="logo-container" title="logo">
			<img src="{base}/favicon.png" alt="Webtau Logo" class="logo-icon" />
		</div>
	</div>
	<!-- <div class="divider"></div> -->

	<div class="transport-section">
		<div class="transport-group">
			<label class="transport-label">Transport</label>
			<div class="transport-controls">
				<button 
					class="transport-btn" 
					on:click={() => dispatch('goToStart')} 
					title="Go to start"
				>
					<svg width="18" height="18" viewBox="0 0 18 18">
						<path d="M5 4.5V13.5" stroke="currentColor" stroke-width="2" fill="none"/>
						<path d="M14 4.5L7 9L14 13.5V4.5Z" fill="currentColor"/>
					</svg>
				</button>
				<button 
					class="transport-btn play-btn" 
					class:playing={isPlaying}
					on:click={() => dispatch('togglePlayback')} 
					title={isPlaying ? 'Stop' : 'Play'}
				>
					{#if isPlaying}
						<svg viewBox="0 0 18 18">
							<rect x="4" y="3" width="3" height="12" rx="1"/>
							<rect x="11" y="3" width="3" height="12" rx="1"/>
						</svg>
					{:else}
						<svg width="18" height="18" viewBox="0 0 18 18">
							<path d="M5 3L15 9L5 15V3Z" fill="currentColor"/>
						</svg>
					{/if}
				</button>


				<button 
					class="transport-btn record-btn" 
					on:click={() => dispatch('synthesizeAll')} 
					disabled={isSynthesizing} 
					title="Synthesize all notes"
				>
					<svg width="18" height="18" viewBox="0 0 18 18">
						<circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
						<circle cx="9" cy="9" r="3" fill="currentColor"/>
					</svg>
				</button>

				<button 
					class="transport-btn export-btn" 
					on:click={() => dispatch('download')} 
					title="Download WAV"
				>
					<svg width="18" height="18" viewBox="0 0 18 18">
						<path d="M9 2V12M9 12L6 9M9 12L12 9" stroke="currentColor" stroke-width="1.5" fill="none"/>
						<path d="M3 14V15C3 15.5 3.5 16 4 16H14C14.5 16 15 15.5 15 15V14" stroke="currentColor" stroke-width="1.5" fill="none"/>
					</svg>
				</button>
			</div>
		</div>
	</div>

	<div class="divider"></div>

	<div class="parameters-section">
		<div class="param-group">
			<label for="tempo">
				<svg width="14" height="14" viewBox="0 0 14 14">
					<circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1"/>
					<path d="M7 3V7L10 10" stroke="currentColor" stroke-width="1.5" fill="none"/>
				</svg>
				BPM
			</label>
			<div class="input-container">
				<input 
					type="number" 
					id="tempo" 
					min="30" 
					max="1000" 
					bind:value={tempo} 
					on:change={() => dispatch('tempoChange', { value: tempo })} 
				/>
			</div>
		</div>

		<div class="param-group">
			<label for="grid">
				<svg width="14" height="14" viewBox="0 0 14 14">
					<rect x="1" y="1" width="3" height="12" fill="currentColor" opacity="0.6"/>
					<rect x="5" y="1" width="3" height="12" fill="currentColor" opacity="0.8"/>
					<rect x="9" y="1" width="3" height="12" fill="currentColor"/>
				</svg>
				GRID
			</label>
			<div class="select-container">
				<select 
					id="grid" 
					bind:value={gridDivision} 
					on:change={() => dispatch('gridChange', { value: gridDivision })}
				>
					<option value={4}>1/4</option>
					<option value={8}>1/8</option>
					<option value={16}>1/16</option>
					<option value={32}>1/32</option>
				</select>
				<svg class="select-arrow" width="10" height="6" viewBox="0 0 10 6">
					<path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" fill="none"/>
				</svg>
			</div>
		</div>
	</div>

	<div class="divider"></div>

	<div class="editor-section">
		<div class="section-label">EDITOR</div>
		<div class="editor-modes">
			<button 
				class="mode-btn" 
				class:active={editorMode === 'select'} 
				on:click={() => dispatch('editorModeChange', { value: 'select' })} 
				title="Select / Text"
			>
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path d="M2 2L7 14L9 8L14 6L2 2Z" fill="currentColor"/>
				</svg>
			</button>

			<button 
				class="mode-btn" 
				class:active={editorMode === 'pitchbend'} 
				on:click={() => dispatch('editorModeChange', { value: 'pitchbend' })} 
				title="Pitchbend"
			>
				<svg width="16" height="16" viewBox="0 0 16 16">
					<path d="M2 8C2 8 4 4 8 8C12 12 14 8 14 8" stroke="currentColor" stroke-width="2" fill="none"/>
					<circle cx="4" cy="6" r="1.5" fill="currentColor"/>
					<circle cx="12" cy="10" r="1.5" fill="currentColor"/>
				</svg>
			</button>
		</div>
	</div>

	<!-- Settings and GitHub section -->
	<div class="actions-end">
		<button
			class="settings-btn"
			on:click={() => dispatch('openSettings')}
			title="Settings"
		>
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="3"></circle>
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
			</svg>
		</button>
		<div class="github-section">
			<a
				class="github-link"
				href="https://github.com/charl1e7/webtau"
				target="_blank"
				rel="noopener noreferrer"
				title="Open repository on GitHub"
			>
			<svg width="32" height="31" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M15.97 0C7.16 0 0 7.33 0 16.39c0 7.24 4.48 13.37 10.72 15.54.78.16 1.06-.35 1.06-.79 0-.38-.03-1.68-.03-3.06-4.36.98-5.27-1.97-5.27-1.97-.7-1.92-1.74-2.41-1.74-2.41-1.43-.99.1-.99.1-.99 1.58.11 2.41 1.7 2.41 1.7 1.4 2.52 3.66 1.81 4.57 1.37.13-1.07.55-1.81 1-2.22-3.48-.38-7.15-1.81-7.15-8.18 0-1.81.62-3.3 1.61-4.45-.16-.41-.7-2.11.16-4.39 0 0 1.33-.44 4.32 1.7a15.13 15.13 0 0 1 3.93-.52c1.33 0 2.69.18 3.93.52 2.99-2.14 4.32-1.7 4.32-1.7.86 2.28.31 3.98.16 4.39.99 1.15 1.61 2.64 1.61 4.45 0 6.37-3.67 7.77-7.18 8.18.57.52 1.06 1.51 1.06 3.07 0 2.22-.03 3.99-.03 4.54 0 .44.28.95 1.06.79 6.24-2.17 10.72-8.3 10.72-15.54C31.94 7.33 24.74 0 15.97 0z" fill="#9b9b9b"/></svg>
			</a>
		</div>
	</div>
</div>

<style>
	.controls-panel {
		display: flex;
		align-items: center;
		margin-top: 5px;
		margin-right: 10px;
		gap: 1.5rem;
		padding: 1rem 1.5rem;
		background:
			linear-gradient(145deg, #181818 0%, #222 30%, #111 100%),
			radial-gradient(circle at 20% 80%, rgba(255,255,255,0.04) 0%, transparent 50%),
			radial-gradient(circle at 80% 20%, rgba(255,255,255,0.03) 0%, transparent 50%);
		border: 1px solid #3d3d3d;
		border-radius: 16px;
		box-shadow:
			0 8px 32px rgba(0,0,0,0.6),
			0 2px 16px #222,
			inset 0 1px 0 rgba(255,255,255,0.05),
			inset 0 -1px 0 rgba(0,0,0,0.2);
		backdrop-filter: blur(20px);
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
		position: relative;
		overflow: hidden;
	}

	.controls-panel::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 1px;
		background: linear-gradient(90deg,
			transparent 0%,
			#333 20%,
			#444 50%,
			#333 80%,
			transparent 100%);
	}

	.transport-section {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.transport-group {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.transport-label {
		display: block;
		height: 1.2em;
		margin-bottom: 0.5rem;
		font-size: 0.7rem;
		color: #888;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 1px;
		visibility: hidden;
	}

	.transport-controls {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
		background: rgba(255,255,255,0.03);
		border-radius: 8px;
		border: 1px solid #333;
	}

	.transport-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 10px;
		width: 44px;
		height: 44px;
		background:
			linear-gradient(145deg, #222 0%, #181818 100%);
		border: 1px solid #333;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
		color: #bbb;
	}

	.transport-btn::before {
		content: '';
		position: absolute;
		top: 0;
		left: -100%;
		width: 100%;
		height: 100%;
		background: linear-gradient(90deg,
			transparent,
			#444 20%,
			transparent);
		transition: left 0.6s ease;
	}

	.transport-btn:hover::before {
		left: 100%;
	}

	.transport-btn:hover {
		background: linear-gradient(145deg, #333 0%, #181818 100%);
		border-color: #666;
		box-shadow:
			0 0 20px #222,
			0 4px 16px rgba(0,0,0,0.4);
		transform: translateY(-2px);
		color: #fff;
	}

	.transport-btn:active {
		transform: translateY(0);
		box-shadow:
			0 0 15px #444,
			inset 0 2px 4px rgba(0,0,0,0.3);
	}

	.transport-btn.playing {
		background:
			linear-gradient(145deg, #444 0%, #181818 100%);
		border-color: #888;
		box-shadow:
			0 0 25px #444,
			0 4px 20px #222;
		color: #fff;
		animation: pulse-mono 2s infinite;
	}

	@keyframes pulse-mono {
		0%, 100% { box-shadow: 0 0 25px #444, 0 4px 20px #222; }
		50% { box-shadow: 0 0 35px #666, 0 4px 25px #333; }
	}

	.transport-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		background: #181818;
		border-color: #222;
		color: #444;
	}

	.transport-btn:disabled:hover {
		transform: none;
		box-shadow: none;
		background: #181818;
	}

	.divider {
		width: 2px;
		height: 40px;
		background:
			linear-gradient(to bottom,
				transparent 0%,
				#333 20%,
				#444 50%,
				#333 80%,
				transparent 100%);
		border-radius: 1px;
		position: relative;
	}

	.divider::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 0;
		width: 1px;
		height: 100%;
		background: #222;
		transform: translateX(-50%);
	}

	.parameters-section {
		display: flex;
		gap: 2rem;
	}

	.param-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 80px;
	}

	.param-group label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
		color: #888;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.param-group label svg {
		color: #444;
	}

	.input-container,
	.select-container {
		position: relative;
	}

	.input-container input,
	.select-container select {
		width: 100%;
		background:
			linear-gradient(145deg, #222 0%, #181818 100%);
		border: 1px solid #333;
		border-radius: 6px;
		padding: 0.75rem 1rem;
		color: #fff;
		font-size: 0.9rem;
		font-weight: 600;
		transition: all 0.3s ease;
		box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
	}

	.select-container select {
		appearance: none;
		padding-right: 2.5rem;
		cursor: pointer;
	}

	.select-arrow {
		position: absolute;
		right: 1rem;
		top: 50%;
		transform: translateY(-50%);
		color: #444;
		pointer-events: none;
		transition: all 0.3s ease;
	}

	.input-container input:focus,
	.select-container select:focus {
		outline: none;
		box-shadow:
			0 0 0 3px #222,
			0 0 16px #333,
			inset 0 2px 4px rgba(0,0,0,0.2);
		background: linear-gradient(145deg, #333 0%, #181818 100%);
	}

	.select-container:hover .select-arrow {
		color: #fff;
		transform: translateY(-50%) scale(1.1);
	}

	.editor-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: center;
	}

	.section-label {
		font-size: 0.7rem;
		color: #888;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.editor-modes {
		display: flex;
		gap: 0.25rem;
		background: rgba(0,0,0,0.3);
		padding: 0.375rem;
		border-radius: 8px;
		border: 1px solid #333;
		box-shadow: inset 0 2px 8px rgba(0,0,0,0.3);
	}

	.mode-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 10px;
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		color: #bbb;
	}

	.mode-btn:hover {
		background: rgba(255,255,255,0.08);
		color: #fff;
		transform: scale(1.05);
	}

	.mode-btn.active {
		background:
			linear-gradient(145deg, #444 0%, #181818 100%);
		box-shadow:
			0 0 16px #444,
			inset 0 1px 0 rgba(255,255,255,0.2);
		color: #fff;
		transform: scale(1.05);
	}

	/* Responsive design */
	@media (max-width: 1024px) {
		.controls-panel {
			flex-wrap: wrap;
			gap: 1rem;
		}
		
		.parameters-section {
			gap: 1.5rem;
		}
		
		.divider {
			display: none;
		}
	}

	@media (max-width: 768px) {
		.controls-panel {
			padding: 0.75rem 1rem;
			gap: 0.75rem;
		}
		
		.transport-btn {
			width: 40px;
			height: 40px;
		}
		
		.parameters-section {
			gap: 1rem;
		}
		
		.param-group {
			min-width: 70px;
		}
	}

	.actions-end {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 10px;
		width: 44px;
		height: 44px;
		background: transparent;
		border: none;
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.3s ease;
		color: #bbb;
	}

	.settings-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
		transform: rotate(45deg);
	}

	.github-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.github-label {
		display: block;
		height: 1.2em;
		margin-bottom: 0.5rem;
		font-size: 0.7rem;
		color: #888;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	.github-link {
		display: flex;
		align-items: center;
		color: #bbb;
		transition: color 0.2s;
	}
	.github-link:hover {
		color: #fff;
	}
	.logo-icon {
		width: 48px;
		height: 48px;
		display: block;
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.logo-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem; 
	}

	.logo-label {
		font-size: 0.7rem;
		color: #888;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 1px;
		height: 1.2em; 
	}

	.logo-container {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.github-link svg {
		display: block;
		fill: currentColor;
	}
</style>