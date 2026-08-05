<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { PageData } from './$types';
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Coins from 'lucide-svelte/icons/coins';
	import Globe from 'lucide-svelte/icons/globe';
	import Zap from 'lucide-svelte/icons/zap';

	// -- REQUIRED PROPS -- //

	// SSR'D FROM +page.server.ts — THE CALLING ACCOUNT'S AGGREGATED USAGE (getAccountUsage).
	export let data: PageData;

	// -- CONSTANTS -- //

	const CARD = 'rounded-xl border border-black/[0.06] p-4 dark:border-white/[0.06]';
	const SECTION_TITLE =
		'mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-50';
	const ROW = 'flex items-center justify-between gap-3 py-1 text-sm';
	const MUTED = 'text-slate-500 dark:text-slate-400';
	const numFmt = new Intl.NumberFormat('en-US');
	// HUMAN LABEL PER ai_usage PIPELINE KIND — SAME NAMES AS THE PER-CHAPTER STATS DIALOG SO BOTH SURFACES
	// DESCRIBE THE SAME EXPENSES THE SAME WAY.
	const PIPELINE_LABEL: Record<string, string> = {
		extract: 'Term extraction',
		title: 'Title translation',
		repair: 'Leak repair',
		term: 'Glossary term',
	};
	// HUMAN LABEL PER fetch_usage PROVIDER (ZYTE TIER). 'zyte-render' IS LEGACY (THE BROWSER TIER WAS REMOVED).
	const FETCH_LABEL: Record<string, string> = {
		zyte: 'Page fetch (HTTP)',
		'zyte-render': 'Page fetch (render, legacy)',
	};

	// -- REACTIVE STATES -- //

	$: usage = data.usage;
	$: totalIn = usage.promptTokens;
	$: totalOut = usage.completionTokens;
	$: totalTokens = usage.totalTokens;
	$: fetchCalls = usage.fetch.items.reduce((s, r) => s + r.calls, 0);
	$: aiCalls = usage.pipeline.items.reduce((s, r) => s + r.calls, 0) + usage.map.calls;
	// HEADLINE KPI TILES — MIRRORS THE CHAPTER STATS DIALOG'S TILES.
	$: kpis = [
		{
			label: 'Cost',
			value: fmtCost(usage.totalCostUsd),
			sub: `${usage.body.runs} ${usage.body.runs === 1 ? 'run' : 'runs'}`,
			tone: 'text-emerald-600 dark:text-emerald-400',
		},
		{
			label: 'Tokens',
			value: fmtTokens(totalTokens),
			sub: `${fmtTokens(totalIn)} in · ${fmtTokens(totalOut)} out`,
			tone: 'text-[#b23a2e] dark:text-[#e08a63]',
		},
		{
			label: 'AI + fetch calls',
			value: fmtNum(aiCalls + fetchCalls),
			sub: `${fmtNum(aiCalls)} AI · ${fmtNum(fetchCalls)} fetched`,
			tone: 'text-violet-600 dark:text-violet-400',
		},
		{
			label: 'Books',
			value: fmtNum(usage.books.length),
			sub: 'with recorded spend',
			tone: 'text-amber-600 dark:text-amber-400',
		},
	];
	// ALL-IN SPEND BREAKDOWN — BODY + EACH PIPELINE KIND + MAP + EACH FETCH TIER.
	$: spendRows = [
		...(usage.body.runs > 0 ? [{ label: 'Body translation', value: fmtCost(usage.body.costUsd) }] : []),
		...usage.pipeline.items.map((it) => ({
			label: PIPELINE_LABEL[it.kind] ?? it.kind,
			value: fmtCost(it.costUsd),
		})),
		...(usage.map.calls > 0 ? [{ label: 'Site mapping & cover learning', value: fmtCost(usage.map.costUsd) }] : []),
		...usage.fetch.items.map((it) => ({
			label: FETCH_LABEL[it.provider] ?? `Page fetch (${it.provider})`,
			value: fmtCost(it.costUsd),
		})),
	];
	// TOKEN SUMMARY ROWS — PROMPT (+ CACHED), COMPLETION, TOTAL.
	$: tokenRows = [
		{
			label: 'Prompt tokens',
			value: `${fmtNum(totalIn)}${usage.cachedTokens ? ` · ${fmtNum(usage.cachedTokens)} cached` : ''}`,
		},
		{ label: 'Completion tokens', value: fmtNum(totalOut) },
		{ label: 'Total tokens', value: fmtNum(totalTokens) },
	];
	$: hasAnySpend = usage.totalCostUsd > 0 || totalTokens > 0 || fetchCalls > 0;

	// -- FUNCTIONS -- //

	function fmtNum(n: number): string {
		return numFmt.format(Math.round(n));
	}
	function fmtTokens(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
	}
	function fmtCost(n: number): string {
		return n <= 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
	}
	function fmtPct(n: number): string {
		return `${Math.round(n * 100)}%`;
	}
</script>

<!-- ACCOUNT USAGE — THE CALLING ACCOUNT'S TRUE ALL-IN SPEND ACROSS EVERY LEDGER -->
<div class="space-y-4">
	{#if !hasAnySpend}
		<!-- NO USAGE YET -->
		<div class={cn(CARD, 'py-10 text-center')}>
			<p class="text-sm font-medium">No usage recorded yet.</p>
			<p class={cn('mt-1 text-xs', MUTED)}>
				Costs appear here once you translate chapters, fetch pages, or learn new sites.
			</p>
		</div>
	{:else}
		<!-- HEADLINE KPI TILES -->
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{#each kpis as k (k.label)}
				<div class={CARD}>
					<p class="text-[11px] uppercase tracking-wider opacity-50">{k.label}</p>
					<p class={cn('mt-0.5 text-lg font-bold tabular-nums', k.tone)}>{k.value}</p>
					{#if k.sub}<p class="truncate text-[11px] opacity-50">{k.sub}</p>{/if}
				</div>
			{/each}
		</div>

		<!-- SPEND BREAKDOWN: EVERY ATTRIBUTABLE LEDGER ROW, WITH THE ALL-IN TOTAL -->
		{#if spendRows.length > 0}
			<section class={CARD}>
				<h3 class={SECTION_TITLE}><Coins size={14} /> Cost to serve (USD)</h3>
				{#each spendRows as r (r.label)}
					<div class={ROW}>
						<span class="opacity-60">{r.label}</span>
						<span class="font-medium tabular-nums">{r.value}</span>
					</div>
				{/each}
				<div class={cn(ROW, 'mt-1 border-t border-black/[0.06] pt-1.5 dark:border-white/[0.06]')}>
					<span class="font-semibold">Total</span>
					<span class="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
						>{fmtCost(usage.totalCostUsd)}</span
					>
				</div>
			</section>
		{/if}

		<!-- TOKEN SUMMARY + CACHE-HIT RATE -->
		{#if totalTokens > 0}
			<section class={CARD}>
				<h3 class={SECTION_TITLE}><Zap size={14} /> Tokens</h3>
				{#each tokenRows as r (r.label)}
					<div class={ROW}>
						<span class="opacity-60">{r.label}</span>
						<span class="font-medium tabular-nums">{r.value}</span>
					</div>
				{/each}
				{#if totalIn > 0}
					<div class="mt-2">
						<div class="flex items-center justify-between gap-3 text-sm">
							<span class="opacity-60">Cache hit rate</span>
							<span class="font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
								>{fmtPct(usage.cacheHitRate)}</span
							>
						</div>
						<div class="bg-current/10 mt-1.5 h-1.5 overflow-hidden rounded-full">
							<!-- RUNTIME-DYNAMIC WIDTH FROM THE CACHE-HIT RATE -->
							<div class="h-full bg-emerald-500" style="width:{usage.cacheHitRate * 100}%"></div>
						</div>
					</div>
				{/if}
			</section>
		{/if}

		<!-- PER-BOOK SPEND -->
		{#if usage.books.length > 0}
			<section class={CARD}>
				<h3 class={SECTION_TITLE}><BookOpen size={14} /> By book</h3>
				<ul class="space-y-1.5">
					{#each usage.books as b (b.bookId)}
						<li class="flex items-center justify-between gap-3 text-xs">
							<span class="min-w-0 flex-1 truncate opacity-70" title={b.title}>{b.title}</span>
							<span class="shrink-0 tabular-nums opacity-50"
								>{fmtTokens(b.promptTokens + b.completionTokens)}</span
							>
							<span class="w-16 shrink-0 text-right font-medium tabular-nums">{fmtCost(b.costUsd)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- PER-MODEL SPEND -->
		{#if usage.models.length > 0}
			<section class={CARD}>
				<h3 class={SECTION_TITLE}><Zap size={14} /> By model</h3>
				<ul class="space-y-1.5">
					{#each usage.models as m (m.model)}
						<li class="flex items-center justify-between gap-3 text-xs">
							<span class="min-w-0 flex-1 truncate opacity-70">{m.model}</span>
							<span class="shrink-0 tabular-nums opacity-50"
								>{m.runs}
								{m.runs === 1 ? 'run' : 'runs'} · {m.calls}
								{m.calls === 1 ? 'call' : 'calls'}</span
							>
							<span class="shrink-0 tabular-nums opacity-50"
								>{fmtTokens(m.promptTokens)}/{fmtTokens(m.completionTokens)}</span
							>
							<span class="w-16 shrink-0 text-right font-medium tabular-nums">{fmtCost(m.costUsd)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}

	<!-- MEASUREMENT NOTE — WHAT'S COUNTED AND WHAT ISN'T -->
	<section class={cn(CARD, 'space-y-1 border-dashed !p-4')}>
		<h3 class={SECTION_TITLE}><Globe size={14} /> How usage is measured</h3>
		<p class="text-xs opacity-60">
			Totals sum every attributable ledger row: body translations, per-chapter AI (term extraction, title
			translation, leak repair), site mapping &amp; cover learning, and billed page fetches.
		</p>
		<p class="text-xs opacity-60">
			Page-fetch cost is a pass-through estimate from the configured per-request rate (env-tunable); free fetches
			aren’t billed. Site-mapping rows written before per-account attribution existed are not counted — they
			predate this section.
		</p>
	</section>
</div>
