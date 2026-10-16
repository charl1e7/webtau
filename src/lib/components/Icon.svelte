<script module lang="ts">
	const PATHS = {
		play: 'M7 4.5v15l12-7.5z',
		pause: 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z',
		stop: 'M6 6h12v12H6z',
		rewind: 'M6 5v14M19 5.5v13L9 12z',
		undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
		redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
		menu: 'M4 6h16M4 12h16M4 18h16',
		more: 'M5 12h.01M12 12h.01M19 12h.01',
		close: 'M6 6l12 12M18 6 6 18',
		check: 'm5 12.5 4.5 4.5L19 7.5',
		plus: 'M12 5v14M5 12h14',
		minus: 'M5 12h14',
		settings:
			'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
		cursor: 'M5 3l14 7-6 2-2 6z',
		pencil: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
		curve: 'M3 17c4 0 4-10 9-10s5 10 9 10',
		eraser:
			'M19 20H8l-4-4a2 2 0 0 1 0-2.8L13 4a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L12 18.5M9 8l7 7',
		trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
		copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
		paste: 'M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2',
		scissors:
			'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
		duplicate: 'M8 8h12v12H8zM4 16V4h12',
		folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
		file: 'M6 3h8l5 5v13H6zM14 3v5h5',
		save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7',
		download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
		upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
		mic: 'M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
		sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
		grid: 'M4 4h16v16H4zM4 12h16M12 4v16',
		magnet: 'M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4',
		zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3M11 8v6M8 11h6',
		zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3M8 11h6',
		stretch: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
		arrowUp: 'M12 19V5M6 11l6-6 6 6',
		arrowDown: 'M12 5v14M6 13l6 6 6-6',
		chevronRight: 'm9 6 6 6-6 6',
		chevronDown: 'm6 9 6 6 6-6',
		alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
		music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
		text: 'M5 6V4h14v2M12 4v16M9 20h6',
		keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
		info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01',
		sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
		split: 'M12 3v18M6 8l-4 4 4 4M18 8l4 4-4 4',
		join: 'M3 12h6M15 12h6M9 8l3 4-3 4M15 8l-3 4 3 4',
		wave: 'M2 12h2l2-6 3 12 3-16 3 14 2-8h5'
	} as const;

	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let {
		name,
		size = 20,
		stroke = 1.8
	}: { name: IconName; size?: number; stroke?: number } = $props();

	const filled = $derived(name === 'play' || name === 'pause' || name === 'stop');
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={filled ? 'currentColor' : 'none'}
	stroke={filled ? 'none' : 'currentColor'}
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={PATHS[name]} />
</svg>
