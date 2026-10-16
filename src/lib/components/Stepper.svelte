<script lang="ts">
	interface Props {
		value: number | undefined;
		min?: number;
		max?: number;
		step?: number;
		/** Shown when the selection has different values. */
		mixed?: boolean;
		suffix?: string;
		onchange: (value: number) => void;
		label?: string;
	}
	let {
		value,
		min = -Infinity,
		max = Infinity,
		step = 1,
		mixed = false,
		suffix = '',
		onchange,
		label
	}: Props = $props();

	const clampValue = (v: number) => Math.min(max, Math.max(min, v));

	function commit(raw: string) {
		const n = Number(raw);
		if (raw.trim() !== '' && Number.isFinite(n)) onchange(clampValue(n));
	}
</script>

<div class="stepper">
	<button
		type="button"
		class="icon-btn"
		aria-label="Decrease {label ?? ''}"
		onclick={() => onchange(clampValue((value ?? 0) - step))}>−</button
	>
	<input
		type="text"
		inputmode="decimal"
		aria-label={label}
		value={mixed ? '' : value === undefined ? '' : String(Math.round(value * 100) / 100)}
		placeholder={mixed ? '—' : ''}
		onchange={(e) => commit(e.currentTarget.value)}
		onkeydown={(e) => {
			if (e.key === 'Enter') e.currentTarget.blur();
		}}
	/>
	{#if suffix}<span class="suffix">{suffix}</span>{/if}
	<button
		type="button"
		class="icon-btn"
		aria-label="Increase {label ?? ''}"
		onclick={() => onchange(clampValue((value ?? 0) + step))}>+</button
	>
</div>

<style>
	.stepper {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.icon-btn {
		background: var(--surface-hi);
		box-shadow: var(--inset);
		border: 1px solid var(--border);
		font-size: 18px;
		font-weight: 600;
		width: var(--hit);
		height: var(--hit);
	}
	input {
		text-align: center;
		min-width: 0;
		height: var(--hit);
	}
	.suffix {
		color: var(--muted);
		font-size: 12px;
	}
</style>
