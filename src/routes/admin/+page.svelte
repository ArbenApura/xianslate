<script lang="ts">
	// IMPORTED TYPES
	import type { AdminUser, Dashboard } from '$lib/types';
	// IMPORTED DEP-MODULES
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { isAdmin } from '$lib/stores/auth';
	import { ripple } from '$lib/actions/ripple';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Coins from 'lucide-svelte/icons/coins';
	import Globe from 'lucide-svelte/icons/globe';
	import Shield from 'lucide-svelte/icons/shield';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Users from 'lucide-svelte/icons/users';

	// -- CONSTANTS -- //

	const CARD = 'rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]';
	const MUTED = 'text-slate-500 dark:text-slate-400';

	// -- STATES -- //

	let dash: Dashboard | null = null;
	let userCount: number | null = null;
	let loading = true;

	// -- REACTIVE STATES -- //

	$: supportedCount = dash?.sites.filter((s) => s.supported).length ?? 0;
	$: okRate = dash && dash.totals.fetches > 0 ? Math.round((dash.totals.ok / dash.totals.fetches) * 100) : null;

	// -- FUNCTIONS -- //

	function fmtCost(n: number): string {
		if (n === 0) return '$0';
		return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
	}

	async function load() {
		loading = true;
		// KPIs ARE BEST-EFFORT — A FAILED SUMMARY STILL LEAVES THE NAVIGATION CARDS USABLE.
		const [dashRes, usersRes] = await Promise.allSettled([
			apiFetch('/api/admin/dashboard'),
			apiFetch('/api/admin/users'),
		]);
		try {
			if (dashRes.status === 'fulfilled' && dashRes.value.ok) dash = await dashRes.value.json();
		} catch {
			// LEAVE dash null — THE CARD STILL LINKS THROUGH.
		}
		try {
			if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
				const list = (await usersRes.value.json()) as AdminUser[];
				userCount = list.length;
			}
		} catch {
			// LEAVE userCount null.
		}
		loading = false;
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		// CLIENT GUARD FOR NATIVE (NO hooks PAGE REDIRECT IN THE STATIC SPA) — BOUNCE NON-ADMINS TO THE LIBRARY.
		if (!get(isAdmin)) {
			goto('/app/');
			return;
		}
		load();
	});
</script>

<svelte:head><title>Admin · Xianslate</title></svelte:head>

<!-- ADMIN HUB: AT-A-GLANCE KPIs + NAVIGATION INTO EACH ADMIN AREA -->
<div class="mx-auto max-w-5xl px-4 py-6 sm:py-8">
	<!-- HEADER -->
	<header class="mb-6 flex items-center gap-3">
		<a
			href="/app/"
			class="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
			aria-label="Back to library"
			use:ripple
		>
			<ArrowLeft size={20} />
		</a>
		<div>
			<h1 class="flex items-center gap-2 text-xl font-semibold">
				<Shield size={20} class="text-amber-500" /> Admin
			</h1>
			<p class={cn('text-[13px]', MUTED)}>Operate Xianslate — crawled sites, AI spend, and accounts.</p>
		</div>
	</header>

	<!-- KPI ROW -->
	<section class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<!-- USERS -->
		<div class={CARD}>
			<div class={cn('mb-1 flex items-center gap-1.5 text-[12px]', MUTED)}><Users size={14} /> Users</div>
			<div class="text-2xl font-semibold tabular-nums">
				{#if loading}<span class="opacity-40">—</span>{:else}{userCount ?? '—'}{/if}
			</div>
		</div>
		<!-- TOTAL AI COST -->
		<div class={CARD}>
			<div class={cn('mb-1 flex items-center gap-1.5 text-[12px]', MUTED)}><Coins size={14} /> Total AI cost</div>
			<div class="text-2xl font-semibold tabular-nums">
				{#if loading}<span class="opacity-40">—</span>{:else}{dash ? fmtCost(dash.cost.total) : '—'}{/if}
			</div>
		</div>
		<!-- FETCH SUCCESS RATE -->
		<div class={CARD}>
			<div class={cn('mb-1 flex items-center gap-1.5 text-[12px]', MUTED)}><Globe size={14} /> Fetch success</div>
			<div class="text-2xl font-semibold tabular-nums">
				{#if loading}<span class="opacity-40">—</span>{:else}{okRate === null ? '—' : `${okRate}%`}{/if}
			</div>
			{#if dash}<div class={cn('mt-1 text-[11px]', MUTED)}>{dash.totals.fetches} fetches</div>{/if}
		</div>
		<!-- SUPPORTED SITES -->
		<div class={CARD}>
			<div class={cn('mb-1 flex items-center gap-1.5 text-[12px]', MUTED)}><Globe size={14} /> Sites</div>
			<div class="text-2xl font-semibold tabular-nums">
				{#if loading}<span class="opacity-40">—</span>{:else}{dash ? supportedCount : '—'}{/if}
			</div>
		</div>
	</section>

	<!-- FEATURE NAVIGATION -->
	<section class="grid gap-3 sm:grid-cols-2">
		<!-- SITES & AI COST -->
		<a
			href="/admin/sites/"
			use:ripple
			class={cn(
				CARD,
				'group flex items-center gap-4 transition-colors hover:border-sky-500/40 hover:bg-sky-500/[0.04]',
			)}
		>
			<div
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400"
			>
				<Globe size={20} />
			</div>
			<div class="min-w-0 flex-1">
				<h2 class="font-semibold">Sites &amp; AI cost</h2>
				<p class={cn('text-[13px]', MUTED)}>
					{#if dash}{supportedCount} sites · {fmtCost(dash.cost.total)} spent · {dash.totals.errors} failures{:else}Crawled
						sources, fetch failures, and AI spend{/if}
				</p>
			</div>
			<ChevronRight size={18} class={cn('shrink-0 transition-transform group-hover:translate-x-0.5', MUTED)} />
		</a>

		<!-- USERS -->
		<a
			href="/admin/users/"
			use:ripple
			class={cn(
				CARD,
				'group flex items-center gap-4 transition-colors hover:border-sky-500/40 hover:bg-sky-500/[0.04]',
			)}
		>
			<div
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"
			>
				<Users size={20} />
			</div>
			<div class="min-w-0 flex-1">
				<h2 class="font-semibold">Users</h2>
				<p class={cn('text-[13px]', MUTED)}>
					{#if userCount !== null}{userCount} account{userCount === 1 ? '' : 's'} · manage roles &amp; access{:else}Accounts,
						roles, and library sizes{/if}
				</p>
			</div>
			<ChevronRight size={18} class={cn('shrink-0 transition-transform group-hover:translate-x-0.5', MUTED)} />
		</a>
	</section>

	<!-- HINT -->
	<p class={cn('mt-6 flex items-center gap-1.5 text-[12px]', MUTED)}>
		<TriangleAlert size={13} /> Admin areas are restricted to accounts with the admin role.
	</p>
</div>
