<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { PageData } from './$types';
	// IMPORTED DEP-MODULES
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Coins from 'lucide-svelte/icons/coins';
	import Gauge from 'lucide-svelte/icons/gauge';
	import Globe from 'lucide-svelte/icons/globe';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Zap from 'lucide-svelte/icons/zap';

	// -- REQUIRED PROPS -- //

	// SSR'D FROM +page.ts — THE CALLING ACCOUNT'S AGGREGATED USAGE (getAccountUsage) + THE LIVE QUOTA
	// STATE (quotaStatus — THE SPEND/RATE GUARD'S ENFORCED LIMITS AND THE USER'S CURRENT POSITION).
	export let data: PageData;

	// -- CONSTANTS -- //

	// MATCHES THE OTHER ACCOUNT SECTIONS (SECURITY/PROFILE) SO ALL FOUR PAGES READ AS ONE APP.
	const CARD = 'rounded-2xl border border-black/10 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]';
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
	// THE SERVER ADDS `quota` (THE SPEND/RATE GUARD) IN THE SAME RELEASE AS THIS PAGE. AGAINST AN OLDER
	// DEPLOYED SERVER IT'S ABSENT — DEFAULT TO A NON-BLOCKING STATE SO THE PAGE NEVER CRASHES ON STALE DATA.
	$: quota = data.quota ?? {
		dailyBudgetUsd: 5,
		dailySpentUsd: 0,
		resetsAt: 0,
		rpmLimit: 30,
		rpmUsed: 0,
		blocked: false,
	};
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
	// THE UTC-DAY BUDGET BAR — CLAMPED FOR DISPLAY, EXACT NUMBERS IN THE LABEL.
	$: budgetPct = quota.dailyBudgetUsd > 0 ? Math.min(1, quota.dailySpentUsd / quota.dailyBudgetUsd) : 0;
	$: rpmPct = quota.rpmLimit > 0 ? Math.min(1, quota.rpmUsed / quota.rpmLimit) : 0;
	$: budgetNearlyOut = budgetPct >= 0.85;
	$: rpmNearlyOut = rpmPct >= 0.85;
	// THE LIVE UTC CLOCK — EVERYTHING TIME-RELATED ON THIS PAGE IS UTC (THE BUDGET DAY, THE RESET MOMENT).
	$: nowUtc = utcNow;

	// -- FUNCTIONS -- //

	let utcNow = Date.now();
	let clockTimer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		clockTimer = setInterval(() => (utcNow = Date.now()), 30_000);
		return () => {
			if (clockTimer) clearInterval(clockTimer);
		};
	});

	function fmtNum(n: number): string {
		return numFmt.format(Math.round(n));
	}
	function fmtTokens(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
	}
	function fmtCost(n: number): string {
		return n <= 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
	}
	function fmtUsd(n: number): string {
		return `$${n.toFixed(2)}`;
	}
	function fmtPct(n: number): string {
		return `${Math.round(n * 100)}%`;
	}
	// THE BAR COLOR FLIPS TO RED WHEN THE METER IS AT/NEAR ITS LIMIT, EMERALD OTHERWISE.
	function meterTone(nearlyOut: boolean, out: boolean): string {
		return out ? 'bg-[#c0392b]' : nearlyOut ? 'bg-amber-500' : 'bg-emerald-500';
	}
	// "HH:MM UTC" FROM A ms EPOCH — ALWAYS THE UTC CLOCK, NEVER THE USER'S LOCAL TIME.
	function fmtUtcClock(ms: number): string {
		const d = new Date(ms);
		return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
	}
</script>

<!-- ACCOUNT USAGE — ALL-TIME SPEND + THE UTC-DAY BUDGET / RATE METERS THAT GUARD THE BILLED ENDPOINTS -->
<div class="space-y-4">
	<!-- PAGE HEADER -->
	<header class="mb-1">
		<h2 class="text-[15px] font-semibold">Usage</h2>
		<p class={cn('mt-0.5 text-[13px]', MUTED)}>
			Your all-time spend across every ledger, and the UTC-day budget protecting it.
		</p>
	</header>

	<!-- QUOTA CARD — ALWAYS VISIBLE (EVEN WITH NO SPEND RECORDED YET) -->
	<section class={CARD}>
		<div class="flex items-center justify-between gap-3">
			<h3 class="flex items-center gap-1.5 text-[13px] font-semibold">
				<ShieldCheck size={15} class="text-emerald-600 dark:text-emerald-400" /> Daily budget
			</h3>
			<div class="flex items-center gap-1.5">
				<span class="hidden font-mono text-[10px] tabular-nums text-slate-400 dark:text-slate-500 sm:inline"
					>{fmtUtcClock(nowUtc)}</span
				>
				<span
					class={cn(
						'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
						quota.blocked && budgetPct >= rpmPct
							? 'border-[#c0392b]/30 bg-[#c0392b]/10 text-[#c0392b] dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300'
							: 'border-black/10 text-slate-500 dark:border-white/10 dark:text-slate-400',
					)}
					>UTC day</span
				>
			</div>
		</div>
		<div class="mt-3">
			<div class="flex items-baseline justify-between gap-3 text-sm">
				<span class="font-semibold tabular-nums">{fmtUsd(quota.dailySpentUsd)}</span>
				<span class={MUTED}
					>{fmtUsd(quota.dailySpentUsd)} of {fmtUsd(quota.dailyBudgetUsd)}
					used{quota.dailyBudgetUsd > quota.dailySpentUsd
						? ` · ${fmtUsd(quota.dailyBudgetUsd - quota.dailySpentUsd)} left`
						: ''}</span
				>
			</div>
			<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
				<!-- RUNTIME-DYNAMIC WIDTH FROM THE UTC-DAY SPEND -->
				<div
					class={cn('h-full rounded-full transition-all', meterTone(budgetNearlyOut, budgetPct >= 1))}
					style="width:{Math.max(budgetPct * 100, quota.dailySpentUsd > 0 ? 2 : 0)}%"
				></div>
			</div>
			<p class={cn('mt-1.5 text-[11px] leading-relaxed', MUTED)}>
				Translation, extraction, fetching and cover-refresh spend against this budget. The day runs
				<code class="rounded bg-black/[0.05] px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]"
					>00:00–24:00 UTC</code
				>
				and resets at
				<code class="rounded bg-black/[0.05] px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]"
					>00:00 UTC</code
				>{quota.resetsAt ? ` (${fmtUtcClock(quota.resetsAt)})` : ''} — the same moment for everyone,
				wherever they are.
			</p>
		</div>

		<!-- RATE METER -->
		<div class="mt-4 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
			<div class="flex items-center gap-1.5 text-[13px] font-semibold">
				<Gauge size={15} class="text-violet-600 dark:text-violet-400" /> Requests this minute
			</div>
			<div class="mt-2 flex items-baseline justify-between gap-3 text-sm">
				<span class="font-semibold tabular-nums">{fmtNum(quota.rpmUsed)}</span>
				<span class={MUTED}>{fmtNum(quota.rpmUsed)} of {fmtNum(quota.rpmLimit)} billed requests</span>
			</div>
			<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
				<div
					class={cn('h-full rounded-full transition-all', meterTone(rpmNearlyOut, rpmPct >= 1))}
					style="width:{Math.max(rpmPct * 100, quota.rpmUsed > 0 ? 2 : 0)}%"
				></div>
			</div>
			<p class={cn('mt-1.5 text-[11px] leading-relaxed', MUTED)}>
				How many billed requests you've started in the last 60 seconds. The counter is per-server — it resets on
				a restart.
			</p>
		</div>

		<!-- BLOCKED WARNING -->
		{#if quota.blocked}
			<div
				class="mt-3 flex items-start gap-2 rounded-lg border border-[#c0392b]/25 bg-[#c0392b]/5 px-3 py-2 text-xs text-[#b23a2e] dark:border-red-400/25 dark:bg-red-400/5 dark:text-red-300"
			>
				<TriangleAlert size={14} class="mt-0.5 shrink-0" />
				<span>
					{budgetPct >= 1 && rpmPct >= 1
						? 'Budget reached and the per-minute limit is hot — billed actions are paused until the day resets at 00:00 UTC.'
						: budgetPct >= 1
							? 'Daily budget reached — translation, extraction and fetching are paused until the day resets at 00:00 UTC.'
							: 'Per-minute request limit reached — wait a moment and try again.'}
				</span>
			</div>
		{/if}
	</section>

	{#if !hasAnySpend}
		<!-- NO USAGE YET -->
		<div class={cn(CARD, 'py-10 text-center')}>
			<p class="text-sm font-medium">No usage recorded yet.</p>
			<p class={cn('mt-1 text-xs', MUTED)}>
				Costs appear here once you translate chapters, fetch pages, or learn new sites.
			</p>
		</div>
	{:else}
		<!-- HEADLINE KPI TILES — ALL-TIME -->
		<div>
			<h3 class={SECTION_TITLE}><Zap size={14} /> All time</h3>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each kpis as k (k.label)}
					<div class={CARD}>
						<p class="text-[11px] uppercase tracking-wider opacity-50">{k.label}</p>
						<p class={cn('mt-0.5 text-lg font-bold tabular-nums', k.tone)}>{k.value}</p>
						{#if k.sub}<p class="truncate text-[11px] opacity-50">{k.sub}</p>{/if}
					</div>
				{/each}
			</div>
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
						<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
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
		<p class="text-xs opacity-60">
			The daily budget and per-minute limit above come from the server's spend guard (env-tunable
			<code class="rounded bg-black/[0.05] px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]"
				>AI_DAILY_BUDGET_USD</code
			>
			and
			<code class="rounded bg-black/[0.05] px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]"
				>AI_RPM_LIMIT</code
			>) — billed actions return a “too many requests” message once either is hit. The budget day is always
			UTC (00:00–24:00 UTC), so it resets at the same moment for every user.
		</p>
	</section>
</div>
