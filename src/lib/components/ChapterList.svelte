<script lang="ts">
	// IMPORTED DEP-MODULES
	import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
	// IMPORTED MODULES
	import { chapterLabel, stripChapterPrefix } from '$lib/chapter-label';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import Check from 'lucide-svelte/icons/check';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	// IMPORTED COMPONENTS
	import Badge from '$lib/components/ui/Badge.svelte';

	// -- REQUIRED PROPS -- //

	export let bookId: string;

	// -- OPTIONAL PROPS -- //

	export let currentUuid: string | null = null;

	// -- TYPES -- //

	type TocItem = { uuid: string; seq: number; titleZh: string; titleEn: string | null; hasEn: boolean };

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher();

	// -- STATES -- //

	let items: TocItem[] = [];
	let loading = true;
	let loaded = false;
	let query = '';
	let listEl: HTMLElement;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	// UUIDS WITH A TRANSLATION JOB RUNNING ON THE SERVER (POLLED) → BLUE 'TRANSLATING' BADGE
	let translating = new Set<string>();
	let pollTimer: ReturnType<typeof setInterval> | undefined;

	// -- REACTIVE STATES -- //

	// SEQ OF THE CHAPTER BEING READ — EVERYTHING BEFORE IT COUNTS AS ALREADY READ (GETS A ✓).
	$: currentSeq = items.find((it) => it.uuid === currentUuid)?.seq ?? -Infinity;
	$: q = query.trim().toLowerCase();
	$: filtered = q
		? items.filter((it) => it.titleZh.toLowerCase().includes(q) || (it.titleEn ?? '').toLowerCase().includes(q))
		: items;
	// STABLE KEY FOR THE TRANSLATING SET (MEMBERSHIP, ORDER-INDEPENDENT)
	$: translatingKey = [...translating].sort().join('|');
	// SOFT-REFRESH (DEBOUNCED) ON NAVIGATION AND WHENEVER THE TRANSLATING SET CHANGES — SO CHAPTERS
	// JUST PREFETCHED APPEAR *WITH* THEIR BLUE BADGES, AND EN TITLES/BADGES STAY CURRENT.
	$: if (loaded) scheduleRefresh(currentUuid, translatingKey);

	// -- FUNCTIONS -- //

	async function fetchItems(): Promise<TocItem[] | null> {
		try {
			const res = await fetch(`/api/books/${bookId}`);
			const data = await res.json();
			return data.chapters ?? [];
		} catch {
			return null;
		}
	}

	async function load() {
		loading = true;
		const rows = await fetchItems();
		items = rows ?? [];
		loading = false;
		loaded = true;
		await tick();
		listEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'center' });
	}

	// REFRESH WITHOUT THE LOADING SPINNER (KEEPS THE CURRENT LIST ON A TRANSIENT FAILURE)
	async function refresh() {
		const rows = await fetchItems();
		if (rows) items = rows;
	}

	// DEBOUNCE SO RAPID navigation / translating-set CHANGES COALESCE INTO ONE FETCH. ARGS ARE ONLY
	// THERE TO MAKE THE REACTIVE STATEMENT DEPEND ON THEM.
	function scheduleRefresh(_currentUuid: string | null, _translatingKey: string) {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(refresh, 120);
	}

	// POLL THE SERVER FOR CHAPTERS WITH A RUNNING TRANSLATION JOB (RELIABLE ACROSS CURRENT + PREFETCH).
	async function pollTranslating() {
		try {
			const res = await fetch(`/api/books/${bookId}/translating`);
			if (!res.ok) return;
			const data = await res.json();
			const next = new Set<string>(data.uuids ?? []);
			// REASSIGN ONLY ON A REAL MEMBERSHIP CHANGE (AVOIDS NEEDLESS REFRESH CHURN)
			if (next.size !== translating.size || [...next].some((u) => !translating.has(u))) {
				translating = next;
			}
		} catch {
			// IGNORE — TRANSIENT
		}
	}

	function pick(uuid: string) {
		dispatch('select', { uuid });
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		load();
		void pollTranslating();
		pollTimer = setInterval(pollTranslating, 1500);
	});
	onDestroy(() => {
		clearTimeout(refreshTimer);
		clearInterval(pollTimer);
	});
</script>

<!-- CHAPTER LIST: SHARED BY THE DESKTOP SIDEBAR AND THE MOBILE DRAWER -->
<div class="flex h-full min-h-0 flex-col">
	<!-- HEADER: TITLE AND OPTIONAL ACTION SLOT -->
	<div
		class="flex items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2.5 dark:border-white/[0.045]"
	>
		<span class="text-xs font-semibold uppercase tracking-wide opacity-50">
			Contents {#if items.length}({items.length}){/if}
		</span>
		<slot name="action" />
	</div>
	<!-- SEARCH INPUT: SHOWN ONLY WHEN THERE ARE MORE THAN 8 CHAPTERS -->
	{#if items.length > 8}
		<div class="border-b border-black/[0.06] p-2 dark:border-white/[0.045]">
			<input
				bind:value={query}
				type="search"
				placeholder="Find chapter…"
				class="w-full rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
			/>
		</div>
	{/if}
	<!-- SCROLLABLE CHAPTER LIST -->
	<div bind:this={listEl} class="min-h-0 flex-1 overflow-y-auto">
		{#if loading}
			<p class="p-4 text-sm opacity-50">Loading…</p>
		{:else if filtered.length === 0}
			<p class="p-4 text-sm opacity-50">{query ? 'No matches.' : 'No chapters yet.'}</p>
		{:else}
			<ul>
				{#each filtered as it (it.uuid)}
					{@const lbl = chapterLabel(it.titleZh, it.titleEn)}
					{@const isRead = it.uuid !== currentUuid && it.seq < currentSeq}
					<li>
						<button
							use:ripple
							data-active={it.uuid === currentUuid}
							on:click={() => pick(it.uuid)}
							class={cn(
								'hover:bg-current/5 flex w-full items-center gap-1.5 border-l-2 py-2 pl-1.5 pr-3 text-left text-sm',
								it.uuid === currentUuid
									? 'border-sky-500 bg-sky-500/10 font-medium text-sky-600 dark:text-sky-300'
									: isRead
										? 'border-transparent opacity-55'
										: 'border-transparent',
							)}
						>
							<!-- ALWAYS SHOW THE REAL CHAPTER NUMBER ('·' FOR NON-CHAPTER ENTRIES) — THE ✓ LIVES ON THE
							     TITLE, NOT IN THIS NUMBER COLUMN. -->
							<span class="flex min-w-[1.85rem] shrink-0 justify-end text-right text-xs tabular-nums opacity-40">
								{lbl.kind === 'chapter' ? lbl.number : '·'}
							</span>
							<!-- READ CHAPTERS GET A ✓ PREFIXED TO THE TITLE -->
							<span class="flex min-w-0 flex-1 items-center gap-1.5">
								{#if isRead}<Check size={13} class="shrink-0 text-emerald-500 opacity-90" />{/if}
								<span class="min-w-0 flex-1 truncate"
									>{stripChapterPrefix(it.titleEn || it.titleZh)}</span
								>
							</span>
							{#if translating.has(it.uuid)}
								<Badge variant="sky" class="shrink-0 gap-1">
									<Loader2 size={10} class="animate-spin" /> TR
								</Badge>
							{:else if lbl.kind === 'special'}<Badge variant="neutral" class="shrink-0">{lbl.tag}</Badge
								>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
