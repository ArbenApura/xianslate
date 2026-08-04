<script lang="ts">
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';

	// -- OPTIONAL PROPS -- //

	export let value: string = '';
	export let label = '';
	export let options: { value: string; label: string }[] = [];
	export let selectClass = '';
</script>

<!-- SELECT FIELD: OPTIONAL LABEL + THEMED SELECT -->
<label class="block">
	{#if label}<span class="mb-1 block text-xs font-medium opacity-60">{label}</span>{/if}
	<!-- outline-none SUPPRESSES BROWSER DEFAULT RING; focus:border-[#c0392b] PROVIDES THE VISIBLE FOCUS INDICATOR -->
	<select
		bind:value
		class={cn(
			'w-full rounded-lg border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus:border-[#c0392b] dark:border-white/[0.06]',
			selectClass,
		)}
		on:change
	>
		{#each options as o (o.value)}
			<option value={o.value} class="bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100"
				>{o.label}</option
			>
		{/each}
	</select>
</label>
