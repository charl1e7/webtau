<script lang="ts">
	import { setStatus, loadVoicebank } from '$lib/stores';
	import type { VoicebankInfo } from '$lib/types';
	import JSZip from 'jszip';

	let isLoading = false;
	let fileInput: HTMLInputElement;
	let isDragActive = false;
	let uploadMode: 'zip' | 'folder' = 'zip';

	
	interface VirtualFile {
		relativePath: string;
		getUint8Array: () => Promise<Uint8Array>;
		getBlob: () => Promise<Blob>;
	}

	function parseCharacterTxt(content: string): Map<string, string> {
		const info = new Map<string, string>();
		const lines = content.split(/\r?\n/);
		lines.forEach((line) => {
			const parts = line.split('=');
			if (parts.length >= 2) {
				const key = parts[0].trim();
				const value = parts.slice(1).join('=').trim();
				if (key && value) {
					info.set(key, value);
				}
			}
		});
		return info;
	}

	async function readDirectoryEntries(directoryEntry: FileSystemDirectoryEntry): Promise<File[]> {
		const reader = directoryEntry.createReader();
		const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
			reader.readEntries(resolve, reject);
		});

		const files: File[] = [];
		const directoryPromises: Promise<File[]>[] = [];

		for (const entry of entries) {
			if (entry.isFile) {
				files.push(
					await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
				);
			} else if (entry.isDirectory) {
				directoryPromises.push(readDirectoryEntries(entry as FileSystemDirectoryEntry));
			}
		}

		const subDirectoryFiles = await Promise.all(directoryPromises);
		return files.concat(...subDirectoryFiles);
	}

	async function processAndLoadVoicebank(files: VirtualFile[], voicebankName: string) {
		const otoPromises: Promise<Uint8Array>[] = [];
		const wavPromises: Promise<{ name: string; data: Uint8Array }>[] = [];
		let characterTxtFile: VirtualFile | null = null;
		let prefixMapFile: VirtualFile | null = null;
		files.forEach((file) => {
			const lowerPath = file.relativePath.toLowerCase();

			if (lowerPath.endsWith('oto.ini')) {
				otoPromises.push(file.getUint8Array());
			} else if (lowerPath.endsWith('.wav')) {
				wavPromises.push(
					(async () => {
						const data = await file.getUint8Array();
						const filename = file.relativePath.split('/').pop()!;
						return { name: filename, data };
					})()
				);
			} else if (lowerPath.endsWith('character.txt') && !characterTxtFile) {
				characterTxtFile = file;
			} else if (lowerPath.endsWith('prefix.map') && !prefixMapFile) {
				prefixMapFile = file;
			}
		});

		const otos = await Promise.all(otoPromises);
		if (otos.length === 0) {
			throw new Error('No oto.ini files found.');
		}
		setStatus('Merging oto.ini...');
		const otoStrings: string[] = [];
		const decoder = new TextDecoder('shift-jis', { fatal: false });
		for (const otoBuffer of otos) {
			try {
				otoStrings.push(decoder.decode(otoBuffer));
			} catch {
				console.warn('Failed to decode oto.ini as Shift-JIS, trying UTF-8...');
				otoStrings.push(new TextDecoder('utf-8').decode(otoBuffer));
			}
		}
		const combinedOtoString = otoStrings.join('\n');
		const otoDataUtf8 = new TextEncoder().encode(combinedOtoString);

		const prefixMapData = prefixMapFile ? await prefixMapFile.getUint8Array() : null;
		let voicebankInfo: VoicebankInfo = {
			id: `vb-${Date.now()}`,
			name: voicebankName
		};

		if (characterTxtFile) {
			setStatus('Processing character.txt...');
			const charBuffer = await characterTxtFile.getUint8Array();
			const charString = new TextDecoder('shift-jis', { fatal: false }).decode(charBuffer);
			const charInfo = parseCharacterTxt(charString);

			voicebankInfo.characterInfo = charInfo;
			if (charInfo.has('name')) {
				voicebankInfo.name = charInfo.get('name')!;
			}

			if (charInfo.has('image')) {
				const imageName = charInfo.get('image')!;
				const charTxtDir = characterTxtFile.relativePath.includes('/')
					? characterTxtFile.relativePath.substring(0, characterTxtFile.relativePath.lastIndexOf('/') + 1)
					: '';
				const imagePath = charTxtDir + imageName;
				
				const imageFile = files.find(f => f.relativePath.toLowerCase().replace(/\\/g, '/') === imagePath.toLowerCase().replace(/\\/g, '/'));

				if (imageFile) {
					setStatus(`Loading icon: ${imageName}...`);
					const imageBlob = await imageFile.getBlob();
					voicebankInfo.image = URL.createObjectURL(imageBlob);
				} else {
					console.warn(`Icon file "${imagePath}" not found.`);
				}
			}
		}
		setStatus('Collecting WAV files...');
		const wavFiles = await Promise.all(wavPromises);
		if (wavFiles.length === 0) {
			throw new Error('No .wav files found in the archive.');
		}
		await loadVoicebank(voicebankInfo, otoDataUtf8, wavFiles, prefixMapData);
	}
	
	async function handleInput(items: FileList | DataTransferItemList) {
		if (isLoading) return;
		isLoading = true;

		try {
			let virtualFiles: VirtualFile[] = [];
			let voicebankName = 'voicebank';
			if (items instanceof FileList) {
				if (items.length === 0) {
					isLoading = false;
					return;
				}
				const firstItem = items[0];

				if (items.length === 1 && firstItem.name.toLowerCase().endsWith('.zip')) {
					voicebankName = firstItem.name.replace(/\.zip$/i, '');
					setStatus(`Unpacking archive "${firstItem.name}"...`);
					const zip = await JSZip.loadAsync(firstItem);
					zip.forEach((relativePath, zipEntry) => {
						if (!zipEntry.dir) {
							virtualFiles.push({
								relativePath: relativePath,
								getUint8Array: () => zipEntry.async('uint8array'),
								getBlob: () => zipEntry.async('blob')
							});
						}
					});
				} 
				else if (firstItem.webkitRelativePath) {
					const rootDir = firstItem.webkitRelativePath.split('/')[0];
					voicebankName = rootDir;
					setStatus(`Reading folder "${rootDir}"...`);
					for (const file of Array.from(items)) {
						virtualFiles.push({
							relativePath: file.webkitRelativePath,
							getUint8Array: async () => new Uint8Array(await file.arrayBuffer()),
							getBlob: () => Promise.resolve(file)
						});
					}
				} else {
					throw new Error('Please select a ZIP archive or a folder.');
				}
			}
			else if (items instanceof DataTransferItemList) {
				if (items.length === 0) {
					isLoading = false;
					return;
				}
				const item = items[0].webkitGetAsEntry();
				if (!item) throw new Error('Could not process the dragged item.');

				if (item.isFile && item.name.toLowerCase().endsWith('.zip')) {
					const file = await new Promise<File>((resolve, reject) => (item as FileSystemFileEntry).file(resolve, reject));
					voicebankName = file.name.replace(/\.zip$/i, '');
					setStatus(`Unpacking archive "${file.name}"...`);
					const zip = await JSZip.loadAsync(file);
					zip.forEach((relativePath, zipEntry) => {
						if (!zipEntry.dir) {
							virtualFiles.push({
								relativePath: relativePath,
								getUint8Array: () => zipEntry.async('uint8array'),
								getBlob: () => zipEntry.async('blob')
							});
						}
					});
				} else if (item.isDirectory) {
					voicebankName = item.name;
					setStatus(`Reading folder "${item.name}"...`);
					const files = await readDirectoryEntries(item as FileSystemDirectoryEntry);
					const rootDir = files[0].webkitRelativePath.split('/')[0] || item.name;
					for (const file of files) {
						const relativePath = file.webkitRelativePath.substring(rootDir.length > 0 ? rootDir.length + 1 : 0);
						virtualFiles.push({
							relativePath: relativePath,
							getUint8Array: async () => new Uint8Array(await file.arrayBuffer()),
							getBlob: () => Promise.resolve(file)
						});
					}
				} else {
					throw new Error('Please drag a ZIP archive or a folder.');
				}
			}

			if (virtualFiles.length > 0) {
				await processAndLoadVoicebank(virtualFiles, voicebankName);
			}

		} catch (error) {
			console.error('Voicebank processing error:', error);
			setStatus(`Error: ${(error as Error).message}`);
		} finally {
			isLoading = false;
			if (fileInput) fileInput.value = '';
		}
	}


	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (!isLoading) isDragActive = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		event.stopPropagation();
		isDragActive = false;
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		event.stopPropagation();
		isDragActive = false;
		if (isLoading || !event.dataTransfer) return;
		await handleInput(event.dataTransfer.items);
	}

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files) return;
		await handleInput(input.files);
	}
</script>

<div class="voicebank-loader"
	on:dragover={handleDragOver}
	on:dragleave={handleDragLeave}
	on:drop={handleDrop}
	class:drag-active={isDragActive}
>
	<div class="loader-content">
		<div class="upload-mode-toggle" class:folder-active={uploadMode === 'folder'}>
			<button 
				class="toggle-button" 
				class:active={uploadMode === 'zip'}
				on:click={() => uploadMode = 'zip'}
				disabled={isLoading}
			>
				ZIP Archive
			</button>
			<button 
				class="toggle-button" 
				class:active={uploadMode === 'folder'}
				on:click={() => uploadMode = 'folder'}
				disabled={isLoading}
			>
				Folder
			</button>
			<div class="toggle-slider" />
		</div>
		
		<label 
			for="voicebank-input" 
			class="file-input-label" 
			class:loading={isLoading}
			class:disabled={isLoading}
			class:drag-active={isDragActive}
		>
			<div class="label-content">
				<div class="upload-icon">
					{#if isLoading}
						<svg width="24" height="24" viewBox="0 0 24 24" class="loading-spinner">
							<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3"/>
							<path d="M12 2C17.5 2 22 6.5 22 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
						</svg>
					{:else}
						<svg width="24" height="24" viewBox="0 0 24 24">
							<path d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15" stroke="currentColor" stroke-width="2" fill="none"/>
							<path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" fill="none"/>
							<path d="M12 15V3" stroke="currentColor" stroke-width="2" fill="none"/>
						</svg>
					{/if}
				</div>
				<div class="label-text">
					{#if isLoading}
						<span class="main-text">Processing...</span>
						<span class="sub-text">Please wait</span>
					{:else}
						{#if uploadMode === 'zip'}
							<span class="sub-text">Drag a file or click</span>
						{:else}
							<span class="sub-text">Drag a folder or click</span>
						{/if}
					{/if}
				</div>
			</div>

			<input
				id="voicebank-input"
				type="file"
				accept={uploadMode === 'zip' ? '.zip' : undefined}
				webkitdirectory={uploadMode === 'folder'}
				on:change={handleFileSelect}
				bind:this={fileInput}
				disabled={isLoading}
			/>
		</label>
	</div>
</div>

<style>
	
	.upload-mode-toggle {
		display: flex;
		position: relative;
		background-color: #1a1a1a;
		border-radius: 8px;
		margin-bottom: 10px;
		margin-top: 10px;
		border: 1px solid #333;
		padding: 4px;
	}

	.toggle-slider {
		position: absolute;
		top: 4px;
		left: 4px;
		width: calc(50% - 4px);
		height: calc(100% - 8px);
		background: linear-gradient(145deg, #444, #2a2a2a);
		border-radius: 6px;
		box-shadow: 0 1px 3px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.05);
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		z-index: 0;
	}

	.upload-mode-toggle.folder-active .toggle-slider {
		transform: translateX(calc(100% + 0px));
	}

	.toggle-button {
		padding: 5px;
		flex: 1;
		border: none;
		background-color: transparent;
		color: #aaa;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
		border-radius: 6px;
		transition: color 0.3s ease;
		position: relative;
		z-index: 1;
		outline: none;
	}

	.toggle-button:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.toggle-button.active {
		color: #fff;
	}

	
	.voicebank-loader {
		background: 
			linear-gradient(145deg, #181818 0%, #222 30%, #111 100%),
			radial-gradient(circle at 20% 80%, rgba(255,255,255,0.04) 0%, transparent 50%),
			radial-gradient(circle at 80% 20%, rgba(255,255,255,0.03) 0%, transparent 50%);
		border: 1px solid #222;
		border-radius: 12px;
		box-shadow: 
			0 8px 32px rgba(0,0,0,0.6),
			0 2px 16px #222,
			inset 0 1px 0 rgba(255,255,255,0.05),
			inset 0 -1px 0 rgba(0,0,0,0.2);
		backdrop-filter: blur(20px);
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
		position: relative;
		overflow: hidden;
		margin: 1rem 0;
	}

	.loader-content {
		padding: 1.5rem;
		padding-top: 0;
	}

	.file-input-label {
		display: block;
		width: 100%;
		background: linear-gradient(145deg, #222 0%, #181818 100%);
		border: 2px dashed #333;
		border-radius: 12px;
		padding: 1rem 1rem;
		cursor: pointer;
		transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
		text-align: center;
	}

	
	.file-input-label::before {
		content: '';
		position: absolute;
		top: 0;
		left: -100%;
		width: 100%;
		height: 100%;
		background: linear-gradient(90deg, transparent, #444 15%, transparent);
		transition: left 0.8s ease;
	}

	.file-input-label:hover::before {
		left: 100%;
	}

	.file-input-label:hover:not(.disabled) {
		background: linear-gradient(145deg, #333 0%, #181818 100%);
		border-color: #666;
		box-shadow: 0 0 30px #222, 0 8px 32px rgba(0,0,0,0.4);
		transform: translateY(-2px);
	}

	.file-input-label.loading {
		border-color: #888;
		background: linear-gradient(145deg, #333 0%, #181818 100%);
		box-shadow: 0 0 25px #444, inset 0 0 20px #222;
	}

	.file-input-label.disabled {
		cursor: not-allowed;
		opacity: 0.8;
	}

	.file-input-label.drag-active {
		border-color: #00bfff;
		background: linear-gradient(145deg, #222 0%, #1a237e 100%);
		box-shadow: 0 0 40px #00bfff, 0 8px 32px rgba(0,191,255,0.2);
	}

	.voicebank-loader.drag-active {
		box-shadow: 0 0 60px #00bfff, 0 8px 32px rgba(0,191,255,0.2);
	}

	.label-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		position: relative;
		z-index: 1;
	}

	.upload-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%);
		border: 2px solid #333;
		border-radius: 50%;
		color: #bbb;
		transition: all 0.3s ease;
	}

	.file-input-label:hover .upload-icon {
		background: radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%);
		border-color: #666;
		box-shadow: 0 0 20px #222;
		transform: scale(1.05);
	}

	.loading-spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.label-text {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		text-align: center;
	}

	.main-text {
		font-size: 1rem;
		font-weight: 600;
		color: #fff;
		text-shadow: 0 0 10px #222;
	}

	.sub-text {
		font-size: 0.85rem;
		color: #aaa;
		font-weight: 400;
	}

	input[type="file"] {
		display: none;
	}

	/* Responsive design */
	@media (max-width: 768px) {
		.loader-content {
			padding: 1rem;
		}
		
		.file-input-label {
			padding: 1.5rem 1rem;
		}
		
		.upload-icon {
			width: 48px;
			height: 48px;
		}
		
		.main-text {
			font-size: 0.9rem;
		}
		
		.sub-text {
			font-size: 0.8rem;
		}
	}
</style>