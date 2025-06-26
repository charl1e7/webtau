<script lang="ts">
	export let status: string;
	export let synthesisMessage: string;
</script>

<div class="status-bar">
	<strong>Status:</strong>
	<span>{synthesisMessage || status}</span>
</div>

<style>
	
</style>