<script lang="ts">
	// IMPORTED TYPES
	import type { Gender, GlossaryScope } from '$lib/types';
	import type { MenuAction } from '$lib/components/ui/ActionMenu.svelte';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onMount, onDestroy } from 'svelte';
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG } from '$lib/languages';
	import { settings, THEME_CLASS } from '$lib/stores/settings';
	// IMPORTED DEP-COMPONENTS
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import ChevronsLeft from 'lucide-svelte/icons/chevrons-left';
	import ChevronsRight from 'lucide-svelte/icons/chevrons-right';
	import Download from 'lucide-svelte/icons/download';
	import Languages from 'lucide-svelte/icons/languages';
	import Plus from 'lucide-svelte/icons/plus';
	import Search from 'lucide-svelte/icons/search';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Upload from 'lucide-svelte/icons/upload';
	// IMPORTED COMPONENTS
	import ActionMenu from '$lib/components/ui/ActionMenu.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Select from '$lib/components/ui/Select.svelte';

	// -- REQUIRED PROPS -- //

	export let scope: GlossaryScope;

	// -- OPTIONAL PROPS -- //

	export let bookId: string | null = null;
	export let bookTitle = '';
	// SURFACE THE STICKY SEARCH BAR PAINTS OVER. DEFAULTS TO THE THEMED PAGE BG; THE DIALOG OVERRIDES
	// IT WITH THE MODAL'S OWN SURFACE SO THE PINNED BAR ALWAYS MATCHES WHAT'S BEHIND IT.
	export let surface = '';
	// FOR GLOBAL SCOPE: WHICH LANGUAGE PAIR'S GLOSSARY TO SHOW/EDIT. BOOK SCOPE INHERITS THE BOOK'S PAIR
	// SERVER-SIDE, SO THESE ARE ONLY MEANINGFUL (AND ONLY SENT) WHEN scope === 'global'.
	export let sourceLang: string = DEFAULT_SOURCE_LANG;
	export let targetLang: string = DEFAULT_TARGET_LANG;

	// -- TYPES -- //

	type Entry = {
		id: number;
		source: string;
		target: string;
		gender: Gender;
		context: string | null;
		tags: string | null;
	};

	// -- CONSTANTS -- //

	const GENDERS: Gender[] = ['neuter', 'masculine', 'feminine'];
	const GENDER_ITEMS = GENDERS.map((g) => ({ value: g, label: g }));
	const PAGE_SIZE_ITEMS = [10, 25, 50, 100, 200].map((n) => ({ value: String(n), label: `${n} / page` }));
	// PER-ROW KEBAB MENU OPTIONS (HANDLED IN onRowAction)
	const ROW_MENU: MenuAction[] = [
		{ value: 'translate', label: 'Translate', icon: Languages },
		{ value: 'delete', label: 'Delete', icon: Trash2, danger: true },
	];

	// -- STATES -- //

	let rows: Entry[] = [];
	let total = 0;
	let page = 1;
	let pageSize = 10;
	let jumpValue: number | string = 1;
	let query = '';
	let loading = true;
	let busy = false;
	let newSource = '';
	let newTarget = '';
	let newGender: Gender = 'neuter';
	let newContext = '';
	let showAdd = false;
	let fileInput: HTMLInputElement;
	let debounce: ReturnType<typeof setTimeout>;
	let loadToken = 0; // GUARDS AGAINST OUT-OF-ORDER load() RESPONSES PAINTING STALE ROWS

	// -- REACTIVE STATES -- //

	$: scopeQs =
		scope === 'book' && bookId
			? `scope=book&bookId=${encodeURIComponent(bookId)}`
			: `scope=global&sourceLang=${encodeURIComponent(sourceLang)}&targetLang=${encodeURIComponent(targetLang)}`;
	$: pageCount = Math.max(1, Math.ceil(total / pageSize));
	// 1-BASED RANGE OF ROWS SHOWN ON THE CURRENT PAGE ("1–10 of 7,403")
	$: rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
	$: rangeTo = Math.min(page * pageSize, total);
	$: pageSurface = THEME_CLASS[$settings.theme] || 'bg-white dark:bg-slate-900';
	// IN A DIALOG (surface SET) THE PANEL IS A FLEX COLUMN THAT FILLS THE MODAL BODY: THE HEADER AND THE
	// PAGINATION FOOTER ARE FIXED FLEX ITEMS (shrink-0) AND ONLY THE TABLE AREA BETWEEN THEM SCROLLS — SO
	// THE SCROLLBAR LIVES ON THE TABLE, NOT THE WHOLE DIALOG. ON A STANDALONE PAGE THE PANEL FLOWS NORMALLY
	// AND THE HEADER STICKS TO THE DOCUMENT TOP.
	$: rootClass = surface ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-col gap-4';
	$: headerClass = cn(
		'flex flex-col gap-3 border-b border-black/[0.06] pb-3 dark:border-white/[0.045]',
		surface ? `shrink-0 pt-5 ${surface}` : `sticky top-0 z-20 pt-4 ${pageSurface}`,
	);
	// THE TABLE SCROLL AREA — THE ONLY SCROLLER IN DIALOG MODE; A TRANSPARENT PASS-THROUGH STANDALONE.
	$: scrollClass = surface ? 'min-h-0 flex-1 overflow-y-auto py-4' : '';
	$: footerClass = cn(
		'flex flex-col gap-3 border-t border-black/[0.06] pt-3 text-sm dark:border-white/[0.045] sm:flex-row sm:items-center sm:justify-between',
		surface ? `shrink-0 pb-5 ${surface}` : '',
	);
	// KEEP THE JUMP FIELD IN SYNC WITH THE CURRENT PAGE (USER EDITS IT THEN SUBMITS TO JUMP)
	$: jumpValue = page;

	// -- FUNCTIONS -- //

	async function load() {
		const token = ++loadToken;
		loading = true;
		try {
			const res = await fetch(
				`/api/glossary?${scopeQs}&page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`,
			);
			const data = await res.json();
			// IGNORE A RESPONSE THAT A NEWER load() (FROM RAPID PAGINATION/SEARCH) HAS ALREADY SUPERSEDED,
			// SO AN OLDER, SLOWER RESPONSE CAN'T OVERWRITE THE FRESH ROWS.
			if (token !== loadToken) return;
			rows = data.rows ?? [];
			total = data.total ?? 0;
		} catch {
			if (token === loadToken) toast.error('Could not load the glossary.');
		} finally {
			if (token === loadToken) loading = false;
		}
	}

	function onSearch() {
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			page = 1;
			load();
		}, 300);
	}

	function gotoPage(p: number) {
		page = Math.min(pageCount, Math.max(1, p));
		load();
	}

	// CHANGE HOW MANY ROWS SHOW PER PAGE — RESET TO THE FIRST PAGE SO THE OFFSET STAYS VALID
	function setPageSize(v: string) {
		pageSize = Number(v);
		page = 1;
		load();
	}

	// JUMP TO AN ARBITRARY PAGE INDEX (CLAMPED) FROM THE INPUT FIELD
	function jumpToPage() {
		const n = Number(jumpValue);
		gotoPage(Number.isFinite(n) && n > 0 ? Math.floor(n) : 1);
	}

	async function addRow() {
		if (!newSource.trim() || !newTarget.trim()) {
			toast.error('Both source and target are required.');
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/glossary', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					scope,
					bookId,
					// LANG PAIR IS ONLY USED FOR GLOBAL SCOPE (BOOK SCOPE INHERITS THE BOOK'S DIRECTION)
					sourceLang,
					targetLang,
					source: newSource,
					target: newTarget,
					gender: newGender,
					context: newContext.trim() || null,
				}),
			});
			if (!res.ok) throw new Error('Add failed');
			newSource = '';
			newTarget = '';
			newGender = 'neuter';
			newContext = '';
			showAdd = false;
			await load();
			toast.success('Term added.');
		} catch {
			toast.error('Could not add the term.');
		} finally {
			busy = false;
		}
	}

	async function saveRow(e: Entry) {
		try {
			const res = await fetch(`/api/glossary/${e.id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					source: e.source,
					target: e.target,
					gender: e.gender,
					context: e.context,
					tags: e.tags,
				}),
			});
			if (!res.ok) throw new Error('Save failed');
		} catch {
			toast.error('Could not save that term.');
		}
	}

	async function removeRow(id: number) {
		try {
			await fetch(`/api/glossary/${id}`, { method: 'DELETE' });
			await load();
		} catch {
			toast.error('Could not delete that term.');
		}
	}

	// AI-FILL A ROW'S TARGET-LANGUAGE RENDERING FROM ITS SOURCE TERM, THEN PERSIST IT
	async function translateRow(e: Entry) {
		const source = e.source.trim();
		if (!source) {
			toast.error('Add the source term first.');
			return;
		}
		const tid = toast.loading('Translating…');
		try {
			const res = await fetch('/api/translate-text', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: source, kind: 'term', bookId: scope === 'book' ? bookId : undefined }),
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.message ?? 'Translation failed');
			e.target = d.text;
			rows = rows; // REASSIGN SO THE BOUND INPUT REFLECTS THE NEW VALUE
			await saveRow(e);
			toast.success('Translated.', { id: tid });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not translate the term.', { id: tid });
		}
	}

	// KEBAB MENU ROUTER FOR A GLOSSARY ROW
	function onRowAction(e: Entry, action: string) {
		if (action === 'translate') translateRow(e);
		else if (action === 'delete') removeRow(e.id);
	}

	async function onImport(ev: Event) {
		const file = (ev.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		busy = true;
		const tid = toast.loading(`Importing ${file.name}…`);
		try {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('scope', scope);
			if (bookId) fd.append('bookId', bookId);
			// GLOBAL IMPORT TARGETS A SPECIFIC LANGUAGE PAIR; BOOK IMPORT INHERITS THE BOOK'S.
			if (scope === 'global') {
				fd.append('sourceLang', sourceLang);
				fd.append('targetLang', targetLang);
			}
			const res = await fetch('/api/glossary/import', { method: 'POST', body: fd });
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Import failed');
			const out = await res.json();
			toast.success(`Imported ${out.parsed} rows (${out.added} new, ${out.updated} updated).`, { id: tid });
			page = 1;
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Import failed.', { id: tid });
		} finally {
			busy = false;
			if (fileInput) fileInput.value = '';
		}
	}

	function exportHref(which: GlossaryScope): string {
		const b = bookId ? `&bookId=${encodeURIComponent(bookId)}` : '';
		// GLOBAL EXPORT IS SCOPED TO THE SELECTED LANGUAGE PAIR.
		const l =
			which === 'global'
				? `&sourceLang=${encodeURIComponent(sourceLang)}&targetLang=${encodeURIComponent(targetLang)}`
				: '';
		return `/api/glossary/export?scope=${which}${b}${l}`;
	}

	// CAST IN SCRIPT (TS `as` IS NOT ALLOWED INSIDE SVELTE TEMPLATE EXPRESSIONS)
	function setNewGender(v: string) {
		newGender = v as Gender;
	}
	function setRowGender(e: Entry, v: string) {
		e.gender = v as Gender;
		saveRow(e);
	}

	// -- LIFECYCLES -- //

	onMount(load);
	onDestroy(() => clearTimeout(debounce));
</script>

<!-- GLOSSARY PANEL: PAGINATED, SEARCHABLE, IMPORT/EXPORT. IN A DIALOG IT IS A FLEX COLUMN WHOSE TABLE
     AREA IS THE ONLY SCROLLER, KEEPING THE HEADER AND PAGINATION FOOTER FIXED. -->
<div class={rootClass}>
	<!-- FIXED HEADER: TOOLBAR + SEARCH (shrink-0 IN A DIALOG, STICKY ON A STANDALONE PAGE) -->
	<div class={headerClass}>
		<!-- TOOLBAR: ACTIONS ON ONE TIDY ROW, TERM COUNT RIGHT-ALIGNED (PREDICTABLE AT EVERY WIDTH) -->
		<div class="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
			<Button variant="primary" class="col-span-2 sm:col-auto" on:click={() => (showAdd = true)}>
				<Plus size={14} /> Add term
			</Button>
			<!-- IMPORT USES Download (ARROW IN), EXPORT USES Upload (ARROW OUT) — ARROWS MATCH THE IN/OUT MEANING -->
			<Button on:click={() => fileInput.click()} disabled={busy}><Download size={14} /> Import CSV</Button>
			<Button href={exportHref(scope)}><Upload size={14} /> Export</Button>
			<span class="col-span-2 text-center text-xs tabular-nums opacity-60 sm:col-auto sm:ml-auto sm:text-right">
				{total.toLocaleString()} terms
			</span>
			<input bind:this={fileInput} type="file" accept=".csv,text/csv" class="hidden" on:change={onImport} />
		</div>
		<!-- SCOPE NOTE -->
		<p class="text-xs opacity-50">
			{scope === 'global'
				? 'Applies to every book.'
				: `Private to ${bookTitle || 'this book'} — overrides the global glossary.`}
		</p>

		<!-- SEARCH -->
		<div class="relative">
			<Search size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
			<input
				bind:value={query}
				on:input={onSearch}
				type="search"
				placeholder="Search terms…"
				class="w-full rounded-lg border border-black/10 bg-transparent py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:opacity-40 focus:border-sky-500 dark:border-white/[0.06]"
			/>
		</div>
	</div>

	<!-- TABLE SCROLL AREA: ONLY THIS REGION SCROLLS IN A DIALOG; HEADER AND FOOTER STAY FIXED -->
	<div class={scrollClass}>
		{#if loading && rows.length === 0}
			<!-- FIRST LOAD ONLY — PAGINATION KEEPS THE CURRENT ROWS VISIBLE (JUST DIMMED) TO AVOID FLICKER -->
			<p class="py-6 text-center text-sm opacity-50">Loading…</p>
		{:else if rows.length === 0}
			<p class="py-6 text-center text-sm opacity-50">
				{query ? 'No matches.' : 'No terms yet — add or import some.'}
			</p>
		{:else}
			<div
				class="overflow-hidden rounded-xl border border-black/[0.06] transition-opacity dark:border-white/[0.045]"
				class:opacity-50={loading}
			>
				<!-- COLUMN HEADERS — DESKTOP ONLY; ALIGN WITH THE ROW COLUMNS BELOW -->
				<div
					class="hidden items-center gap-3 border-b border-black/[0.06] bg-black/[0.02] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide opacity-50 dark:border-white/[0.045] dark:bg-white/[0.02] sm:flex"
				>
					<span class="flex-1">Source</span>
					<span class="flex-1">Target</span>
					<span class="w-36 shrink-0">Gender</span>
					<span class="w-9 shrink-0" aria-hidden="true"></span>
				</div>
				<div class="divide-y divide-black/[0.06] dark:divide-white/[0.045]">
					{#each rows as e (e.id)}
						<!-- TERM ROW: STACKED CARD ON MOBILE, ALIGNED COLUMNS ON DESKTOP; CHANGES SAVE ON BLUR -->
						<div
							class="flex flex-col gap-2 p-2.5 transition-colors hover:bg-black/[0.015] dark:hover:bg-white/[0.015] sm:p-2"
						>
							<!-- PRIMARY FIELDS: RAW · TRANSLATION · GENDER · DELETE (ALIGN WITH THE COLUMN HEADERS) -->
							<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
								<input
									bind:value={e.source}
									on:change={() => saveRow(e)}
									placeholder="Source term"
									aria-label="Source term"
									class="w-full min-w-0 rounded-md border border-black/10 bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors hover:border-black/20 focus:border-sky-500 dark:border-white/[0.06] dark:hover:border-white/20 sm:flex-1"
								/>
								<input
									bind:value={e.target}
									on:change={() => saveRow(e)}
									placeholder="Target rendering"
									aria-label="Target-language rendering"
									class="w-full min-w-0 rounded-md border border-black/10 bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors hover:border-black/20 focus:border-sky-500 dark:border-white/[0.06] dark:hover:border-white/20 sm:flex-1"
								/>
								<!-- GENDER + KEBAB SHARE A ROW ON MOBILE, BECOME ALIGNED COLUMNS ON DESKTOP (sm:contents) -->
								<div class="flex items-center gap-2 sm:contents">
									<Select
										items={GENDER_ITEMS}
										value={e.gender}
										on:change={(ev) => setRowGender(e, ev.detail)}
										class="flex-1 sm:w-36 sm:flex-none"
									/>
									<!-- ROW ACTIONS: TRANSLATE FROM RAW / DELETE -->
									<ActionMenu
										class="shrink-0"
										label="Term actions"
										items={ROW_MENU}
										on:select={(ev) => onRowAction(e, ev.detail)}
									/>
								</div>
							</div>
							<!-- CONTEXT: TRANSLATOR-FACING NOTE — FULL-WIDTH SECOND LINE, DIMMED TO READ AS SECONDARY -->
							<input
								bind:value={e.context}
								on:change={() => saveRow(e)}
								placeholder="Context — who/what this is, to guide translation (optional)"
								aria-label="Translator context note"
								class="w-full min-w-0 rounded-md border border-black/[0.06] bg-transparent px-2.5 py-1.5 text-xs opacity-75 outline-none transition-colors hover:border-black/20 focus:border-sky-500 focus:opacity-100 dark:border-white/[0.045] dark:hover:border-white/20"
							/>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- PAGINATION FOOTER: FIXED (shrink-0) IN A DIALOG, NORMAL FLOW STANDALONE; SHOWN ONLY WHEN ROWS EXIST -->
	{#if rows.length > 0}
		<div class={footerClass}>
			<!-- ROWS PER PAGE + RANGE -->
			<div class="flex items-center justify-between gap-3 sm:justify-start">
				<div class="flex items-center gap-2">
					<span class="shrink-0 opacity-60">Show</span>
					<Select
						items={PAGE_SIZE_ITEMS}
						value={String(pageSize)}
						on:change={(e) => setPageSize(e.detail)}
						class="w-28"
					/>
				</div>
				<span class="shrink-0 text-xs tabular-nums opacity-50">
					{rangeFrom.toLocaleString()}–{rangeTo.toLocaleString()} of {total.toLocaleString()}
				</span>
			</div>
			<!-- PAGE NAV: FIRST / PREV / JUMP / NEXT / LAST -->
			<div class="flex items-center justify-center gap-1.5 sm:justify-end">
				<Button size="sm" class="hidden sm:inline-flex" disabled={page <= 1} on:click={() => gotoPage(1)}>
					<ChevronsLeft size={16} /><span class="sr-only">First page</span>
				</Button>
				<Button size="sm" disabled={page <= 1} on:click={() => gotoPage(page - 1)}>
					<ChevronLeft size={16} /><span class="sr-only">Previous page</span>
				</Button>
				<form class="flex items-center gap-1.5" on:submit|preventDefault={jumpToPage}>
					<span class="opacity-60">Page</span>
					<input
						type="number"
						min="1"
						max={pageCount}
						bind:value={jumpValue}
						on:change={jumpToPage}
						aria-label="Jump to page"
						class="w-14 rounded-md border border-black/10 bg-transparent px-2 py-1 text-center text-sm tabular-nums outline-none focus:border-sky-500 dark:border-white/[0.06]"
					/>
					<span class="shrink-0 opacity-60">of {pageCount.toLocaleString()}</span>
				</form>
				<Button size="sm" disabled={page >= pageCount} on:click={() => gotoPage(page + 1)}>
					<ChevronRight size={16} /><span class="sr-only">Next page</span>
				</Button>
				<Button
					size="sm"
					class="hidden sm:inline-flex"
					disabled={page >= pageCount}
					on:click={() => gotoPage(pageCount)}
				>
					<ChevronsRight size={16} /><span class="sr-only">Last page</span>
				</Button>
			</div>
		</div>
	{/if}
</div>

<!-- ADD TERM DIALOG -->
<Modal open={showAdd} title="Add term" size="sm" on:close={() => (showAdd = false)}>
	<form class="flex flex-col gap-4" on:submit|preventDefault={addRow}>
		<label class="block">
			<span class="mb-1 block text-xs font-medium opacity-60">Source term</span>
			<input
				bind:value={newSource}
				placeholder="source term"
				class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
			/>
		</label>
		<label class="block">
			<span class="mb-1 block text-xs font-medium opacity-60">Target rendering</span>
			<input
				bind:value={newTarget}
				placeholder="target rendering"
				class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
			/>
		</label>
		<!-- NOT A <label>: Select IS A CUSTOM WIDGET, NOT A NATIVE CONTROL A LABEL CAN BIND TO -->
		<div class="block">
			<span class="mb-1 block text-xs font-medium opacity-60">Gender</span>
			<Select items={GENDER_ITEMS} value={newGender} on:change={(e) => setNewGender(e.detail)} />
		</div>
		<label class="block">
			<span class="mb-1 block text-xs font-medium opacity-60">Context (optional)</span>
			<textarea
				bind:value={newContext}
				rows="2"
				placeholder="Who or what this is — guides how it's translated (e.g. protagonist's senior martial brother)"
				class="w-full resize-y rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
			></textarea>
		</label>
		<!-- HIDDEN SUBMIT: LETS ENTER SUBMIT THE FORM WHILE THE VISIBLE ACTION LIVES IN THE FOOTER -->
		<button type="submit" class="hidden" disabled={busy} aria-hidden="true"></button>
	</form>
	<svelte:fragment slot="footer">
		<Button on:click={() => (showAdd = false)}>Cancel</Button>
		<Button variant="primary" loading={busy} disabled={busy} on:click={addRow}><Plus size={14} /> Add term</Button>
	</svelte:fragment>
</Modal>
