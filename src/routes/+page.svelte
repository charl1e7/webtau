<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import {
		appState,
		initializeClient,
		togglePlayback,
		startSynthesis,
		deleteSelectedNotes,
		setEditorMode,
		downloadWav,
		setTempo,
		setGridDivision,
		openSettingsModal,
		setPlaybackTime
	} from '$lib/stores';

	import VoicebankLoader from '$lib/components/VoicebankLoader.svelte';
	import PianoRoll from '$lib/components/PianoRoll.svelte';
	import ControlsPanel from '$lib/components/ControlsPanel.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';

	let leftPanelHidden = false;
	function toggleLeftPanel() {
		leftPanelHidden = !leftPanelHidden;
	}

	onMount(() => {
		initializeClient();
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Delete' && $appState.selectedNoteIds.size > 0) {
				deleteSelectedNotes();
				event.preventDefault();
			}
			if (event.key === ' ' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
				event.preventDefault();
				togglePlayback();
			}
		}
		if (browser) {
			window.addEventListener('keydown', handleKeyDown);
		}
		return () => {
			if (browser) {
				window.removeEventListener('keydown', handleKeyDown);
			}
		};
	});
</script>

<div id="app">
	<ControlsPanel
		on:togglePlayback={togglePlayback}
		on:synthesizeAll={startSynthesis}
		on:download={downloadWav}
		on:openSettings={openSettingsModal}
		on:goToStart={() => setPlaybackTime(0)}
		isPlaying={$appState.playback.isPlaying}
		isSynthesizing={$appState.synthesis.isSynthesizing}
		tempo={$appState.tempo}
		gridDivision={$appState.gridDivision}
		editorMode={$appState.editorMode}
		on:tempoChange={e => setTempo(e.detail.value)}
		on:gridChange={e => setGridDivision(e.detail.value)}
		on:editorModeChange={e => setEditorMode(e.detail.value)}
	/>

	<div class="main-layout">
		{#if !leftPanelHidden}
			<div class="left-panel">
				{#if $appState.currentVoicebank}
					<div class="voicebank-info">
						<div class="voicebank-header">
							<h4>CURRENT VOICEBANK</h4>
						</div>
						
						<div class="voicebank-content">
							{#if $appState.currentVoicebank.image}
								<div class="voicebank-image-container">
									<img 
										src={$appState.currentVoicebank.image} 
										alt="Icon for {$appState.currentVoicebank.name}" 
										class="voicebank-icon" 
									/>
									<div class="image-glow"></div>
								</div>
							{/if}
							<div class="voicebank-name">
								{#if $appState.currentVoicebank.name.length > 15}
									{$appState.currentVoicebank.name.slice(0, 12) + '...'}
								{:else}
									{$appState.currentVoicebank.name}
								{/if}
							</div>
							
						</div>
					</div>
				{:else}
					<div class="no-voicebank">
						<div class="no-voicebank-icon">
							<svg width="32" height="32" viewBox="0 0 32 32">
								<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3"/>
								<path d="M12 12L20 20M20 12L12 20" stroke="currentColor" stroke-width="2" opacity="0.5"/>
							</svg>
						</div>
						<p>Voicebank not loaded</p>
					</div>
				{/if}
				
				<div class="divider"></div>
				<VoicebankLoader />
			</div>
		{/if}
		<div class="splitter">
			{#if leftPanelHidden}
				<button class="show-panel-btn" on:click={toggleLeftPanel} title="Show panel">
					<svg width="20" height="40" viewBox="0 0 20 40" fill="none" xmlns="http://www.w3.org/2000/svg">
						<polyline points="7,10 13,20 7,30" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
			{:else}
				<button class="hide-panel-btn" on:click={toggleLeftPanel} title="Hide panel">
					<svg width="20" height="40" viewBox="0 0 20 40" fill="none" xmlns="http://www.w3.org/2000/svg">
						<polyline points="13,10 7,20 13,30" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
			{/if}
		</div>
		<div class="piano-roll-container" style="flex: 1 1 0;">
			<PianoRoll notes={$appState.notes} selectedNoteIds={$appState.selectedNoteIds} />
		</div>
	</div>

	<StatusBar status={$appState.status} synthesisMessage={$appState.synthesis.statusMessage} />

	{#if $appState.isSettingsModalOpen}
        <SettingsModal />
    {/if}
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: 
			radial-gradient(ellipse at top, #181818 0%, #000 100%),
			linear-gradient(145deg, #181818 0%, #222 30%, #111 100%);
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
		overflow: hidden;
	}

	#app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: 
			radial-gradient(circle at 20% 80%, rgba(255,255,255,0.02) 0%, transparent 50%),
			radial-gradient(circle at 80% 20%, rgba(255,255,255,0.01) 0%, transparent 50%);
		position: relative;
	}

	#app::before {
		content: '';
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: 
			radial-gradient(600px circle at 50% 0%, rgba(255,255,255,0.03), transparent),
			radial-gradient(800px circle at 100% 100%, rgba(255,255,255,0.01), transparent);
		pointer-events: none;
		z-index: -1;
	}

	.main-layout {
		display: flex;
		flex-direction: row;
		height: 100%;
		position: relative;
	}

	.left-panel {
		margin-top: 10px;
		background: 
			linear-gradient(145deg, #181818 0%, #222 30%, #111 100%),
			radial-gradient(circle at 20% 80%, rgba(255,255,255,0.04) 0%, transparent 50%);
		border-top-left-radius: 12px;
		border: 12px;
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
		min-width: 120px;
		max-width: 600px;
		width: 320px;
		box-shadow: 
			4px 0 32px rgba(0,0,0,0.6),
			2px 0 16px rgba(0,0,0,0.1),
			inset -1px 0 0 #222;
		position: relative;
		backdrop-filter: blur(20px);
		border: 1px solid #3d3d3d;
		border-radius: 16px;

	}

	.left-panel::before {
		content: '';
		position: absolute;
		top: 0;
		right: 0;
		width: 2px;
		height: 100%;
		background: linear-gradient(to bottom, transparent 0%, #444 20%, #888 50%, #444 80%, transparent 100%);
		box-shadow: 0 0 20px #222;
	}

	.voicebank-info {
		background: 
			linear-gradient(145deg, #222 0%, #181818 100%),
			radial-gradient(circle at 50% 0%, rgba(255,255,255,0.05) 0%, transparent 70%);
		border: 1px solid #333;
		border-radius: 16px;
		margin: 0.3rem;
		overflow: hidden;
		box-shadow: 
			0 12px 48px rgba(0,0,0,0.5),
			0 4px 24px #222,
			inset 0 1px 0 rgba(255,255,255,0.04),
			inset 0 -1px 0 rgba(0,0,0,0.2);
		position: relative;
		backdrop-filter: blur(20px);
	}

	.voicebank-info::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent 0%, #444 20%, #888 50%, #444 80%, transparent 100%);
		box-shadow: 0 0 16px #222;
	}

	.voicebank-info::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.01) 50%, transparent 70%);
		border-radius: 16px;
		pointer-events: none;
	}

	.voicebank-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1rem;
		border-bottom: 1px solid #222;
		background: 
			linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.1) 100%),
			rgba(0,0,0,0.2);
		position: relative;
	}

	.voicebank-header::before {
		content: '';
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 1px;
		background: linear-gradient(90deg, transparent 0%, #444 50%, transparent 100%);
	}

	.voicebank-header .header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: linear-gradient(145deg, #444 0%, #222 100%);
		border-radius: 8px;
		color: white;
		box-shadow: 0 0 20px #222, 0 4px 16px #222, inset 0 1px 0 rgba(255,255,255,0.1);
		position: relative;
		overflow: hidden;
	}

	.voicebank-header .header-icon::before {
		content: '';
		position: absolute;
		top: -50%;
		left: -50%;
		width: 200%;
		height: 200%;
		background: linear-gradient(45deg, transparent, rgba(255,255,255,0.08), transparent);
		animation: shine 3s infinite;
	}

	@keyframes shine {
		0% { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
		100% { transform: translateX(100%) translateY(100%) rotate(45deg); }
	}

	.voicebank-header h4 {
		margin: 0;
		font-size: 0.8rem;
		color: #eee;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 1.5px;
		text-shadow: 0 0 10px #222;
	}

	.voicebank-content {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		text-align: center;
		position: relative;
	}

	.voicebank-name {
		font-size: 1.3rem;
		font-weight: 700;
		color: #fff;
		text-shadow: 0 0 20px #222, 0 2px 8px rgba(0,0,0,0.3);
		background: linear-gradient(135deg, #fff 0%, #bbb 50%, #fff 100%);
		background-size: 200% 100%;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		animation: gradient-text 4s ease-in-out infinite;
		position: relative;
	}

	@keyframes gradient-text {
		0%, 100% { background-position: 0% 50%; }
		50% { background-position: 100% 50%; }
	}

	.voicebank-image-container {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.voicebank-icon {
		width: 80px;
		height: 80px;
		border-radius: 16px;
		border: 2px solid #333;
		box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 40px #222, inset 0 1px 0 rgba(255,255,255,0.1);
		transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		z-index: 2;
	}

	.voicebank-icon:hover {
		transform: scale(1.05) rotate(2deg);
		box-shadow: 0 12px 48px rgba(0,0,0,0.5), 0 0 60px #222, inset 0 1px 0 rgba(255,255,255,0.2);
	}

	.image-glow {
		position: absolute;
		inset: -10px;
		background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%);
		border-radius: 50%;
		animation: glow-pulse 3s ease-in-out infinite;
		z-index: 1;
	}

	@keyframes glow-pulse {
		0%, 100% { transform: scale(1); opacity: 0.5; }
		50% { transform: scale(1.2); opacity: 0.8; }
	}

	.no-voicebank {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 1rem 2rem;
		text-align: center;
		color: #bbb;
		background: linear-gradient(145deg, rgba(26,26,26,0.5) 0%, rgba(10,10,10,0.8) 100%);
		border: 1px dashed #333;
		border-radius: 16px;
		margin: 1.5rem;
		position: relative;
		transition: all 0.3s ease;
	}

	.no-voicebank:hover {
		border-color: #666;
		background: linear-gradient(145deg, rgba(42,42,42,0.3) 0%, rgba(26,26,26,0.6) 100%);
	}

	.no-voicebank::before {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03) 0%, transparent 70%);
		border-radius: 16px;
		pointer-events: none;
	}

	.no-voicebank-icon {
		margin-bottom: 1rem;
		color: #888;
		opacity: 0.8;
	}

	.no-voicebank p {
		margin: 0 0 0.5rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #eee;
	}

	.no-voicebank span {
		font-size: 0.85rem;
		color: #aaa;
		font-weight: 500;
	}

	.divider {
		height: 2px;
		background: linear-gradient(90deg, transparent 0%, #444 20%, #888 50%, #444 80%, transparent 100%);
		border-radius: 1px;
		position: relative;
	}

	.divider::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 1px;
		background: rgba(255,255,255,0.08);
		transform: translateY(-50%);
	}

	.splitter {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 5px;
		position: relative;
		transition: all 0.3s ease;
	}

	.show-panel-btn, .hide-panel-btn {
		background: none;
		border: none;
		box-shadow: none;
		width: 10px;
		height: 20px;
		padding: 0;
		margin: 0;
		margin-left: 5px;
		color: #bbb;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.2s;
	}

	.show-panel-btn:hover, .hide-panel-btn:hover {
		color: #fff;
	}

	.piano-roll-container {
		background: linear-gradient(135deg, #181818 0%, #222 100%);
		border: 1px solid #222;
		border-radius: 12px;
		margin: 0.5rem;
		overflow: hidden;
		position: relative;
		box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.3);
	}

	.piano-roll-container::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent 0%, #444 20%, #888 50%, #444 80%, transparent 100%);
	}

	/* Scrollbar styling */
	.left-panel::-webkit-scrollbar {
		width: 8px;
	}

	.left-panel::-webkit-scrollbar-track {
		background: rgba(0, 0, 0, 0.2);
		border-radius: 4px;
	}

	.left-panel::-webkit-scrollbar-thumb {
		background: 
			linear-gradient(180deg, #ff1493 0%, #c71585 100%);
		border-radius: 4px;
		box-shadow: 0 0 8px rgba(255, 20, 147, 0.3);
	}

	.left-panel::-webkit-scrollbar-thumb:hover {
		background: 
			linear-gradient(180deg, #ff69b4 0%, #ff1493 100%);
		box-shadow: 0 0 12px rgba(255, 20, 147, 0.5);
	}

	/* Responsive design */
	@media (max-width: 1024px) {
		.left-panel {
			width: 280px;
		}
		
		.voicebank-info {
			margin: 1rem;
		}
		
		.voicebank-content {
			padding: 1.5rem;
		}
	}

	@media (max-width: 768px) {
		.left-panel {
			width: 260px;
			min-width: 260px;
		}
		
		.voicebank-header {
			padding: 1rem 1.5rem;
		}
		
		.voicebank-content {
			padding: 1rem;
		}
		
		.voicebank-icon {
			width: 64px;
			height: 64px;
		}
		
		.divider {
			margin: 1rem 1.5rem;
		}
	}

	@media (max-width: 640px) {
		.main-layout {
			flex-direction: column;
		}
		
		.left-panel {
			width: 100%;
			height: auto;
			max-height: 40vh;
			border-right: none;
			border-bottom: 2px solid rgba(255, 20, 147, 0.2);
		}
		
		.splitter {
			display: none;
		}
		
		.piano-roll-container {
			flex: 1;
		}
	}
</style>