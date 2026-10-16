<script lang="ts">
	import '../app.css';
	import { settings } from '#lib/state/settings.svelte';
	import { ui } from '#lib/state/ui.svelte';

	let { children } = $props();

	$effect(() => {
		document.documentElement.dataset.theme = settings.data.theme;
		document.documentElement.dataset.touch = String(ui.touch);
	});
</script>

<svelte:head>
	<title>WebTAU — UTAU in your browser</title>
	<meta name="description" content="A browser-based vocal synthesizer for UTAU voicebanks." />
	<meta name="theme-color" content="#16181d" />
	<meta
		name="viewport"
		content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
	/>
</svelte:head>

{@render children()}
