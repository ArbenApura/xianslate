<script lang="ts">
	// IMPORTED DEP-TYPES
	// IMPORTED TYPES
	import type { SourceType } from '$lib/types';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { AUTO_SOURCE, isMonolingual } from '$lib/languages';
	import { settings } from '$lib/stores/settings';
	import { ripple } from '$lib/actions/ripple';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Check from 'lucide-svelte/icons/check';
	import Globe from 'lucide-svelte/icons/globe';
	import Image from 'lucide-svelte/icons/image';
	import Library from 'lucide-svelte/icons/library';
	import ListOrdered from 'lucide-svelte/icons/list-ordered';
	import Plus from 'lucide-svelte/icons/plus';
	import Search from 'lucide-svelte/icons/search';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	// IMPORTED TYPES
	import type { MenuAction } from '$lib/components/ui/ActionMenu.svelte';
	// IMPORTED COMPONENTS
	import ActionMenu from '$lib/components/ui/ActionMenu.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import LanguagePicker from '$lib/components/ui/LanguagePicker.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import TextField from '$lib/components/ui/TextField.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	// -- TYPES -- //

	type BookSummary = {
		id: string;
		title: string;
		titleTarget: string | null;
		author: string | null;
		authorTarget: string | null;
		sourceType: SourceType;
		sourceLang: string;
		targetLang: string;
		sourceUrl: string | null;
		coverUrl: string | null;
		chapterCount: number;
		readChapters: number;
		translatedChapters: number;
		lastChapterUuid: string | null;
		firstChapterUuid: string | null;
		lastReadAt: number | null;
		createdAt: number;
	};

	type SortKey = 'recent' | 'added' | 'title' | 'progress' | 'chapters';
	type SourceFilter = 'all' | SourceType;
	type StatusFilter = 'all' | 'reading' | 'unread' | 'finished';

	// -- CONSTANTS -- //

	// COMPLETE LITERAL GRADIENT CLASSES (PICKED DETERMINISTICALLY PER TITLE) — KEEPS cn() HAPPY
	const COVERS = [
		'from-rose-500 to-orange-400',
		'from-sky-500 to-indigo-600',
		'from-emerald-500 to-teal-600',
		'from-violet-500 to-fuchsia-600',
		'from-amber-500 to-red-500',
		'from-cyan-500 to-blue-600',
		'from-lime-500 to-emerald-600',
		'from-pink-500 to-rose-600',
		'from-indigo-500 to-purple-600',
		'from-teal-500 to-cyan-600',
	];
	const SOURCE_BADGE: Record<string, string> = { web: 'WEB', epub: 'EPUB', txt: 'TXT', manual: 'BOOK' };

	const SORT_ITEMS = [
		{ value: 'recent', label: 'Recently read' },
		{ value: 'added', label: 'Recently added' },
		{ value: 'title', label: 'Title (A–Z)' },
		{ value: 'progress', label: 'Reading progress' },
		{ value: 'chapters', label: 'Most chapters' },
	];
	const SOURCE_ITEMS = [
		{ value: 'all', label: 'All sources' },
		{ value: 'web', label: 'Web' },
		{ value: 'epub', label: 'EPUB' },
		{ value: 'txt', label: 'TXT' },
		{ value: 'manual', label: 'Manual' },
	];
	const STATUS_ITEMS = [
		{ value: 'all', label: 'All' },
		{ value: 'reading', label: 'Reading' },
		{ value: 'unread', label: 'Unread' },
		{ value: 'finished', label: 'Finished' },
	];
	const PREFS_KEY = 'xianslate:library';
	// PER-CARD KEBAB MENU IS BUILT PER BOOK (SEE bookActions) SO THE COVER ACTION ONLY APPEARS FOR WEB
	// BOOKS WITH A SOURCE PAGE. ALWAYS TAPPABLE (THE OLD HOVER-ONLY DELETE COULDN'T BE TRIGGERED ON TOUCH).

	// -- STATES -- //

	let booksList: BookSummary[] = [];
	let loading = true;
	let urlInput = '';
	let busy = false;
	let epubInput: HTMLInputElement;
	let txtInput: HTMLInputElement;
	let showAddBook = false;
	let emptyTitle = '';
	let emptyAuthor = '';
	// A CHOSEN-BUT-NOT-YET-IMPORTED FILE. SELECTING AN EPUB/TXT *STAGES* IT HERE INSTEAD OF IMPORTING
	// IMMEDIATELY, SO THE USER CONFIRMS THE TARGET LANGUAGE + AN EXPLICIT "Import" CLICK FIRST (NO AUTO-SUBMIT).
	let pendingImport: { kind: 'epub' | 'txt'; file: File } | null = null;
	let pendingDelete: BookSummary | null = null;
	// PER-BOOK DIRECTION FOR THE NEXT FETCH/IMPORT/CREATE — SOURCE DEFAULTS TO AUTO-DETECT; TARGET IS
	// SEEDED FROM THE GLOBAL DEFAULT. BOTH ARE EDITABLE IN THE ADD-BOOK DIALOG.
	let newSourceLang = AUTO_SOURCE;
	let newTargetLang = get(settings).newBookTargetLang;

	// SORT / FILTER / SEARCH (PERSISTED IN localStorage)
	let sortKey: SortKey = 'recent';
	let sourceFilter: SourceFilter = 'all';
	let statusFilter: StatusFilter = 'all';
	let search = '';

	// -- REACTIVE STATES -- //

	// MOST RECENTLY *READ* BOOK (NOT THE FIRST-CREATED). FALLS BACK TO ANY BOOK WITH A RESUME POINT.
	$: continueBook =
		[...booksList].filter((b) => b.lastChapterUuid).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0] ??
		null;

	// SHELF = SEARCH + SOURCE + STATUS FILTERED, THEN SORTED. THE HERO STAYS GLOBAL (UNFILTERED).
	$: q = search.trim().toLowerCase();
	$: shelf = sortBooks(
		booksList.filter((b) => {
			if (sourceFilter !== 'all' && b.sourceType !== sourceFilter) return false;
			if (statusFilter === 'reading' && !(b.readChapters > 0 && !isFinished(b))) return false;
			if (statusFilter === 'unread' && b.readChapters > 0) return false;
			if (statusFilter === 'finished' && !isFinished(b)) return false;
			if (q) {
				const hay = `${b.titleTarget ?? ''} ${b.title} ${b.authorTarget ?? ''} ${b.author ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		}),
		sortKey,
	);

	// -- REACTIVE STATEMENTS -- //

	// PERSIST PREFS WHENEVER THEY CHANGE
	$: if (browser) savePrefs(sortKey, sourceFilter, statusFilter);

	// -- FUNCTIONS -- //

	// READING-PROGRESS FRACTION (0..1) — RESUME POSITION OVER TOTAL CHAPTERS
	function progressFrac(b: BookSummary): number {
		return b.chapterCount > 0 ? Math.min(1, b.readChapters / b.chapterCount) : 0;
	}

	function isFinished(b: BookSummary): boolean {
		return b.chapterCount > 0 && b.readChapters >= b.chapterCount;
	}

	function sortBooks(list: BookSummary[], key: SortKey): BookSummary[] {
		const arr = [...list];
		const name = (b: BookSummary) => (b.titleTarget || b.title || '').toLowerCase();
		switch (key) {
			case 'title':
				return arr.sort((a, b) => name(a).localeCompare(name(b)));
			case 'added':
				return arr.sort((a, b) => b.createdAt - a.createdAt);
			case 'chapters':
				return arr.sort((a, b) => b.chapterCount - a.chapterCount);
			case 'progress':
				return arr.sort((a, b) => progressFrac(b) - progressFrac(a));
			case 'recent':
			default:
				// READ BOOKS FIRST (NEWEST READ ON TOP), THEN UNREAD BY MOST-RECENTLY-ADDED
				return arr.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.createdAt - a.createdAt);
		}
	}

	function loadPrefs() {
		if (!browser) return;
		try {
			const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
			if (SORT_ITEMS.some((i) => i.value === p.sortKey)) sortKey = p.sortKey;
			if (SOURCE_ITEMS.some((i) => i.value === p.sourceFilter)) sourceFilter = p.sourceFilter;
			if (STATUS_ITEMS.some((i) => i.value === p.statusFilter)) statusFilter = p.statusFilter;
		} catch {
			// IGNORE CORRUPT PREFS
		}
	}

	function savePrefs(s: SortKey, src: SourceFilter, st: StatusFilter) {
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify({ sortKey: s, sourceFilter: src, statusFilter: st }));
		} catch {
			// IGNORE QUOTA ERRORS
		}
	}

	// CAST IN SCRIPT (TS `as` IS NOT ALLOWED INSIDE SVELTE TEMPLATE EXPRESSIONS)
	function setSort(v: string) {
		sortKey = v as SortKey;
	}

	function setSource(v: string) {
		sourceFilter = v as SourceFilter;
	}

	function setStatus(v: string) {
		statusFilter = v as StatusFilter;
	}

	function coverClass(title: string): string {
		let h = 0;
		for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
		return COVERS[h % COVERS.length];
	}

	// HIDE A BROKEN COVER IMAGE SO THE GRADIENT PLACEHOLDER BEHIND IT SHOWS THROUGH (CAST LIVES IN SCRIPT —
	// TS `as` ISN'T ALLOWED INSIDE A SVELTE TEMPLATE EXPRESSION).
	function hideImg(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	async function loadBooks() {
		loading = true;
		try {
			const res = await apiFetch('/api/books');
			booksList = await res.json();
		} catch {
			toast.error('Could not load your library.');
		} finally {
			loading = false;
		}
	}

	// LAZILY TRANSLATE + CACHE ANY MISSING BOOK TITLES / AUTHOR NAMES. RUNS THROUGH A SMALL CONCURRENT
	// POOL RATHER THAN STRICTLY SEQUENTIALLY: A LIBRARY OF FRESHLY-IMPORTED BOOKS USED TO HYDRATE ITS
	// TITLES ONE BLOCKING ROUND-TRIP AT A TIME. THE SERVER'S OWN DEEPSEEK QUEUE STILL CAPS REAL MODEL
	// CALLS GLOBALLY, SO THIS ONLY REMOVES STACKED REQUEST LATENCY — IT DOESN'T INCREASE API PRESSURE.
	async function backfillTitles() {
		// SKIP "READ IN ORIGINAL" BOOKS — THEY HAVE NO TRANSLATION DIRECTION, SO THE LIBRARY SHOWS THEIR
		// SOURCE TITLE/AUTHOR AS-IS (TRANSLATING THEM WOULD RENDER INTO THE FALLBACK LANGUAGE, WHICH IS WRONG).
		const pending = booksList.filter(
			(b) => !isMonolingual(b.targetLang) && (!b.titleTarget || (b.author && !b.authorTarget)),
		);
		if (pending.length === 0) return;
		const POOL = 4;
		let cursor = 0;
		const backfillOne = async (b: BookSummary) => {
			try {
				const res = await apiFetch(`/api/books/${b.id}`, { method: 'POST' });
				const { titleTarget, authorTarget } = await res.json();
				booksList = booksList.map((x) =>
					x.id === b.id
						? {
								...x,
								titleTarget: titleTarget ?? x.titleTarget,
								authorTarget: authorTarget ?? x.authorTarget,
							}
						: x,
				);
			} catch {
				// IGNORE — KEEP THE ORIGINAL TITLE / AUTHOR
			}
		};
		const worker = async () => {
			while (cursor < pending.length) {
				const b = pending[cursor++];
				await backfillOne(b);
			}
		};
		await Promise.all(Array.from({ length: Math.min(POOL, pending.length) }, worker));
	}

	function openBook(b: BookSummary) {
		const ch = b.lastChapterUuid ?? b.firstChapterUuid;
		// EMPTY BOOK → OPEN THE MANAGEMENT PAGE TO ADD CHAPTERS / CURATE THE GLOSSARY
		if (!ch) {
			goto(`/app/book/${b.id}/manage/`);
			return;
		}
		goto(`/app/book/${b.id}/?ch=${ch}`);
	}

	async function addEmptyBook() {
		const title = emptyTitle.trim();
		if (!title || busy) return;
		busy = true;
		try {
			const res = await apiFetch('/api/books', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title,
					author: emptyAuthor.trim() || undefined,
					sourceLang: newSourceLang,
					targetLang: newTargetLang,
				}),
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Could not create book');
			const { id } = await res.json();
			showAddBook = false;
			goto(`/app/book/${id}/manage/`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not create the book.');
		} finally {
			busy = false;
		}
	}

	async function addByUrl() {
		if (!urlInput.trim()) return;
		busy = true;
		try {
			const res = await apiFetch('/api/fetch', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: urlInput.trim(), sourceLang: newSourceLang, targetLang: newTargetLang }),
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Fetch failed');
			const view = await res.json();
			toast.success('Chapter fetched!');
			showAddBook = false;
			goto(`/app/book/${view.bookId}/?ch=${view.uuid}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not fetch that URL.');
		} finally {
			busy = false;
		}
	}

	// COMMIT THE STAGED FILE (THE EXPLICIT "Import" CLICK) — NOTHING IMPORTS UNTIL THE USER CONFIRMS HERE.
	function confirmImport() {
		if (pendingImport && !busy) importFile(pendingImport.kind, pendingImport.file);
	}

	async function importFile(kind: 'epub' | 'txt', file: File) {
		busy = true;
		const tid = toast.loading(`Importing ${file.name}…`);
		try {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('sourceLang', newSourceLang);
			fd.append('targetLang', newTargetLang);
			const res = await apiFetch(`/api/import/${kind}`, { method: 'POST', body: fd });
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Import failed');
			const data = await res.json();
			toast.success(`Imported "${data.title}" (${data.chapters} chapters)`, { id: tid });
			showAddBook = false;
			goto(`/app/book/${data.bookId}/?ch=${data.firstChapterUuid}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Import failed.', { id: tid });
		} finally {
			busy = false;
		}
	}

	// KEBAB ROUTER FOR A BOOK CARD — OPEN / MANAGE CHAPTERS / DELETE.
	// WEB BOOKS WITH A SOURCE PAGE CAN (RE)FETCH THEIR COVER FROM IT.
	function canFetchCover(b: BookSummary): boolean {
		return !!b.sourceUrl && /^https?:\/\//i.test(b.sourceUrl);
	}

	function bookActions(b: BookSummary): MenuAction[] {
		const acts: MenuAction[] = [
			{ value: 'open', label: 'Open', icon: BookOpen },
			{ value: 'manage', label: 'Manage chapters', icon: ListOrdered },
		];
		if (canFetchCover(b))
			acts.push({ value: 'cover', label: b.coverUrl ? 'Refetch cover' : 'Fetch cover', icon: Image });
		acts.push({ value: 'delete', label: 'Delete', icon: Trash2, danger: true });
		return acts;
	}

	function onBookAction(b: BookSummary, action: string) {
		if (action === 'open') openBook(b);
		else if (action === 'manage') goto(`/app/book/${b.id}/manage/`);
		else if (action === 'cover') fetchCover(b);
		else if (action === 'delete') pendingDelete = b;
	}

	// (RE)FETCH A BOOK COVER FROM ITS SOURCE PAGE, THEN UPDATE THE CARD IN PLACE (NO RELOAD). A CACHE-BUST
	// SUFFIX FORCES THE <img> TO RELOAD EVEN WHEN THE COVER URL IS UNCHANGED (E.G. THE SITE SWAPPED THE ART).
	async function fetchCover(b: BookSummary) {
		const tid = toast.loading(b.coverUrl ? 'Refetching cover…' : 'Fetching cover…');
		try {
			const res = await apiFetch(`/api/books/${b.id}/cover`, { method: 'POST' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'Could not fetch the cover.');
			if (!data.coverUrl) {
				toast.error('No cover image found on this book’s source page.', { id: tid });
				return;
			}
			const bust = `${data.coverUrl}${data.coverUrl.includes('?') ? '&' : '?'}_=${Date.now()}`;
			booksList = booksList.map((x) => (x.id === b.id ? { ...x, coverUrl: bust } : x));
			toast.success(b.coverUrl ? 'Cover refreshed!' : 'Cover added!', { id: tid });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not fetch the cover.', { id: tid });
		}
	}

	async function confirmDelete() {
		const b = pendingDelete;
		pendingDelete = null;
		if (!b) return;
		try {
			await apiFetch(`/api/books/${b.id}`, { method: 'DELETE' });
			booksList = booksList.filter((x) => x.id !== b.id);
			toast.success('Book deleted.');
		} catch {
			toast.error('Could not delete the book.');
		}
	}

	// -- LIFECYCLES -- //

	onMount(async () => {
		loadPrefs();
		await loadBooks();
		backfillTitles();
	});
</script>

<svelte:head><title>Xianslate — Library</title></svelte:head>

<!-- THEME COMES FROM THE LAYOUT ROOT (CONSISTENT ACROSS PAGES) -->
<div class="min-h-screen">
	<!-- TOP BAR -->
	<header
		class="sticky top-0 z-20 border-b border-black/[0.06] bg-black/5 backdrop-blur dark:border-white/[0.045] dark:bg-white/5"
	>
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
			<div class="flex items-center gap-2">
				<span class="flex items-center gap-2 text-xl font-bold tracking-tight"
					><BookOpen size={20} class="text-sky-600" /> Xianslate</span
				>
				<span class="hidden text-xs opacity-50 sm:inline">· multilingual novel reader</span>
			</div>
			<!-- NAVIGATION LINKS + PRIMARY "ADD BOOK" CTA -->
			<div class="flex items-center gap-2">
				<!-- SITES & AI COST DASHBOARD — ICON-ONLY ON MOBILE TO LEAVE ROOM FOR THE PRIMARY CTA -->
				<a
					use:ripple
					href="/admin/"
					class="hover:bg-current/5 inline-flex items-center gap-1.5 rounded-lg border border-black/[0.06] px-2.5 py-1.5 text-sm dark:border-white/[0.045] sm:px-3"
					aria-label="Sites"
				>
					<Globe size={15} /> <span class="hidden sm:inline">Sites</span>
				</a>
				<!-- GLOSSARY NAVIGATION LINK -->
				<a
					use:ripple
					href="/app/glossary/"
					class="hover:bg-current/5 inline-flex items-center gap-1.5 rounded-lg border border-black/[0.06] px-2.5 py-1.5 text-sm dark:border-white/[0.045] sm:px-3"
					aria-label="Glossary"
				>
					<Library size={15} /> <span class="hidden sm:inline">Glossary</span>
				</a>
				<!-- PRIMARY CALL TO ACTION -->
				<button
					use:ripple
					on:click={() => (showAddBook = true)}
					class="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700"
				>
					<Plus size={15} /> Add book
				</button>
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
		<!-- HIDDEN FILE INPUTS — TRIGGERED FROM THE ADD-BOOK DIALOG (THE VISIBLE CTA LIVES IN THE HEADER) -->
		<input
			bind:this={epubInput}
			type="file"
			accept=".epub"
			class="hidden"
			on:change={(e) => {
				const f = e.currentTarget.files?.[0];
				if (f) pendingImport = { kind: 'epub', file: f };
				e.currentTarget.value = '';
			}}
		/>
		<input
			bind:this={txtInput}
			type="file"
			accept=".txt,text/plain"
			class="hidden"
			on:change={(e) => {
				const f = e.currentTarget.files?.[0];
				if (f) pendingImport = { kind: 'txt', file: f };
				e.currentTarget.value = '';
			}}
		/>

		<!-- CONTINUE READING HERO -->
		{#if continueBook}
			<section class="mb-10">
				<h2 class="mb-3 text-xs font-semibold uppercase tracking-widest opacity-50">Continue reading</h2>
				<button
					use:ripple
					on:click={() => openBook(continueBook)}
					class="bg-current/[0.03] flex w-full items-stretch gap-4 overflow-hidden rounded-2xl border border-black/[0.06] p-4 text-left shadow-sm transition hover:shadow-md dark:border-white/[0.045] sm:gap-5"
				>
					<!-- MINI COVER -->
					<div
						class={cn(
							'relative flex h-28 w-20 shrink-0 items-end overflow-hidden rounded-lg bg-gradient-to-br p-2 sm:h-32 sm:w-24',
							coverClass(continueBook.title),
						)}
					>
						<span class="absolute left-0 top-0 h-full w-1.5 bg-black/20"></span>
						<span class="line-clamp-3 text-[11px] font-semibold leading-tight text-white drop-shadow"
							>{continueBook.titleTarget || continueBook.title}</span
						>
						<!-- FETCHED BOOK COVER — OVERLAYS THE GRADIENT FALLBACK; HIDES ITSELF IF IT FAILS TO LOAD -->
						{#if continueBook.coverUrl}
							<img
								src={continueBook.coverUrl}
								alt=""
								class="absolute inset-0 h-full w-full object-cover"
								on:error={hideImg}
							/>
						{/if}
					</div>
					<div class="flex min-w-0 flex-1 flex-col justify-center">
						<span class="line-clamp-2 text-lg font-bold"
							>{continueBook.titleTarget || continueBook.title}</span
						>
						{#if continueBook.author}<span class="mt-0.5 text-sm opacity-60"
								>{continueBook.authorTarget || continueBook.author}</span
							>{/if}
						<!-- READING PROGRESS -->
						{#if continueBook.chapterCount > 0}
							<div class="mt-2 max-w-xs">
								<div class="mb-1 flex items-center justify-between text-xs opacity-60">
									<span>Chapter {continueBook.readChapters} of {continueBook.chapterCount}</span>
									<span class="tabular-nums">{Math.round(progressFrac(continueBook) * 100)}%</span>
								</div>
								<div class="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
									<!-- RUNTIME-DYNAMIC WIDTH: PERCENTAGE DERIVED FROM PER-BOOK READ PROGRESS -->
									<div
										class="h-full rounded-full bg-sky-500"
										style="width:{progressFrac(continueBook) * 100}%"
									></div>
								</div>
							</div>
						{/if}
						<span
							class="mt-3 inline-flex w-fit items-center rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white"
							>Resume →</span
						>
					</div>
				</button>
			</section>
		{/if}

		<!-- BOOKSHELF -->
		<section>
			<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h2 class="text-xs font-semibold uppercase tracking-widest opacity-50">
					Library {#if !loading}({shelf.length}{#if shelf.length !== booksList.length}
							of {booksList.length}{/if}){/if}
				</h2>
				<!-- TOOLBAR: SEARCH (FULL-WIDTH ON MOBILE) + SORT/FILTER SELECTS (3-UP GRID ON MOBILE) -->
				{#if !loading && booksList.length > 0}
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<div class="relative w-full sm:w-44">
							<Search
								size={15}
								class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40"
							/>
							<input
								bind:value={search}
								type="search"
								placeholder="Search title or author…"
								class="w-full rounded-lg border border-black/10 bg-transparent py-2 pl-8 pr-2.5 text-sm outline-none placeholder:opacity-40 focus:border-sky-500 dark:border-white/[0.08] sm:py-1.5"
							/>
						</div>
						<div class="grid grid-cols-3 gap-2 sm:flex sm:items-center">
							<Select
								items={SORT_ITEMS}
								value={sortKey}
								on:change={(e) => setSort(e.detail)}
								class="w-full sm:w-40"
							/>
							<Select
								items={SOURCE_ITEMS}
								value={sourceFilter}
								on:change={(e) => setSource(e.detail)}
								class="w-full sm:w-32"
							/>
							<Select
								items={STATUS_ITEMS}
								value={statusFilter}
								on:change={(e) => setStatus(e.detail)}
								class="w-full sm:w-28"
							/>
						</div>
					</div>
				{/if}
			</div>
			{#if loading}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
					{#each [0, 1, 2, 3, 4] as i (i)}<div
							class="aspect-[2/3] animate-pulse rounded-xl bg-black/10 dark:bg-white/10"
						></div>{/each}
				</div>
			{:else if booksList.length === 0}
				<p
					class="rounded-xl border border-dashed border-black/10 p-10 text-center text-sm opacity-60 dark:border-white/[0.06]"
				>
					Your shelf is empty. Add a book above to start reading.
				</p>
			{:else if shelf.length === 0}
				<p
					class="rounded-xl border border-dashed border-black/10 p-10 text-center text-sm opacity-60 dark:border-white/[0.06]"
				>
					No books match your filters.
				</p>
			{:else}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
					{#each shelf as b (b.id)}
						{@const frac = progressFrac(b)}
						{@const done = isFinished(b)}
						<!-- BOOK CARD ON THE SHELF -->
						<div class="group flex flex-col gap-2">
							<div
								use:ripple
								role="button"
								tabindex="0"
								on:click={() => openBook(b)}
								on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && openBook(b)}
								class={cn(
									'relative flex aspect-[2/3] cursor-pointer flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br p-3 shadow-md transition duration-200 group-hover:-translate-y-1 group-hover:shadow-xl',
									coverClass(b.title),
								)}
							>
								<!-- SPINE -->
								<span class="absolute left-0 top-0 h-full w-2 bg-black/20"></span>
								<!-- FETCHED COVER — FULL-BLEED OVER THE GRADIENT; HIDES ITSELF IF IT FAILS TO LOAD -->
								{#if b.coverUrl}
									<img
										src={b.coverUrl}
										alt=""
										loading="lazy"
										decoding="async"
										class="absolute inset-0 h-full w-full object-cover"
										on:error={hideImg}
									/>
									<!-- BOTTOM SCRIM KEEPS THE TITLE READABLE OVER ANY COVER — linear-gradient CAN'T BE A TAILWIND CLASS -->
									<span
										class="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
										style="background: linear-gradient(to top, rgba(0,0,0,0.85), transparent);"
									></span>
								{/if}
								<!-- TOP ROW: SOURCE + DONE BADGES (THE KEBAB LIVES IN THE FOOTER BELOW, OFF THE COVER). -->
								<div class="flex flex-wrap items-center gap-1">
									<span
										class="inline-flex w-fit rounded bg-black/25 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white"
										>{SOURCE_BADGE[b.sourceType]}</span
									>
									{#if done}
										<span
											class="inline-flex items-center gap-0.5 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white"
											><Check size={10} /> DONE</span
										>
									{/if}
								</div>
								<!-- TITLE PINNED TO THE COVER BOTTOM (OVER ART OR GRADIENT). THE FOOTER BELOW SHOWS ONLY
								     AUTHOR/CHAPTER META, SO THE TITLE ISN'T DUPLICATED. -->
								<span class="ml-1 line-clamp-4 text-sm font-bold leading-tight text-white drop-shadow"
									>{b.titleTarget || b.title}</span
								>
								<!-- READING-PROGRESS BAR PINNED TO THE COVER FOOT -->
								{#if b.readChapters > 0 && !done}
									<div class="absolute inset-x-0 bottom-0 h-1 bg-black/25">
										<!-- RUNTIME-DYNAMIC WIDTH: PERCENTAGE DERIVED FROM PER-BOOK READ PROGRESS -->
										<div class="h-full bg-white/90" style="width:{frac * 100}%"></div>
									</div>
								{/if}
							</div>
							<!-- FOOTER: TITLE/META ON THE LEFT, BOOK-ACTIONS KEBAB ON THE RIGHT. THE KEBAB IS OUTSIDE THE
							     CLICKABLE COVER, SO IT NEVER FIRES THE CARD RIPPLE/OPEN AND IS ALWAYS VISIBLE (NOT OVER ART). -->
							<div class="flex items-center justify-between gap-1 px-0.5">
								<div class="min-w-0 flex-1">
									<!-- META ONLY — THE TITLE LIVES ON THE COVER ABOVE, SO IT ISN'T REPEATED HERE. -->
									<p class="flex items-center gap-1 text-xs opacity-60">
										{#if b.author}<span class="truncate">{b.authorTarget || b.author}</span> ·{/if}
										<span class="shrink-0">
											{#if done}Finished · {b.chapterCount} ch
											{:else if b.readChapters > 0}{b.readChapters}/{b.chapterCount} ch · {Math.round(
													frac * 100,
												)}%
											{:else}{b.chapterCount} ch{/if}
										</span>
									</p>
								</div>
								<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
								<div class="-mr-1 shrink-0" on:click|stopPropagation>
									<ActionMenu
										label="Book actions"
										items={bookActions(b)}
										iconSize={20}
										class="rounded-lg p-2 opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
										on:select={(e) => onBookAction(b, e.detail)}
									/>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</main>
</div>

<!-- ADD A BOOK: FROM URL, FILE IMPORT, OR AN EMPTY BOOK TO CURATE LATER -->
<Modal
	open={showAddBook}
	title="Add a book"
	size="md"
	on:close={() => {
		showAddBook = false;
		pendingImport = null;
	}}
>
	<div class="flex flex-col gap-5">
		<!-- TARGET LANGUAGE FOR THE NEW BOOK — APPLIES TO WHICHEVER ADD METHOD BELOW YOU USE. THE SOURCE IS
		     ALWAYS AUTO-DETECTED FROM THE CONTENT, SO THERE'S NO SOURCE PICKER. -->
		<div class="min-w-0">
			<span class="mb-1.5 block text-xs font-medium opacity-60">Translate into</span>
			<LanguagePicker value={newTargetLang} on:change={(e) => (newTargetLang = e.detail)} />
			<p class="mt-1.5 text-xs opacity-50">
				The original language is detected automatically. Pick a target, or “Read in original” to skip
				translation.
			</p>
		</div>

		<!-- FROM URL -->
		<form
			class="flex min-w-0 flex-col gap-2 border-t border-black/[0.06] pt-4 dark:border-white/[0.045]"
			on:submit|preventDefault={addByUrl}
		>
			<TextField bind:value={urlInput} type="url" label="From a URL" placeholder="Paste a chapter URL…" />
			<Button type="submit" variant="primary" loading={busy} disabled={busy || !urlInput.trim()} class="w-fit">
				Add from URL
			</Button>
		</form>

		<!-- IMPORT A FILE — PICKING A FILE STAGES IT; THE USER THEN CLICKS "Import" (NO AUTO-SUBMIT ON SELECT) -->
		<div class="border-t border-black/[0.06] pt-4 dark:border-white/[0.045]">
			<span class="mb-2 block text-xs font-medium opacity-60">Import a file</span>
			{#if pendingImport}
				<!-- STAGED FILE — CONFIRM OR CLEAR BEFORE ANYTHING IS CREATED -->
				<div
					class="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-black/[0.02] p-2.5 dark:border-white/[0.08] dark:bg-white/[0.02]"
				>
					<span
						class="inline-flex rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider dark:bg-white/10"
						>{pendingImport.kind.toUpperCase()}</span
					>
					<span class="min-w-0 flex-1 truncate text-sm">{pendingImport.file.name}</span>
					<Button variant="primary" size="sm" loading={busy} disabled={busy} on:click={confirmImport}>
						<Plus size={14} /> Import
					</Button>
					<Button size="sm" disabled={busy} on:click={() => (pendingImport = null)}>Cancel</Button>
				</div>
			{:else}
				<div class="flex flex-wrap gap-2">
					<Button on:click={() => epubInput.click()} disabled={busy}>EPUB</Button>
					<Button on:click={() => txtInput.click()} disabled={busy}>TXT</Button>
				</div>
			{/if}
		</div>

		<!-- EMPTY BOOK: CREATE NOW, CURATE GLOSSARY / ADD CHAPTERS LATER -->
		<form
			class="flex min-w-0 flex-col gap-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.045]"
			on:submit|preventDefault={addEmptyBook}
		>
			<span class="text-xs font-medium opacity-60">Create an empty book</span>
			<TextField bind:value={emptyTitle} label="Title" placeholder="Book title…" />
			<TextField bind:value={emptyAuthor} label="Author" placeholder="Author (optional)" />
			<Button type="submit" loading={busy} disabled={busy || !emptyTitle.trim()} class="w-fit">
				Create empty book
			</Button>
		</form>
	</div>
</Modal>

<!-- DELETE CONFIRMATION -->
<ConfirmDialog
	open={!!pendingDelete}
	title="Delete book?"
	message={pendingDelete
		? `"${pendingDelete.titleTarget || pendingDelete.title}" and its glossary will be permanently removed.`
		: ''}
	confirmLabel="Delete"
	on:confirm={confirmDelete}
	on:cancel={() => (pendingDelete = null)}
/>
