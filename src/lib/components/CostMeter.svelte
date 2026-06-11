<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { TranslationUsage } from '$lib/types';

	// -- OPTIONAL PROPS -- //
	export let usage: TranslationUsage | null = null;
	export let cached = false;
	export let matched = 0;
	export let runningCost = 0;

	// -- FUNCTIONS -- //
	function fmtTokens(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
	}
	function fmtCost(n: number): string {
		return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
	}
</script>

<!-- TRANSLATION COST / CACHE METER -->
<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
	{#if matched > 0}<span title="Glossary terms injected">{matched} terms</span>{/if}
	{#if usage}
		<span title="Prompt tokens (cache hits)">
			{fmtTokens(usage.promptTokens)} in{#if usage.cachedTokens > 0}<span
					class="text-emerald-600 dark:text-emerald-400"
				>
					({fmtTokens(usage.cachedTokens)} cached)</span
				>{/if}
		</span>
		<span title="Completion tokens">{fmtTokens(usage.completionTokens)} out</span>
		{#if cached}
			<span
				class="rounded bg-emerald-100 px-1 font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
				>memo $0</span
			>
		{:else}
			<span title="Estimated cost">{fmtCost(usage.costUsd)}</span>
		{/if}
	{/if}
	{#if runningCost > 0}<span class="text-slate-400" title="Session total">· session {fmtCost(runningCost)}</span>{/if}
</div>
