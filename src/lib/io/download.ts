export function downloadBlob(data: BlobPart, filename: string, type = 'application/octet-stream') {
	const url = URL.createObjectURL(new Blob([data], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'webtau';
}
