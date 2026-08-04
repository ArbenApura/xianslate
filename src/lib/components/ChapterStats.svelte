<script lang="ts">
	// IMPORTED TYPES
	import type { ChapterStats } from '$lib/types';
	// IMPORTED DEP-MODULES
	import { createEventDispatcher } from 'svelte';
	import { toast } from 'svelte-sonner';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import Clock from 'lucide-svelte/icons/clock';
	import Coins from 'lucide-svelte/icons/coins';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import FileText from 'lucide-svelte/icons/file-text';
	import Languages from 'lucide-svelte/icons/languages';
	// IMPORTED COMPONENTS
	import Badge from '$lib/components/ui/Badge.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';

	// -- OPTIONAL PROPS -- //

	export let open = false;
	// THE CHAPTER WHOSE STATS TO SHOW — STATS ARE (RE)FETCHED EACH TIME THE DIALOG OPENS FOR A NEW uuid.
	export let uuid: string | null = null;

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher();
	const numFmt = new Intl.NumberFormat('en-US');
	const relFmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	// SHARED CARD + SECTION-TITLE SHELLS (KEEPS THE MARKUP FLAT — SEE §10)
	const CARD = 'rounded-xl border border-black/[0.06] p-4 dark:border-white/[0.06]';
	const SECTION_TITLE =
		'mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-50';
	const ROW = 'flex items-center justify-between gap-3 py-1 text-sm';
	const SOURCE_LABEL: Record<string, string> = { web: 'Web', epub: 'EPUB', txt: 'Text file', manual: 'Manual' };
	// HUMAN LABEL PER ai_usage PIPELINE KIND SHOWN IN THE PER-CHAPTER SPEND BREAKDOWN.
	const PIPELINE_LABEL: Record<string, string> = {
		extract: 'Term extraction',
		title: 'Title translation',
		repair: 'Leak repair',
		term: 'Glossary term',
	};
	// HUMAN LABEL PER fetch_usage PROVIDER (ZYTE TIER). 'zyte-render' IS LEGACY (THE BROWSER TIER WAS REMOVED) —
	// KEPT SO HISTORICAL fetch_usage ROWS STILL LABEL CLEANLY.
	const FETCH_LABEL: Record<string, string> = {
		zyte: 'Page fetch (HTTP)',
		'zyte-render': 'Page fetch (render, legacy)',
	};

	// -- STATES -- //

	let stats: ChapterStats | null = null;
	let loading = false;
	let loadError = false;
	// WHICH uuid IS CURRENTLY LOADED/LOADING — GUARDS AGAINST DOUBLE-FETCH AND STALE RESPONSES.
	let loadedUuid: string | null = null;

	// -- REACTIVE STATES -- //

	// LEAD WITH WORD COUNTS ONLY WHEN A SIDE IS SPACE-DELIMITED (CJK/THAI HAVE NO WORD BOUNDARIES).
	$: showWords = !!stats && (stats.sourceWordDelimited || (!!stats.target && stats.targetWordDelimited));
	// HEADLINE KPI TILES
	$: kpis = stats
		? [
				{
					label: 'Cost',
					// TRUE ALL-IN SPEND: BODY TRANSLATION + PIPELINE EXTRAS (EXTRACTION / TITLE / REPAIR).
					value: stats.monolingual ? '—' : fmtCost(stats.totalCostUsd),
					sub: stats.monolingual
						? 'Read in original'
						: `${stats.cost.runs} ${stats.cost.runs === 1 ? 'run' : 'runs'}`,
					tone: 'text-emerald-600 dark:text-emerald-400',
				},
				{
					label: 'Tokens',
					value: stats.monolingual ? '—' : fmtTokens(totalTokens),
					sub: stats.monolingual ? '' : `${fmtTokens(totalIn)} in · ${fmtTokens(totalOut)} out`,
					tone: 'text-[#b23a2e] dark:text-[#e08a63]',
				},
				{
					label: stats.sourceWordDelimited ? 'Source words' : 'Source chars',
					value: fmtNum(stats.sourceWordDelimited ? stats.source.words : stats.source.chars),
					sub: `${fmtNum(stats.source.paragraphs)} paragraphs`,
					tone: 'text-violet-600 dark:text-violet-400',
				},
				{
					label: 'Reading time',
					value: fmtMinutes(stats.target ? stats.target.readMinutes : stats.source.readMinutes),
					sub: stats.target ? stats.targetLangName : stats.sourceLangName,
					tone: 'text-amber-600 dark:text-amber-400',
				},
			]
		: [];
	// CONTENT COMPARISON ROWS (SOURCE vs TARGET)
	$: contentRows = stats
		? [
				{
					label: 'Characters',
					src: fmtNum(stats.source.chars),
					tgt: stats.target ? fmtNum(stats.target.chars) : '—',
				},
				...(showWords
					? [
							{
								label: 'Words',
								src: stats.sourceWordDelimited ? fmtNum(stats.source.words) : '—',
								tgt: stats.target && stats.targetWordDelimited ? fmtNum(stats.target.words) : '—',
							},
						]
					: []),
				{
					label: 'Paragraphs',
					src: fmtNum(stats.source.paragraphs),
					tgt: stats.target ? fmtNum(stats.target.paragraphs) : '—',
				},
				{
					label: 'Reading time',
					src: fmtMinutes(stats.source.readMinutes),
					tgt: stats.target ? fmtMinutes(stats.target.readMinutes) : '—',
				},
			]
		: [];
	// ALL-IN TOKEN TOTALS = BODY TRANSLATION + PIPELINE EXTRAS (EXTRACTION / TITLE / REPAIR).
	$: totalIn = stats ? stats.cost.promptTokens + stats.pipeline.promptTokens : 0;
	$: totalOut = stats ? stats.cost.completionTokens + stats.pipeline.completionTokens : 0;
	$: totalTokens = totalIn + totalOut;
	// ALL-IN CACHED PROMPT TOKENS + CACHE-HIT RATE (BODY + PIPELINE) — KEEPS THE BREAKDOWN CONSISTENT WITH THE
	// ALL-IN "Tokens" KPI ABOVE (body-only FIGURES CONTRADICTED IT).
	$: totalCached = stats ? stats.cost.cachedTokens + stats.pipeline.cachedTokens : 0;
	$: allInCacheRate = totalIn > 0 ? totalCached / totalIn : 0;
	// PER-CHAPTER SPEND BREAKDOWN (BODY + EACH PIPELINE KIND + EACH FETCH TIER) — SHOWN WHENEVER ANY LINE EXISTS.
	$: spendRows = stats
		? [
				...(stats.cost.runs > 0 ? [{ label: 'Body translation', value: fmtCost(stats.cost.costUsd) }] : []),
				...stats.pipeline.items.map((it) => ({
					label: PIPELINE_LABEL[it.kind] ?? it.kind,
					value: fmtCost(it.costUsd),
				})),
				...stats.fetch.items.map((it) => ({
					label: FETCH_LABEL[it.provider] ?? `Page fetch (${it.provider})`,
					value: fmtCost(it.costUsd),
				})),
			]
		: [];
	// PER-1k-SOURCE-CHAR EFFICIENCY (NORMALISES COST ACROSS CHAPTERS OF DIFFERENT LENGTH) — USES ALL-IN COST.
	$: costPerKChars = stats && stats.source.chars > 0 ? (stats.totalCostUsd / stats.source.chars) * 1000 : 0;
	$: costRows =
		stats && !stats.monolingual && stats.cost.runs > 0
			? [
					{
						label: 'Prompt tokens',
						value: `${fmtNum(totalIn)}${totalCached ? ` · ${fmtNum(totalCached)} cached` : ''}`,
					},
					{ label: 'Completion tokens', value: fmtNum(totalOut) },
					{ label: 'Total tokens', value: fmtNum(totalTokens) },
					{ label: 'Cost per 1k source chars', value: fmtCost(costPerKChars) },
				]
			: [];
	// TIMELINE ROWS — FETCH/TRANSLATE/EXTRACT MILESTONES (TRANSLATE/EXTRACT HIDDEN FOR READ-IN-ORIGINAL)
	$: timelineRows = stats
		? [
				{ label: stats.sourceType === 'web' ? 'Fetched' : 'Imported', ms: stats.fetchedAt, fallback: '—' },
				...(stats.monolingual
					? []
					: [
							{ label: 'Translated', ms: stats.translatedAt, fallback: 'Not yet' },
							{ label: 'Glossary extracted', ms: stats.extractedAt, fallback: 'Not extracted' },
						]),
			]
		: [];

	// -- REACTIVE STATEMENTS -- //

	// (RE)FETCH WHEN THE DIALOG OPENS FOR A CHAPTER WE HAVEN'T LOADED; CLEAR THE MARKER ON CLOSE SO REOPENING
	// THE SAME CHAPTER PULLS FRESH NUMBERS (E.G. AFTER A RE-TRANSLATE).
	$: if (open && uuid && uuid !== loadedUuid) load(uuid);
	$: if (!open) loadedUuid = null;

	// -- FUNCTIONS -- //

	function close() {
		dispatch('close');
	}

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
	function fmtMinutes(m: number): string {
		if (!m) return '—';
		if (m < 60) return `${m} min`;
		const h = Math.floor(m / 60);
		const mm = m % 60;
		return mm ? `${h}h ${mm}m` : `${h}h`;
	}
	// RELATIVE TIME ("3 days ago"), FALLING BACK TO AN ABSOLUTE DATE BEYOND A MONTH.
	function fmtRel(ms: number): string {
		const diff = ms - Date.now();
		const abs = Math.abs(diff);
		const MIN = 60_000;
		const HR = 3_600_000;
		const DAY = 86_400_000;
		if (abs < HR) return relFmt.format(Math.round(diff / MIN), 'minute');
		if (abs < DAY) return relFmt.format(Math.round(diff / HR), 'hour');
		if (abs < DAY * 30) return relFmt.format(Math.round(diff / DAY), 'day');
		return new Date(ms).toLocaleDateString();
	}
	function fmtAbs(ms: number): string {
		return new Date(ms).toLocaleString();
	}

	async function load(id: string) {
		loadedUuid = id;
		loading = true;
		loadError = false;
		stats = null;
		try {
			const res = await apiFetch(`/api/chapters/${id}/stats`);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Could not load stats');
			const data: ChapterStats = await res.json();
			// IGNORE A RESPONSE THE READER HAS ALREADY NAVIGATED PAST
			if (loadedUuid !== id) return;
			stats = data;
		} catch (e) {
			if (loadedUuid !== id) return;
			loadError = true;
			toast.error(e instanceof Error ? e.message : 'Could not load chapter statistics.');
		} finally {
			if (loadedUuid === id) loading = false;
		}
	}
</script>

<!-- CHAPTER ANALYTICS DIALOG: CONTENT METRICS, TRANSLATION COST/TOKENS, GLOSSARY, AND TIMELINE -->
<Modal {open} title="Chapter statistics" size="lg" on:close={close}>
	{#if loading}
		<!-- LOADING: KPI TILE SKELETONS + A FEW DETAIL LINES -->
		<div class="space-y-4">
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each Array(4) as _, i (i)}
					<div class="bg-current/10 h-20 animate-pulse rounded-xl"></div>
				{/each}
			</div>
			<Skeleton lines={6} />
		</div>
	{:else if loadError || !stats}
		<!-- ERROR / EMPTY -->
		<p class="py-10 text-center text-sm opacity-50">Couldn't load statistics for this chapter.</p>
	{:else}
		<div class="space-y-4">
			<!-- HEADER: BOOK + POSITION + STATUS BADGES -->
			<header class="space-y-2">
				<div>
					<p class="truncate text-sm font-medium opacity-80">{stats.bookTitle}</p>
					<p class="text-xs opacity-50">
						Chapter {stats.position} of {stats.totalChapters} · {SOURCE_LABEL[stats.sourceType] ??
							stats.sourceType}
						· {stats.sourceLangName}{stats.monolingual ? '' : ` → ${stats.targetLangName}`}
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-1.5">
					<Badge variant={stats.translated ? 'emerald' : 'neutral'}>
						{stats.translated ? 'Translated' : 'Untranslated'}
					</Badge>
					{#if stats.monolingual}<Badge variant="amber">Read in original</Badge>{/if}
					{#if !stats.monolingual && stats.extracted}<Badge variant="violet">Terms extracted</Badge>{/if}
					{#if stats.readProgress != null && stats.readProgress > 0}
						<Badge variant="sky">{fmtPct(stats.readProgress)} read</Badge>
					{/if}
				</div>
			</header>

			<!-- HEADLINE KPI TILES -->
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each kpis as k (k.label)}
					<div class="rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]">
						<p class="text-[11px] uppercase tracking-wider opacity-50">{k.label}</p>
						<p class={cn('mt-0.5 text-lg font-bold tabular-nums', k.tone)}>{k.value}</p>
						{#if k.sub}<p class="truncate text-[11px] opacity-50">{k.sub}</p>{/if}
					</div>
				{/each}
			</div>

			<!-- CONTENT: SOURCE vs TARGET LENGTH -->
			<section class={CARD}>
				<h3 class={SECTION_TITLE}><FileText size={14} /> Content</h3>
				<div class="grid grid-cols-[1fr_auto_auto] gap-x-5 gap-y-1.5 text-sm">
					<span></span>
					<span class="text-right text-[11px] font-semibold uppercase tracking-wider opacity-50">Source</span>
					<span class="text-right text-[11px] font-semibold uppercase tracking-wider opacity-50">
						{stats.monolingual ? '—' : 'Target'}
					</span>
					{#each contentRows as r (r.label)}
						<span class="opacity-60">{r.label}</span>
						<span class="text-right tabular-nums">{r.src}</span>
						<span class="text-right tabular-nums opacity-90">{r.tgt}</span>
					{/each}
				</div>
				{#if stats.expansionRatio != null}
					<!-- EXPANSION: HOW MUCH LONGER/SHORTER THE TRANSLATION IS THAN THE SOURCE -->
					<p class="mt-3 border-t border-black/[0.06] pt-2.5 text-xs opacity-60 dark:border-white/[0.06]">
						Translation length is <span class="font-semibold tabular-nums opacity-100"
							>{stats.expansionRatio.toFixed(2)}×</span
						> the source.
					</p>
				{/if}
			</section>

			<!-- TRANSLATION & COST (HIDDEN FOR READ-IN-ORIGINAL BOOKS) -->
			{#if !stats.monolingual}
				<section class={CARD}>
					<h3 class={SECTION_TITLE}><Coins size={14} /> Translation &amp; cost</h3>
					{#if stats.cost.runs === 0 && stats.pipeline.costUsd === 0 && stats.fetch.costUsd === 0}
						<p class="text-sm opacity-60">No cost recorded for this chapter yet.</p>
					{:else}
						<!-- SPEND BREAKDOWN: BODY TRANSLATION + PIPELINE EXTRAS, WITH THE ALL-IN TOTAL -->
						{#if spendRows.length > 0}
							<div class="mb-3 border-b border-black/[0.06] pb-3 dark:border-white/[0.06]">
								<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-50">
									Cost to serve (USD)
								</p>
								{#each spendRows as r (r.label)}
									<div class={ROW}>
										<span class="opacity-60">{r.label}</span>
										<span class="font-medium tabular-nums">{r.value}</span>
									</div>
								{/each}
								<div
									class={cn(ROW, 'mt-1 border-t border-black/[0.06] pt-1.5 dark:border-white/[0.06]')}
								>
									<span class="font-semibold">Total</span>
									<span class="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
										>{fmtCost(stats.totalCostUsd)}</span
									>
								</div>
							</div>
						{/if}
						{#if stats.cost.runs > 0}
							<!-- MODEL(S) USED -->
							<div class="mb-3 flex flex-wrap items-center gap-1.5">
								{#each stats.cost.models as m (m)}<Badge variant="sky">{m}</Badge>{/each}
							</div>
							{#each costRows as r (r.label)}
								<div class={ROW}>
									<span class="opacity-60">{r.label}</span>
									<span class="font-medium tabular-nums">{r.value}</span>
								</div>
							{/each}
							<!-- CACHE-HIT RATE WITH A LITTLE BAR -->
							<div class="mt-2">
								<div class="flex items-center justify-between gap-3 text-sm">
									<span class="opacity-60">Cache hit rate</span>
									<span class="font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
										>{fmtPct(allInCacheRate)}</span
									>
								</div>
								<div class="bg-current/10 mt-1.5 h-1.5 overflow-hidden rounded-full">
									<!-- RUNTIME-DYNAMIC WIDTH FROM THE CACHE-HIT RATE -->
									<div class="h-full bg-emerald-500" style="width:{allInCacheRate * 100}%"></div>
								</div>
							</div>
							<!-- RUN HISTORY (WHEN A CHAPTER HAS BEEN TRANSLATED UNDER MORE THAN ONE FINGERPRINT) -->
							{#if stats.cost.history.length > 1}
								<div class="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
									<p class="mb-2 text-[11px] font-semibold uppercase tracking-wider opacity-50">
										{stats.cost.history.length} runs
									</p>
									<ul class="space-y-1.5">
										{#each stats.cost.history as run, i (i)}
											<li class="flex items-center justify-between gap-3 text-xs">
												<span
													class="min-w-0 flex-1 truncate opacity-70"
													title={fmtAbs(run.createdAt)}
												>
													{fmtRel(run.createdAt)} · {run.model}
												</span>
												<span class="shrink-0 tabular-nums opacity-50">
													{fmtTokens(run.promptTokens)}/{fmtTokens(run.completionTokens)}
												</span>
												<span class="w-16 shrink-0 text-right font-medium tabular-nums"
													>{fmtCost(run.costUsd)}</span
												>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						{/if}
					{/if}
				</section>
			{/if}

			<!-- GLOSSARY + TIMELINE -->
			<section class={CARD}>
				<h3 class={SECTION_TITLE}><Clock size={14} /> Activity</h3>
				<div class={ROW}>
					<span class="inline-flex items-center gap-1.5 opacity-60"
						><Languages size={13} /> Glossary terms here</span
					>
					<span class="font-medium tabular-nums">{fmtNum(stats.glossaryTerms)}</span>
				</div>
				{#each timelineRows as t (t.label)}
					<div class={ROW}>
						<span class="opacity-60">{t.label}</span>
						<span class="font-medium" title={t.ms ? fmtAbs(t.ms) : ''}
							>{t.ms ? fmtRel(t.ms) : t.fallback}</span
						>
					</div>
				{/each}
				<!-- READING PROGRESS BAR -->
				<div class="mt-2">
					<div class="flex items-center justify-between gap-3 text-sm">
						<span class="opacity-60">Reading progress</span>
						<span class="font-medium tabular-nums">{fmtPct(stats.readProgress ?? 0)}</span>
					</div>
					<div class="bg-current/10 mt-1.5 h-1.5 overflow-hidden rounded-full">
						<!-- RUNTIME-DYNAMIC WIDTH FROM THE STORED READ FRACTION -->
						<div class="h-full bg-[#c0392b]" style="width:{(stats.readProgress ?? 0) * 100}%"></div>
					</div>
				</div>
				{#if stats.chapterUrl}
					<!-- LINK OUT TO THE ORIGINAL SOURCE PAGE (WEB CHAPTERS) -->
					<a
						href={stats.chapterUrl}
						target="_blank"
						rel="noopener noreferrer"
						use:ripple
						class="mt-3 inline-flex min-w-0 max-w-full items-center gap-1 border-t border-black/[0.06] pt-3 text-xs text-[#b23a2e] hover:underline dark:border-white/[0.06] dark:text-[#e08a63]"
						title={stats.chapterUrl}
					>
						<ExternalLink size={12} class="shrink-0" />
						<span class="truncate">{stats.chapterUrl}</span>
					</a>
				{/if}
			</section>
		</div>
	{/if}
</Modal>
