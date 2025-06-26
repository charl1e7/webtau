<script lang="ts">
	import { settings, closeSettingsModal } from '$lib/stores';

	let activeTab: 'project' | 'pianoRoll' = 'pianoRoll';
</script>

<div class="modal-overlay" on:click={closeSettingsModal} role="dialog" aria-modal="true">
	<div class="modal-content" on:click|stopPropagation role="document">
		<header class="modal-header">
			<h2 class="modal-title">Settings</h2>
			<button class="close-button" on:click={closeSettingsModal} aria-label="Close">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</header>
		<main class="modal-body">
			<div class="tabs">
				<button class:active={activeTab === 'project'} on:click={() => (activeTab = 'project')}>
					Project
				</button>
				<button class:active={activeTab === 'pianoRoll'} on:click={() => (activeTab = 'pianoRoll')}>
					Piano Roll
				</button>
			</div>

			<div class="tab-content">
				{#if activeTab === 'project'}
				<div class="tab-pane">
					<div class="form-group">
						<label for="coreCount">Number of cores for analysis</label>
						<input
							type="number"
							id="coreCount"
							class="setting-input"
							bind:value={$settings.project.analysisCoreCount}
							min="0"
						/>
						<p class="input-description">
							Specifies the number of parallel threads for WAV file analysis.
							Set to 0 for automatic detection (recommended).
						</p>
					</div>
				</div>
				{:else if activeTab === 'pianoRoll'}
					<div class="tab-pane">
						<div class="form-group">
							<label for="defaultLyric">Default lyric for new notes</label>
							<input
								type="text"
								id="defaultLyric"
								class="setting-input"
								bind:value={$settings.pianoRoll.defaultLyric}
							/>
							<p class="input-description">
								This text will be automatically inserted into new notes created in the piano roll.
							</p>
						</div>
						<div class="form-group">
							<label for="playbackMode">Playback start mode</label>
							<select id="playbackMode" class="setting-input" bind:value={$settings.pianoRoll.playbackStartMode}>
								<option value="from_start">Always from start</option>
								<option value="resume">From last stop</option>
								<option value="from_marker">From click (marker) position</option>
							</select>
							<p class="input-description">
								Determines where playback will start when you press "Play".
							</p>
						</div>
						<div class="form-group-checkbox">
							<label for="reRenderOnPlay">
								<input
									type="checkbox"
									id="reRenderOnPlay"
									class="setting-checkbox"
									bind:checked={$settings.pianoRoll.reRenderOnPlay}
								/>
								<span>Re-render on every playback</span>
							</label>
							<p class="input-description">
								If enabled, a full audio synthesis will be performed every time you press "Play". Otherwise, the last rendered result will be played.
							</p>
						</div>
					</div>
				{/if}
			</div>
		</main>
		<footer class="modal-footer">
			<button class="confirm-button" on:click={closeSettingsModal}>Close</button>
		</footer>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(5px);
	}

	.modal-content {
		background: #2b2b2b;
		color: var(--text-color);
		border-radius: 12px;
		width: 90%;
		max-width: 600px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		border: 1px solid #444;
		display: flex;
		flex-direction: column;
		max-height: 80vh;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border-color);
	}

	.modal-title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
	}

	.close-button {
		background: none;
		border: none;
		color: var(--muted-text-color);
		cursor: pointer;
		padding: 0.5rem;
		border-radius: 50%;
		transition: background-color 0.2s, color 0.2s;
	}

	.close-button:hover {
		background-color: #444;
		color: var(--text-color);
	}

	.modal-body {
		padding: 1rem 1.5rem;
		overflow-y: auto;
		flex-grow: 1;
	}

	.tabs {
		display: flex;
		border-bottom: 1px solid var(--border-color);
		margin-bottom: 1.5rem;
	}

	.tabs button {
		background: none;
		border: none;
		padding: 0.8rem 1.2rem;
		font-size: 1rem;
		font-weight: 500;
		color: var(--muted-text-color);
		cursor: pointer;
		position: relative;
		transition: color 0.2s;
	}

	.tabs button:hover {
		color: var(--text-color);
	}

	.tabs button.active {
		color: var(--primary-color);
	}

	.tabs button.active::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: 0;
		right: 0;
		height: 2px;
		background-color: var(--primary-color);
	}

	.tab-pane {
		padding: 0.5rem 0;
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	.form-group label {
		display: block;
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	.setting-input {
		width: 100%;
		padding: 0.75rem;
		background-color: #1e1e1e;
		border: 1px solid #444;
		border-radius: 6px;
		color: var(--text-color);
		font-size: 1rem;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.setting-input:focus {
		outline: none;
		border-color: var(--primary-color);
		box-shadow: 0 0 0 2px rgba(233, 30, 99, 0.3);
	}

	.input-description {
		font-size: 0.85rem;
		color: var(--muted-text-color);
		margin-top: 0.5rem;
	}
	
	.placeholder-text {
		color: var(--muted-text-color);
		font-style: italic;
	}

	.modal-footer {
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border-color);
		display: flex;
		justify-content: flex-end;
	}

	.confirm-button {
		background-color: var(--primary-color);
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 6px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.confirm-button:hover {
		background-color: var(--primary-hover-color);
	}

	.form-group-checkbox {
        margin-bottom: 1.5rem;
    }

    .form-group-checkbox label {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        cursor: pointer;
		font-weight: 600;
    }
	.form-group-checkbox span {
		font-size: 1rem;
	}

    .setting-checkbox {
        width: 1.25em;
        height: 1.25em;
        border-radius: 4px;
        background-color: #1e1e1e;
        border: 1px solid #444;
        accent-color: var(--primary-color);
        cursor: pointer;
		flex-shrink: 0;
    }
</style>