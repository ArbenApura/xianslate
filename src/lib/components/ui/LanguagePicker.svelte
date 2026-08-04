<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { TargetOption } from '$lib/languages';
	// IMPORTED DEP-MODULES
	import { createEventDispatcher, tick } from 'svelte';
	// IMPORTED MODULES
	import { languageName, NO_TRANSLATION, targetLanguageOptions } from '$lib/languages';
	import { settings, THEME_POPOVER, THEME_PANEL_BORDER } from '$lib/stores/settings';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Languages from 'lucide-svelte/icons/languages';
	import Search from 'lucide-svelte/icons/search';

	// -- REQUIRED PROPS -- //

	export let value: string;

	// -- OPTIONAL PROPS -- //

	// SHOW THE "READ IN ORIGINAL" (NO-TRANSLATION) CHOICE AT THE TOP — ON FOR A BOOK'S TARGET, OFF WHERE A
	// REAL LANGUAGE IS REQUIRED.
	export let allowNone = true;
	// CONSTRAIN THE TRIGGER WIDTH IN A FORM ROW.
	let klass = '';
	export { klass as class };

	// -- TYPES -- //

	type Group = { tier: 1 | 2 | 3; label: string; items: TargetOption[] };

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher<{ change: string }>();
	const ALL = targetLanguageOptions();
	const TIER_LABEL: Record<1 | 2 | 3, string> = {
		1: 'Best — production quality',
		2: 'Strong',
		3: 'Usable',
	};

	// -- STATES -- //

	let open = false;
	let query = '';
	let searchEl: HTMLInputElement | undefined;
	let triggerEl: HTMLButtonElement | undefined;

	// -- REACTIVE STATES -- //

	// THE TRIGGER LABEL: THE PICKED LANGUAGE'S NAME (OR "Read in original" FOR THE NO-TRANSLATION SENTINEL).
	$: isNone = value === NO_TRANSLATION;
	$: selectedName = languageName(value);
	$: selectedEndonym = isNone ? '' : (ALL.find((l) => l.value === value)?.endonym ?? '');
	$: q = query.trim().toLowerCase();
	// FILTER BY NAME / ENDONYM / CODE, THEN GROUP BY QUALITY TIER (ALREADY TIER-SORTED FROM THE REGISTRY).
	$: filtered = q
		? ALL.filter(
				(l) =>
					l.name.toLowerCase().includes(q) ||
					l.endonym.toLowerCase().includes(q) ||
					l.value.toLowerCase().includes(q),
			)
		: ALL;
	$: groups = ([1, 2, 3] as const)
		.map((tier) => ({ tier, label: TIER_LABEL[tier], items: filtered.filter((l) => l.tier === tier) }))
		.filter((g) => g.items.length > 0) satisfies Group[];
	$: showNoneRow = allowNone && (!q || 'original'.includes(q) || 'none'.includes(q));
	// THEME-AWARE OPAQUE POPOVER SURFACE + BORDER (WAS A HARDCODED white / slate-900 PLANE)
	$: popover = THEME_POPOVER[$settings.theme];
	$: popoverBorder = THEME_PANEL_BORDER[$settings.theme];

	// -- FUNCTIONS -- //

	async function toggle() {
		open = !open;
		if (open) {
			query = '';
			await tick();
			searchEl?.focus();
		}
	}

	function close() {
		open = false;
	}

	function pick(code: string) {
		value = code;
		dispatch('change', code);
		close();
		triggerEl?.focus();
	}

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			close();
			triggerEl?.focus();
		}
	}

	// CLICK-OUTSIDE: CLOSE WHEN A POINTER-DOWN LANDS OUTSIDE THE PICKER ROOT.
	function onWindowPointerDown(e: PointerEvent, root: HTMLElement) {
		if (open && !root.contains(e.target as Node)) close();
	}
	function clickOutside(node: HTMLElement) {
		const handler = (e: PointerEvent) => onWindowPointerDown(e, node);
		window.addEventListener('pointerdown', handler, true);
		return { destroy: () => window.removeEventListener('pointerdown', handler, true) };
	}
</script>

<!-- ESC CLOSES THE OPEN POPOVER FROM ANYWHERE (GUARDED ON `open` SO IT'S INERT WHEN CLOSED) -->
<svelte:window on:keydown={onKey} />

<!-- ROOT — RELATIVE SO THE POPOVER ANCHORS TO THE TRIGGER -->
<div class={cn('relative', klass)} use:clickOutside>
	<!-- TRIGGER -->
	<button
		bind:this={triggerEl}
		use:ripple
		type="button"
		on:click={toggle}
		aria-haspopup="listbox"
		aria-expanded={open}
		class={cn(
			'flex w-full items-center gap-2 rounded-lg border bg-transparent px-3 py-2 text-left text-sm transition-colors',
			open
				? 'border-[#c0392b]'
				: 'border-black/10 hover:border-black/20 dark:border-white/[0.08] dark:hover:border-white/20',
		)}
	>
		{#if isNone}
			<BookOpen size={15} class="shrink-0 opacity-60" />
		{:else}
			<Languages size={15} class="shrink-0 opacity-60" />
		{/if}
		<span class="min-w-0 flex-1 truncate">
			{selectedName}{#if selectedEndonym && selectedEndonym !== selectedName}<span class="opacity-50">
					· {selectedEndonym}</span
				>{/if}
		</span>
		<ChevronDown size={15} class={cn('shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
	</button>

	<!-- POPOVER -->
	{#if open}
		<div
			class={cn(
				'absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border shadow-xl',
				popover,
				popoverBorder,
			)}
		>
			<!-- SEARCH -->
			<div class="border-b border-black/[0.06] p-2 dark:border-white/[0.06]">
				<div class="relative">
					<Search
						size={14}
						class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40"
					/>
					<input
						bind:this={searchEl}
						bind:value={query}
						type="text"
						placeholder="Search 30+ languages…"
						class="w-full rounded-lg border border-black/10 bg-transparent py-1.5 pl-8 pr-2.5 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.08]"
					/>
				</div>
			</div>

			<!-- OPTIONS -->
			<div class="max-h-72 overflow-y-auto py-1">
				{#if showNoneRow}
					<!-- READ IN ORIGINAL — THE PREMIUM PLAIN-READER MODE (NO TRANSLATION) -->
					<button
						use:ripple
						type="button"
						on:click={() => pick(NO_TRANSLATION)}
						class={cn(
							'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
							isNone
								? 'bg-[#c0392b]/10 text-[#b23a2e] dark:text-[#e08a63]'
								: 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
						)}
					>
						<BookOpen size={16} class="shrink-0 opacity-70" />
						<span class="min-w-0 flex-1">
							<span class="block font-medium">Read in original</span>
							<span class="block text-[11px] opacity-50">No translation — just the source text</span>
						</span>
						{#if isNone}<Check size={15} class="shrink-0" />{/if}
					</button>
					<div class="my-1 border-t border-black/[0.06] dark:border-white/[0.06]"></div>
				{/if}

				{#each groups as group (group.tier)}
					<!-- TIER HEADER -->
					<div class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider opacity-40">
						{group.label}
					</div>
					{#each group.items as lang (lang.value)}
						<button
							use:ripple
							type="button"
							on:click={() => pick(lang.value)}
							class={cn(
								'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors',
								value === lang.value
									? 'bg-[#c0392b]/10 text-[#b23a2e] dark:text-[#e08a63]'
									: 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
							)}
						>
							<span class="min-w-0 flex-1 truncate">
								{lang.name}{#if lang.endonym !== lang.name}<span class="opacity-50">
										· {lang.endonym}</span
									>{/if}
							</span>
							{#if lang.rtl}<span
									class="shrink-0 rounded bg-black/[0.06] px-1 text-[9px] font-medium opacity-60 dark:bg-white/[0.08]"
									>RTL</span
								>{/if}
							{#if value === lang.value}<Check size={15} class="shrink-0" />{/if}
						</button>
					{/each}
				{/each}

				{#if groups.length === 0 && !showNoneRow}
					<p class="px-3 py-6 text-center text-sm opacity-40">No language matches “{query}”.</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
