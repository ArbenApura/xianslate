<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { PageData } from './$types';
	// IMPORTED MODULES
	import { ripple } from '$lib/actions/ripple';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import CircleCheck from 'lucide-svelte/icons/circle-check';
	import Globe from 'lucide-svelte/icons/globe';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Coins from 'lucide-svelte/icons/coins';

	// -- REQUIRED PROPS -- //

	export let data: PageData;

	// -- CONSTANTS -- //

	// HUMAN LABEL PER FETCH OUTCOME KIND (OUR FetchErrorKind SET + 'ok').
	const KIND_LABEL: Record<string, string> = {
		ok: 'OK',
		invalid_url: 'Invalid URL',
		blocked_private: 'Blocked (private)',
		unresolvable: 'DNS failed',
		blocked_bot: 'Bot-blocked',
		not_found: 'Not found',
		http_error: 'HTTP error',
		network: 'Network',
		no_api_key: 'No API key',
		unsupported_site: 'Unsupported',
		parse_failed: 'Parse failed',
	};

	// COMPLETE LITERAL BADGE CLASSES PER KIND (NO RUNTIME CONSTRUCTION — KEEPS cn()/TAILWIND HAPPY).
	const KIND_CLASS: Record<string, string> = {
		invalid_url: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
		blocked_private: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
		unresolvable: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
		not_found: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
		blocked_bot: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
		network: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
		http_error: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
		unsupported_site: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
		parse_failed: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
		no_api_key: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300',
	};

	const CARD = 'rounded-xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]';
	const MUTED = 'text-slate-500 dark:text-slate-400';

	// -- REACTIVE STATES -- //

	$: dash = data.dashboard;
	$: supportedCount = dash.sites.filter((s) => s.supported).length;

	// -- FUNCTIONS -- //

	function fmtCost(n: number): string {
		if (n === 0) return '$0';
		return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
	}

	function fmtTokens(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
	}

	function fmtWhen(ms: number | null): string {
		if (!ms) return '—';
		const diff = Date.now() - ms;
		const min = Math.round(diff / 60_000);
		if (min < 1) return 'just now';
		if (min < 60) return `${min}m ago`;
		const hr = Math.round(min / 60);
		if (hr < 24) return `${hr}h ago`;
		return new Date(ms).toLocaleDateString();
	}

	function kindLabel(kind: string): string {
		return KIND_LABEL[kind] ?? kind;
	}

	function kindClass(kind: string): string {
		return KIND_CLASS[kind] ?? 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300';
	}
</script>

<svelte:head><title>Sites & AI cost · xianslate</title></svelte:head>

<!-- DASHBOARD: CRAWLED SITES, FETCH ERRORS BY KIND, AND AI SPEND -->
<div class="mx-auto max-w-5xl px-4 py-6">
	<!-- HEADER -->
	<header class="mb-6 flex items-center gap-3">
		<a
			href="/"
			class="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
			aria-label="Back to library"
			use:ripple
		>
			<ArrowLeft size={20} />
		</a>
		<div>
			<h1 class="text-xl font-semibold">Sites &amp; AI cost</h1>
			<p class={cn('text-[13px]', MUTED)}>
				Crawled sources, fetch failures by reason, and what the AI has spent.
			</p>
		</div>
	</header>

	<!-- COST + FETCH SUMMARY CARDS -->
	<section class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<!-- TOTAL AI COST -->
		<div class={CARD}>
			<div class={cn('mb-1 flex items-center gap-1.5 text-[12px]', MUTED)}><Coins size={14} /> Total AI cost</div>
			<div class="text-2xl font-semibold tabular-nums">{fmtCost(dash.cost.total)}</div>
		</div>
		<!-- PER-CATEGORY COST -->
		{#each dash.cost.buckets as b (b.label)}
			<div class={CARD}>
				<div class={cn('mb-1 text-[12px]', MUTED)}>{b.label}</div>
				<div class="text-2xl font-semibold tabular-nums">{fmtCost(b.costUsd)}</div>
				<div class={cn('mt-1 text-[11px]', MUTED)}>
					{b.calls} calls · {fmtTokens(b.promptTokens)} in · {fmtTokens(b.completionTokens)} out
				</div>
			</div>
		{/each}
		<!-- FETCH TOTALS -->
		<div class={CARD}>
			<div class={cn('mb-1 text-[12px]', MUTED)}>Fetches</div>
			<div class="text-2xl font-semibold tabular-nums">{dash.totals.fetches}</div>
			<div class={cn('mt-1 text-[11px]', MUTED)}>
				<span class="text-emerald-600 dark:text-emerald-400">{dash.totals.ok} ok</span>
				· <span class="text-rose-600 dark:text-rose-400">{dash.totals.errors} failed</span>
			</div>
		</div>
	</section>

	<!-- SUPPORTED / CRAWLED SITES -->
	<section class="mb-8">
		<h2 class="mb-3 flex items-center gap-2 text-[15px] font-semibold">
			<Globe size={16} /> Crawled sites
			<span class={cn('text-[13px] font-normal', MUTED)}>({supportedCount})</span>
		</h2>
		{#if dash.sites.length === 0}
			<div class={cn(CARD, 'text-center text-[13px]', MUTED)}>
				No sites fetched yet. Open a web chapter to start.
			</div>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
				<table class="w-full border-collapse text-left text-[13px]">
					<thead class={cn('border-b border-black/10 text-[11px] uppercase dark:border-white/10', MUTED)}>
						<tr>
							<th class="px-3 py-2 font-medium">Host</th>
							<th class="px-3 py-2 font-medium">Source</th>
							<th class="px-3 py-2 text-right font-medium">Fetches</th>
							<th class="px-3 py-2 text-right font-medium">Errors</th>
							<th class="px-3 py-2 font-medium">Model</th>
							<th class="px-3 py-2 font-medium">Last fetch</th>
						</tr>
					</thead>
					<tbody>
						{#each dash.sites as s (s.host)}
							<tr class="border-b border-black/5 last:border-0 dark:border-white/5">
								<td class="px-3 py-2 font-medium">{s.host}</td>
								<td class="px-3 py-2">
									{#if s.version}
										<span
											class="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
											>AI-learned v{s.version}</span
										>
									{:else}
										<span class={cn('text-[12px]', MUTED)}>—</span>
									{/if}
								</td>
								<td class="px-3 py-2 text-right tabular-nums">{s.fetches}</td>
								<td
									class={cn(
										'px-3 py-2 text-right tabular-nums',
										s.errors > 0 ? 'text-rose-600 dark:text-rose-400' : MUTED,
									)}>{s.errors}</td
								>
								<td class={cn('px-3 py-2 text-[12px]', MUTED)}>{s.model ?? '—'}</td>
								<td class={cn('px-3 py-2 text-[12px]', MUTED)}>{fmtWhen(s.lastFetchAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<!-- ERRORS BY KIND + RECENT FAILURES -->
	<section>
		<h2 class="mb-3 flex items-center gap-2 text-[15px] font-semibold">
			<TriangleAlert size={16} /> Fetch errors
		</h2>
		{#if dash.recentErrors.length === 0}
			<div class={cn(CARD, 'flex items-center justify-center gap-2 text-[13px]', MUTED)}>
				<CircleCheck size={16} class="text-emerald-500" /> No fetch errors recorded.
			</div>
		{:else}
			<!-- KIND SUMMARY CHIPS -->
			<div class="mb-3 flex flex-wrap gap-2">
				{#each dash.errorKinds as k (k.kind)}
					<span
						class={cn(
							'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
							kindClass(k.kind),
						)}
					>
						{kindLabel(k.kind)}
						<span class="opacity-70">{k.status}</span>
						<span class="rounded-full bg-black/10 px-1.5 tabular-nums dark:bg-white/15">{k.count}</span>
					</span>
				{/each}
			</div>
			<!-- RECENT FAILURES -->
			<div class="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
				<table class="w-full border-collapse text-left text-[13px]">
					<thead class={cn('border-b border-black/10 text-[11px] uppercase dark:border-white/10', MUTED)}>
						<tr>
							<th class="px-3 py-2 font-medium">When</th>
							<th class="px-3 py-2 font-medium">Host</th>
							<th class="px-3 py-2 font-medium">Reason</th>
							<th class="px-3 py-2 font-medium">Message</th>
						</tr>
					</thead>
					<tbody>
						{#each dash.recentErrors as e (e.id)}
							<tr class="border-b border-black/5 last:border-0 dark:border-white/5">
								<td class={cn('whitespace-nowrap px-3 py-2 text-[12px]', MUTED)}
									>{fmtWhen(e.createdAt)}</td
								>
								<td class="px-3 py-2 font-medium">{e.host}</td>
								<td class="px-3 py-2">
									<span
										class={cn(
											'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
											kindClass(e.kind),
										)}
									>
										{kindLabel(e.kind)} <span class="opacity-70">{e.status}</span>
									</span>
								</td>
								<td class={cn('px-3 py-2 text-[12px]', MUTED)}>{e.message ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
