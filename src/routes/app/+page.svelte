<script lang="ts">
	// IMPORTED TYPES
	import type { SourceType } from '$lib/types';
	import type { MenuAction } from '$lib/components/ui/ActionMenu.svelte';
	import type { SessionUser } from '$lib/stores/auth';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { AUTO_SOURCE, isMonolingual } from '$lib/languages';
	import { currentUser } from '$lib/stores/auth';
	import { settings, type Theme } from '$lib/stores/settings';
	import { ripple } from '$lib/actions/ripple';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import Archive from 'lucide-svelte/icons/archive';
	import ArchiveRestore from 'lucide-svelte/icons/archive-restore';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Check from 'lucide-svelte/icons/check';
	import CheckSquare from 'lucide-svelte/icons/check-square';
	import Coffee from 'lucide-svelte/icons/coffee';
	import Contrast from 'lucide-svelte/icons/contrast';
	import Download from 'lucide-svelte/icons/download';
	import Image from 'lucide-svelte/icons/image';
	import Library from 'lucide-svelte/icons/library';
	import Link2 from 'lucide-svelte/icons/link-2';
	import ListOrdered from 'lucide-svelte/icons/list-ordered';
	import Moon from 'lucide-svelte/icons/moon';
	import MoonStar from 'lucide-svelte/icons/moon-star';
	import Pin from 'lucide-svelte/icons/pin';
	import PinOff from 'lucide-svelte/icons/pin-off';
	import Plus from 'lucide-svelte/icons/plus';
	import Search from 'lucide-svelte/icons/search';
	import Sun from 'lucide-svelte/icons/sun';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Upload from 'lucide-svelte/icons/upload';
	import X from 'lucide-svelte/icons/x';
	// IMPORTED COMPONENTS
	import AccountMenu from '$lib/components/AccountMenu.svelte';
	import ActionMenu from '$lib/components/ui/ActionMenu.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import LanguagePicker from '$lib/components/ui/LanguagePicker.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import TextField from '$lib/components/ui/TextField.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Seal from '$lib/components/ui/Seal.svelte';

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
		pinned: boolean;
		archived: boolean;
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
	type StatusFilter = 'all' | 'reading' | 'unread' | 'finished' | 'archived';

	// -- CONSTANTS -- //

	// CURATED DEEP, IN-WORLD COVER GRADIENTS (INK / CINNABAR / JADE / INDIGO / BRONZE / PLUM / SLATE / TEAL).
	// ALL DARK + MUTED — A CREAM SERIF TITLE AND A CINNABAR SEAL READ LIKE A BOUND BOOK ON TOP (NOT RAINBOW SAAS).
	// COMPLETE LITERAL CLASSES (PICKED DETERMINISTICALLY PER TITLE) — KEEPS cn()/TAILWIND HAPPY.
	const COVERS = [
		'from-[#3a2a24] to-[#1b1310]',
		'from-[#7a241b] to-[#3a120d]',
		'from-[#243f33] to-[#0f1d16]',
		'from-[#1f2a44] to-[#0d1320]',
		'from-[#4a3a1e] to-[#211810]',
		'from-[#3d2436] to-[#190f18]',
		'from-[#2a2f36] to-[#111418]',
		'from-[#1e3a3a] to-[#0c1817]',
	];
	const SOURCE_BADGE: Record<string, string> = { web: 'WEB', epub: 'EPUB', txt: 'TXT', manual: 'BOOK' };
	// THEME CYCLE FOR THE TOP-BAR TOGGLE — EACH OF THE 5 THEMES GETS ITS OWN ICON
	const THEME_ICON = { light: Sun, sepia: Coffee, dark: Moon, oled: MoonStar, contrast: Contrast } as const;
	const THEME_CYCLE: Theme[] = ['light', 'sepia', 'dark', 'oled', 'contrast'];

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
		{ value: 'archived', label: 'Archived' },
	];
	const EXPORT_FORMATS: { format: 'txt' | 'md' | 'json'; label: string }[] = [
		{ format: 'txt', label: 'Plain text (.txt)' },
		{ format: 'md', label: 'Markdown (.md)' },
		{ format: 'json', label: 'JSON (.json)' },
	];
	const PREFS_KEY = 'xianslate:library';
	// CACHE OF THE LAST-SEEN LIBRARY (PER USER) SO REVISITS PAINT INSTANTLY INSTEAD OF FLASHING THE SKELETON.
	// SMALL DATA → localStorage (SYNCHRONOUS, SO THERE'S NO SKELETON FRAME ON CLIENT-SIDE NAVIGATION). BUMP THE
	// VERSION IF BookSummary CHANGES SHAPE.
	const BOOKS_CACHE_PREFIX = 'xianslate:books:';
	// BUMPED TO 2 WHEN pinned/archived JOINED BookSummary — DISCARDS OLD-SHAPE CACHED SHELVES AFTER DEPLOY.
	const BOOKS_CACHE_VERSION = 2;
	// PER-CARD KEBAB MENU IS BUILT PER BOOK (SEE bookActions) SO THE COVER ACTION ONLY APPEARS FOR WEB
	// BOOKS WITH A SOURCE PAGE. ALWAYS TAPPABLE (THE OLD HOVER-ONLY DELETE COULDN'T BE TRIGGERED ON TOUCH).

	// -- STATES -- //

	let booksList: BookSummary[] = [];
	let loading = true;
	let urlInput = '';
	// WHICH ADD-A-BOOK ACTION IS RUNNING — DRIVES A PER-BUTTON SPINNER (ONLY THE CLICKED BUTTON SHOWS LOADING),
	// AND DISABLES THE OTHERS WHILE ONE RUNS SO TWO CREATES CAN'T RACE. null = IDLE.
	let busyAction: 'url' | 'import' | 'empty' | null = null;
	let epubInput: HTMLInputElement;
	let txtInput: HTMLInputElement;
	let showAddBook = false;
	let emptyTitle = '';
	let emptyAuthor = '';
	// A CHOSEN-BUT-NOT-YET-IMPORTED FILE. SELECTING AN EPUB/TXT *STAGES* IT HERE INSTEAD OF IMPORTING
	// IMMEDIATELY, SO THE USER CONFIRMS THE TARGET LANGUAGE + AN EXPLICIT "Import" CLICK FIRST (NO AUTO-SUBMIT).
	let pendingImport: { kind: 'epub' | 'txt'; file: File } | null = null;
	let pendingDelete: BookSummary | null = null;
	// EXPORT + SET-COVER DIALOGS (null = CLOSED). coverFileInput IS THE HIDDEN <input type=file> FOR UPLOADS.
	let exportTarget: BookSummary | null = null;
	let coverTarget: BookSummary | null = null;
	let coverUrlInput = '';
	let coverBusy = false;
	let coverFileInput: HTMLInputElement;
	// BULK-SELECT MODE: A CARD TAP TOGGLES SELECTION (INSTEAD OF OPENING); THE BULK BAR ACTS ON `selected`.
	let selecting = false;
	let selected = new Set<string>();
	let bulkBusy = false;
	let pendingBulkDelete = false;
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

	// CURRENT USER — THE CLIENT STORE IS AUTHORITATIVE; $page.data.user IS THE SSR SEED (WEB FIRST PAINT,
	// BEFORE THE STORE HYDRATES). AccountMenu RENDERS THE AVATAR/IDENTITY.
	$: user = ($currentUser ?? $page.data.user ?? null) as SessionUser | null;

	// MOST RECENTLY *READ* BOOK (NOT THE FIRST-CREATED). FALLS BACK TO ANY BOOK WITH A RESUME POINT.
	$: continueBook =
		[...booksList].filter((b) => b.lastChapterUuid).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0] ??
		null;

	// SHELF = SEARCH + SOURCE + STATUS FILTERED, THEN SORTED. THE HERO STAYS GLOBAL (UNFILTERED).
	$: q = search.trim().toLowerCase();
	$: shelf = sortBooks(
		booksList.filter((b) => {
			// ARCHIVED BOOKS ARE HIDDEN EXCEPT IN THE DEDICATED "Archived" VIEW.
			if (statusFilter === 'archived') {
				if (!b.archived) return false;
			} else if (b.archived) return false;
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

	// PERSIST THE SHELF WHENEVER IT CHANGES (ONCE LOADED) — POWERS THE INSTANT, SKELETON-FREE REVISIT. ALSO
	// KEEPS THE CACHE FRESH AFTER DELETE / COVER / TITLE-BACKFILL, SINCE THOSE ALL REASSIGN booksList.
	$: if (browser && !loading) writeBooksCache(booksList);

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
				arr.sort((a, b) => name(a).localeCompare(name(b)));
				break;
			case 'added':
				arr.sort((a, b) => b.createdAt - a.createdAt);
				break;
			case 'chapters':
				arr.sort((a, b) => b.chapterCount - a.chapterCount);
				break;
			case 'progress':
				arr.sort((a, b) => progressFrac(b) - progressFrac(a));
				break;
			case 'recent':
			default:
				// READ BOOKS FIRST (NEWEST READ ON TOP), THEN UNREAD BY MOST-RECENTLY-ADDED
				arr.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.createdAt - a.createdAt);
		}
		// PINNED BOOKS FLOAT TO THE TOP — A STABLE FINAL PASS KEEPS THE CHOSEN ORDER WITHIN EACH GROUP.
		arr.sort((a, b) => Number(b.pinned) - Number(a.pinned));
		return arr;
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
			// IGNORE STORAGE ERRORS (PRIVATE MODE / QUOTA)
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

	// CYCLE THROUGH THE 5 THEMES FROM THE TOP-BAR BUTTON (PERSISTED VIA THE settings STORE)
	function cycleTheme() {
		const i = THEME_CYCLE.indexOf($settings.theme);
		$settings.theme = THEME_CYCLE[(i + 1) % THEME_CYCLE.length];
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

	// CURRENT USER'S LIBRARY-CACHE KEY (null UNTIL WE KNOW WHO IS SIGNED IN — THEN WE NEITHER READ NOR WRITE,
	// SO ONE ACCOUNT NEVER SEES ANOTHER'S CACHED SHELF ON A SHARED DEVICE).
	function booksCacheKey(): string | null {
		const id = get(currentUser)?.id ?? get(page).data?.user?.id ?? null;
		return id ? `${BOOKS_CACHE_PREFIX}${id}` : null;
	}

	function readBooksCache(): BookSummary[] | null {
		if (!browser) return null;
		const key = booksCacheKey();
		if (!key) return null;
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (parsed?.v !== BOOKS_CACHE_VERSION || !Array.isArray(parsed.books)) return null;
			return parsed.books as BookSummary[];
		} catch {
			return null;
		}
	}

	function writeBooksCache(list: BookSummary[]): void {
		if (!browser) return;
		const key = booksCacheKey();
		if (!key) return;
		try {
			localStorage.setItem(key, JSON.stringify({ v: BOOKS_CACHE_VERSION, books: list }));
		} catch {
			// IGNORE STORAGE ERRORS (PRIVATE MODE / QUOTA)
		}
	}

	async function loadBooks() {
		// ONLY SHOW THE SKELETON ON A COLD LOAD; A CACHE-SEEDED SHELF REVALIDATES SILENTLY IN PLACE.
		if (booksList.length === 0) loading = true;
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
		if (!title || busyAction) return;
		busyAction = 'empty';
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
			busyAction = null;
		}
	}

	async function addByUrl() {
		if (!urlInput.trim() || busyAction) return;
		busyAction = 'url';
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
			busyAction = null;
		}
	}

	// COMMIT THE STAGED FILE (THE EXPLICIT "Import" CLICK) — NOTHING IMPORTS UNTIL THE USER CONFIRMS HERE.
	function confirmImport() {
		if (pendingImport && !busyAction) importFile(pendingImport.kind, pendingImport.file);
	}

	async function importFile(kind: 'epub' | 'txt', file: File) {
		busyAction = 'import';
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
			busyAction = null;
		}
	}

	// KEBAB ROUTER FOR A BOOK CARD — OPEN / MANAGE CHAPTERS / DELETE.
	// WEB BOOKS WITH A SOURCE PAGE CAN (RE)FETCH THEIR COVER FROM IT.
	function canFetchCover(b: BookSummary): boolean {
		return !!b.sourceUrl && /^https?:\/\//i.test(b.sourceUrl);
	}

	function bookActions(b: BookSummary): MenuAction[] {
		return [
			{ value: 'open', label: 'Open', icon: BookOpen },
			{ value: 'manage', label: 'Manage chapters', icon: ListOrdered },
			{
				value: b.pinned ? 'unpin' : 'pin',
				label: b.pinned ? 'Unpin' : 'Pin to top',
				icon: b.pinned ? PinOff : Pin,
			},
			{ value: 'setcover', label: 'Set cover…', icon: Image },
			{ value: 'export', label: 'Export…', icon: Download },
			{
				value: b.archived ? 'unarchive' : 'archive',
				label: b.archived ? 'Unarchive' : 'Archive',
				icon: b.archived ? ArchiveRestore : Archive,
			},
			{ value: 'delete', label: 'Delete', icon: Trash2, danger: true },
		];
	}

	function onBookAction(b: BookSummary, action: string) {
		if (action === 'open') openBook(b);
		else if (action === 'manage') goto(`/app/book/${b.id}/manage/`);
		else if (action === 'pin') setPinned(b, true);
		else if (action === 'unpin') setPinned(b, false);
		else if (action === 'archive') setArchived(b, true);
		else if (action === 'unarchive') setArchived(b, false);
		else if (action === 'setcover') openCover(b);
		else if (action === 'export') exportTarget = b;
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

	// PATCH A BOOK'S FIELDS AND UPDATE THE CARD IN PLACE (NO RELOAD). RETURNS true ON SUCCESS.
	async function patchBook(b: BookSummary, body: Record<string, unknown>, okMsg?: string): Promise<boolean> {
		try {
			const res = await apiFetch(`/api/books/${b.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(d.message ?? 'Update failed');
			booksList = booksList.map((x) => (x.id === b.id ? { ...x, ...d.book } : x));
			if (okMsg) toast.success(okMsg);
			return true;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not update the book.');
			return false;
		}
	}

	function setPinned(b: BookSummary, pinned: boolean) {
		patchBook(b, { pinned }, pinned ? 'Pinned to top.' : 'Unpinned.');
	}

	function setArchived(b: BookSummary, archived: boolean) {
		patchBook(b, { archived }, archived ? 'Book archived.' : 'Book restored.');
	}

	// SHORT, SAFE FILENAME STEM FROM A TITLE (MIRRORS THE EXPORT ENDPOINT).
	function slugify(s: string): string {
		return (
			s
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 60) || 'book'
		);
	}

	// DOWNLOAD THE WHOLE BOOK IN THE CHOSEN FORMAT THROUGH /api (SO THE SESSION COOKIE RIDES ALONG — NOT A
	// BARE <a href>); THE BLOB IS THEN SAVED VIA A TRANSIENT OBJECT URL.
	async function exportBook(b: BookSummary, format: 'txt' | 'md' | 'json') {
		const tid = toast.loading('Preparing export…');
		try {
			const res = await apiFetch(`/api/books/${b.id}/export?format=${format}`);
			if (!res.ok) throw new Error('Export failed');
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${slugify(b.titleTarget || b.title)}.${format}`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Export ready.', { id: tid });
			exportTarget = null;
		} catch {
			toast.error('Could not export this book.', { id: tid });
		}
	}

	function openCover(b: BookSummary) {
		coverTarget = b;
		// SEED THE URL FIELD ONLY WITH A REAL http(s) URL — NEVER A HUGE data: URI FROM A PRIOR UPLOAD.
		coverUrlInput = b.coverUrl && !b.coverUrl.startsWith('data:') ? b.coverUrl : '';
	}

	// PERSIST A COVER (http URL OR data: URI), UPDATE THE CARD, AND CLOSE THE DIALOG.
	async function saveCover(coverUrl: string) {
		const b = coverTarget;
		if (!b) return;
		coverBusy = true;
		const ok = await patchBook(b, { coverUrl }, 'Cover updated.');
		coverBusy = false;
		if (ok) coverTarget = null;
	}

	function applyCoverUrl() {
		const url = coverUrlInput.trim();
		if (!url) {
			toast.error('Paste an image URL first.');
			return;
		}
		saveCover(url);
	}

	// CLIENT-SIDE: DOWNSCALE THE PICKED IMAGE TO A THUMBNAIL AND ENCODE IT AS A data: URI — SO CUSTOM COVERS
	// WORK WITH NO OBJECT STORAGE (THE data: URI IS STORED IN books.cover_url). `Image` IS SHADOWED BY THE
	// lucide ICON IMPORT, SO BUILD THE LOADER WITH document.createElement('img').
	function resizeToDataUrl(file: File, max: number, quality: number): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			const img = document.createElement('img');
			reader.onload = () => (img.src = reader.result as string);
			reader.onerror = () => reject(new Error('read failed'));
			img.onload = () => {
				const scale = Math.min(1, max / Math.max(img.width, img.height));
				const w = Math.round(img.width * scale);
				const h = Math.round(img.height * scale);
				const canvas = document.createElement('canvas');
				canvas.width = w;
				canvas.height = h;
				const ctx = canvas.getContext('2d');
				if (!ctx) return reject(new Error('no canvas'));
				ctx.drawImage(img, 0, 0, w, h);
				resolve(canvas.toDataURL('image/jpeg', quality));
			};
			img.onerror = () => reject(new Error('bad image'));
			reader.readAsDataURL(file);
		});
	}

	async function onCoverFile(file: File) {
		coverBusy = true;
		try {
			const dataUrl = await resizeToDataUrl(file, 480, 0.72);
			await saveCover(dataUrl);
		} catch {
			toast.error('Couldn’t read that image. Try a JPG or PNG.');
		} finally {
			coverBusy = false;
		}
	}

	// TOGGLE ONE BOOK IN/OUT OF THE SELECTION (REASSIGN SO SVELTE RE-RENDERS THE Set).
	function toggleSelect(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function exitSelect() {
		selecting = false;
		selected = new Set();
	}

	// APPLY A FIELD-SET TO EVERY SELECTED BOOK (BULK PIN / ARCHIVE / RESTORE) — OPTIMISTIC, ONE PATCH PER BOOK.
	async function bulkPatch(body: Record<string, unknown>, okMsg: string) {
		const ids = [...selected];
		if (!ids.length || bulkBusy) return;
		bulkBusy = true;
		try {
			const results = await Promise.all(
				ids.map((id) =>
					apiFetch(`/api/books/${id}`, {
						method: 'PATCH',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body),
					}),
				),
			);
			if (results.some((r) => !r.ok)) throw new Error();
			booksList = booksList.map((b) => (selected.has(b.id) ? { ...b, ...body } : b));
			toast.success(okMsg);
			exitSelect();
		} catch {
			toast.error('Could not update some books.');
			await loadBooks();
		} finally {
			bulkBusy = false;
		}
	}

	async function confirmBulkDelete() {
		pendingBulkDelete = false;
		const ids = [...selected];
		if (!ids.length || bulkBusy) return;
		bulkBusy = true;
		try {
			const results = await Promise.all(ids.map((id) => apiFetch(`/api/books/${id}`, { method: 'DELETE' })));
			if (results.some((r) => !r.ok)) throw new Error();
			booksList = booksList.filter((b) => !selected.has(b.id));
			toast.success(`Deleted ${ids.length} book${ids.length === 1 ? '' : 's'}.`);
			exitSelect();
		} catch {
			toast.error('Could not delete some books.');
			await loadBooks();
		} finally {
			bulkBusy = false;
		}
	}

	// -- LIFECYCLES -- //

	onMount(async () => {
		loadPrefs();
		// PAINT THE LAST-SEEN LIBRARY INSTANTLY (NO SKELETON), THEN REVALIDATE OVER THE NETWORK IN PLACE.
		const cached = readBooksCache();
		if (cached) {
			booksList = cached;
			loading = false;
		}
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
			<!-- BRAND — WORDMARK HIDDEN BELOW sm (SEAL ONLY) SO THE ACTIONS AREN'T CRAMPED; TRUNCATES ≥ sm -->
			<div class="flex min-w-0 items-center gap-2">
				<span class="flex min-w-0 items-center gap-2 text-xl font-bold tracking-tight"
					><Seal size={28} class="shrink-0" />
					<span class="hidden truncate sm:inline">Xianslate</span></span
				>
				<span class="hidden text-xs opacity-50 sm:inline">· any story, in your language</span>
			</div>
			<!-- NAVIGATION LINKS + PRIMARY "ADD BOOK" CTA + ACCOUNT MENU — shrink-0 SO THE CTA NEVER COMPRESSES; THE BRAND YIELDS FIRST -->
			<div class="flex shrink-0 items-center gap-2">
				<!-- THEME TOGGLE — CYCLES THE 5 READING THEMES; THE ICON REFLECTS THE CURRENT ONE -->
				<button
					use:ripple
					on:click={cycleTheme}
					aria-label="Switch theme"
					title="Switch theme"
					class="hover:bg-current/5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/[0.06] dark:border-white/[0.045]"
				>
					<svelte:component this={THEME_ICON[$settings.theme]} size={16} />
				</button>
				<!-- GLOSSARY NAVIGATION LINK -->
				<a
					use:ripple
					href="/app/glossary/"
					class="hover:bg-current/5 inline-flex items-center gap-1.5 rounded-lg border border-black/[0.06] px-2.5 py-1.5 text-sm dark:border-white/[0.045] sm:px-3"
					aria-label="Glossary"
				>
					<Library size={15} /> <span class="hidden sm:inline">Glossary</span>
				</a>
				<!-- PRIMARY CALL TO ACTION — LABEL ALWAYS VISIBLE; THE BRAND WORDMARK COLLAPSES ON MOBILE TO LEAVE ROOM -->
				<button
					use:ripple
					on:click={() => (showAddBook = true)}
					class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#b23a2e] px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#c0392b]"
				>
					<Plus size={15} /> Add book
				</button>
				<!-- ACCOUNT MENU (AVATAR → ACCOUNT SETTINGS / ADMIN / SIGN OUT) -->
				<AccountMenu {user} />
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
		<!-- HIDDEN COVER PICKER — TRIGGERED FROM THE "Set cover" DIALOG; RESIZED CLIENT-SIDE BEFORE SAVING -->
		<input
			bind:this={coverFileInput}
			type="file"
			accept="image/*"
			class="hidden"
			on:change={(e) => {
				const f = e.currentTarget.files?.[0];
				if (f) onCoverFile(f);
				e.currentTarget.value = '';
			}}
		/>

		<!-- PAGE HEADING — EDITORIAL TITLE, A SENSE OF PLACE -->
		<div class="mb-7 sm:mb-9">
			<h1 class="font-['Literata'] text-[1.75rem] font-bold leading-tight tracking-tight sm:text-4xl">
				Your Library
			</h1>
			{#if !loading}
				<p class="mt-1.5 text-sm opacity-55">
					{#if booksList.length === 0}A quiet shelf, awaiting its first tale.{:else}{booksList.length}
						{booksList.length === 1 ? 'tale' : 'tales'} in your collection{/if}
				</p>
			{/if}
		</div>

		<!-- CONTINUE READING HERO -->
		{#if continueBook}
			<section class="mb-10">
				<h2 class="mb-3 text-xs font-semibold uppercase tracking-widest opacity-50">Continue reading</h2>
				<button
					use:ripple
					on:click={() => openBook(continueBook)}
					class="bg-current/[0.03] group flex w-full items-stretch gap-4 overflow-hidden rounded-2xl border border-black/[0.07] p-4 text-left shadow-sm transition hover:shadow-lg dark:border-white/[0.06] sm:gap-6 sm:p-5"
				>
					<!-- MINI COVER -->
					<div
						class={cn(
							'relative flex h-32 w-[5.5rem] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br p-2 text-center shadow-md sm:h-44 sm:w-28',
							coverClass(continueBook.title),
						)}
					>
						<span class="absolute left-0 top-0 h-full w-1.5 bg-black/25"></span>
						<!-- FETCHED BOOK COVER — OVERLAYS THE GRADIENT FALLBACK; HIDES ITSELF IF IT FAILS TO LOAD -->
						{#if continueBook.coverUrl}
							<img
								src={continueBook.coverUrl}
								alt=""
								class="absolute inset-0 h-full w-full object-cover"
								on:error={hideImg}
							/>
						{:else}
							<!-- BOUND-BOOK FALLBACK — MATCHES THE SHELF CARDS (GOLD FRAME + CREAM SERIF TITLE) -->
							<span class="pointer-events-none absolute inset-[5px] rounded border border-[#c9a24b]/25"
							></span>
							<span
								class="line-clamp-4 font-['Literata'] text-[11px] font-bold leading-tight text-[#f4ecd8] drop-shadow"
								>{continueBook.titleTarget || continueBook.title}</span
							>
						{/if}
					</div>
					<div class="flex min-w-0 flex-1 flex-col justify-center">
						<span class="line-clamp-2 font-['Literata'] text-xl font-bold leading-snug sm:text-2xl"
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
										class="h-full rounded-full bg-[#c0392b]"
										style="width:{progressFrac(continueBook) * 100}%"
									></div>
								</div>
							</div>
						{/if}
						<span
							class="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#b23a2e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors group-hover:bg-[#c0392b]"
							><BookOpen size={15} /> Resume reading</span
						>
					</div>
				</button>
			</section>
		{/if}

		<!-- BOOKSHELF -->
		<section>
			<!-- TOOLBAR — SEARCH + SORT/SOURCE + SELECT (ROW 1), STATUS FILTER CHIPS (ROW 2) -->
			{#if !loading && booksList.length > 0}
				<div class="mb-5 flex flex-col gap-3">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<!-- SEARCH -->
						<div class="relative w-full sm:max-w-xs sm:flex-1">
							<Search
								size={15}
								class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40"
							/>
							<input
								bind:value={search}
								type="search"
								placeholder="Search your library…"
								class="w-full rounded-lg border border-black/10 bg-transparent py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:opacity-40 focus:border-[#c0392b] focus:ring-2 focus:ring-[#c0392b]/30 dark:border-white/[0.08]"
							/>
						</div>
						<!-- SORT + SOURCE + SELECT-MODE — flex-wrap LETS THE ROW DEGRADE GRACEFULLY ON THE NARROWEST
						     SCREENS; min-w-0 ON SORT ALLOWS IT TO SHRINK (TRUNCATE) INSTEAD OF OVERFLOWING. -->
						<div class="flex flex-wrap items-center gap-2 sm:ml-auto">
							<Select
								items={SORT_ITEMS}
								value={sortKey}
								on:change={(e) => setSort(e.detail)}
								class="min-w-0 flex-1 sm:w-40 sm:flex-none"
							/>
							<Select
								items={SOURCE_ITEMS}
								value={sourceFilter}
								on:change={(e) => setSource(e.detail)}
								class="w-28 shrink-0 sm:w-32"
							/>
							<button
								use:ripple
								on:click={() => (selecting ? exitSelect() : (selecting = true))}
								aria-label={selecting ? 'Cancel selection' : 'Select books'}
								class={cn(
									'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm',
									selecting
										? 'border-[#c0392b]/40 bg-[#c0392b]/10 text-[#b23a2e] dark:text-[#e08a63]'
										: 'hover:bg-current/5 border-black/[0.06] dark:border-white/[0.045]',
								)}
							>
								{#if selecting}<X size={15} /> Cancel{:else}<CheckSquare size={15} />
									<span class="hidden sm:inline">Select</span>{/if}
							</button>
						</div>
					</div>
					<!-- STATUS FILTER CHIPS — HORIZONTAL, SCROLLABLE ON MOBILE -->
					<div class="no-scrollbar -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
						{#each STATUS_ITEMS as s (s.value)}
							<button
								use:ripple
								on:click={() => setStatus(s.value)}
								class={cn(
									'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
									statusFilter === s.value
										? 'border-[#b23a2e]/40 bg-[#b23a2e]/10 text-[#b23a2e] dark:text-[#e08a63]'
										: 'hover:bg-current/5 border-black/10 opacity-65 hover:opacity-100 dark:border-white/[0.08]',
								)}>{s.label}</button
							>
						{/each}
						{#if shelf.length !== booksList.length}
							<span class="ml-1 shrink-0 text-xs tabular-nums opacity-45"
								>{shelf.length} of {booksList.length}</span
							>
						{/if}
					</div>
				</div>
			{/if}
			{#if loading}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5">
					{#each [0, 1, 2, 3, 4] as i (i)}<div
							class="aspect-[2/3] animate-pulse rounded-xl bg-black/10 dark:bg-white/10"
						></div>{/each}
				</div>
			{:else if booksList.length === 0}
				<EmptyState
					icon={BookOpen}
					title="Your shelf is empty"
					description="Add a book above to start reading."
				/>
			{:else if shelf.length === 0}
				<EmptyState icon={Search} title="No matches" description="No books match your filters." />
			{:else}
				<!-- BULK ACTION BAR — SHOWN WHILE IN SELECT MODE -->
				{#if selecting}
					<div
						class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-black/[0.08] px-3 py-2 dark:border-white/[0.06]"
					>
						<span class="text-sm opacity-70">{selected.size} selected</span>
						<div class="ml-auto flex flex-wrap items-center gap-2">
							<Button
								size="sm"
								disabled={!selected.size || bulkBusy}
								on:click={() =>
									bulkPatch(
										{ pinned: true },
										`Pinned ${selected.size} book${selected.size === 1 ? '' : 's'}.`,
									)}
							>
								<Pin size={14} /> Pin
							</Button>
							{#if statusFilter === 'archived'}
								<Button
									size="sm"
									disabled={!selected.size || bulkBusy}
									on:click={() =>
										bulkPatch(
											{ archived: false },
											`Restored ${selected.size} book${selected.size === 1 ? '' : 's'}.`,
										)}
								>
									<ArchiveRestore size={14} /> Restore
								</Button>
							{:else}
								<Button
									size="sm"
									disabled={!selected.size || bulkBusy}
									on:click={() =>
										bulkPatch(
											{ archived: true },
											`Archived ${selected.size} book${selected.size === 1 ? '' : 's'}.`,
										)}
								>
									<Archive size={14} /> Archive
								</Button>
							{/if}
							<Button
								variant="danger"
								size="sm"
								loading={bulkBusy}
								disabled={!selected.size || bulkBusy}
								on:click={() => (pendingBulkDelete = true)}
							>
								<Trash2 size={14} /> Delete
							</Button>
						</div>
					</div>
				{/if}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5">
					{#each shelf as b (b.id)}
						{@const frac = progressFrac(b)}
						{@const done = isFinished(b)}
						<!-- BOOK CARD ON THE SHELF -->
						<div class="group flex flex-col gap-2">
							<div
								use:ripple
								role="button"
								tabindex="0"
								on:click={() => (selecting ? toggleSelect(b.id) : openBook(b))}
								on:keydown={(e) =>
									(e.key === 'Enter' || e.key === ' ') &&
									(selecting ? toggleSelect(b.id) : openBook(b))}
								class={cn(
									'relative flex aspect-[2/3] cursor-pointer flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br p-3 shadow-md transition duration-200 group-hover:-translate-y-1 group-hover:shadow-xl',
									coverClass(b.title),
									selecting && selected.has(b.id) && 'ring-2 ring-[#e08a63]',
								)}
							>
								<!-- SELECTION CHECKBOX (BULK MODE) -->
								{#if selecting}
									<div
										class={cn(
											'absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border-2',
											selected.has(b.id)
												? 'border-[#c0392b] bg-[#c0392b] text-white'
												: 'border-white/80 bg-black/30',
										)}
									>
										{#if selected.has(b.id)}<Check size={14} />{/if}
									</div>
								{/if}
								<!-- SPINE -->
								<span class="absolute left-0 top-0 h-full w-2 bg-black/25"></span>
								{#if b.coverUrl}
									<!-- FETCHED COVER — FULL-BLEED OVER THE GRADIENT; HIDES ITSELF IF IT FAILS TO LOAD -->
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
								{:else}
									<!-- DESIGNED FALLBACK COVER — BOUND-BOOK LOOK: GOLD HAIRLINE FRAME, CREAM SERIF TITLE, CINNABAR SEAL -->
									<span
										class="pointer-events-none absolute inset-[7px] rounded-md border border-[#c9a24b]/25"
									></span>
									<div
										class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-3 pb-5 pt-8 text-center"
									>
										<span
											class="line-clamp-5 font-['Literata'] text-[15px] font-bold leading-snug text-[#f4ecd8] drop-shadow"
											>{b.titleTarget || b.title}</span
										>
										<Seal size={22} />
									</div>
								{/if}
								<!-- TOP ROW: SOURCE + DONE BADGES (THE KEBAB LIVES IN THE FOOTER BELOW, OFF THE COVER). -->
								<div class="relative z-10 flex flex-wrap items-center gap-1">
									<span
										class="inline-flex w-fit rounded bg-black/30 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white/90"
										>{SOURCE_BADGE[b.sourceType]}</span
									>
									{#if done}
										<span
											class="inline-flex items-center gap-0.5 rounded bg-[#4f7a64] px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white"
											><Check size={10} /> DONE</span
										>
									{/if}
									{#if b.pinned}
										<!-- PINNED INDICATOR -->
										<span
											class="inline-flex items-center rounded bg-black/30 px-1 py-0.5 text-white"
											><Pin size={10} /></span
										>
									{/if}
									{#if b.archived}
										<span
											class="inline-flex w-fit rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white"
											>ARCHIVED</span
										>
									{/if}
								</div>
								<!-- TITLE OVER REAL COVER ART (PINNED BOTTOM, OVER THE SCRIM). THE FALLBACK SHOWS ITS TITLE
								     CENTRED ABOVE, SO ONLY RENDER THIS WHEN THERE'S ARTWORK. -->
								{#if b.coverUrl}
									<span
										class="relative z-10 ml-1 line-clamp-4 text-sm font-bold leading-tight text-white drop-shadow"
										>{b.titleTarget || b.title}</span
									>
								{/if}
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
									<p class="flex min-w-0 items-center gap-1 overflow-hidden text-xs opacity-60">
										{#if b.author}<span class="min-w-0 truncate">{b.authorTarget || b.author}</span>
											·{/if}
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
			<Button
				type="submit"
				variant="primary"
				loading={busyAction === 'url'}
				disabled={busyAction !== null || !urlInput.trim()}
				class="w-fit"
			>
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
					<Button
						variant="primary"
						size="sm"
						loading={busyAction === 'import'}
						disabled={busyAction !== null}
						on:click={confirmImport}
					>
						<Plus size={14} /> Import
					</Button>
					<Button size="sm" disabled={busyAction !== null} on:click={() => (pendingImport = null)}
						>Cancel</Button
					>
				</div>
			{:else}
				<div class="flex flex-wrap gap-2">
					<Button on:click={() => epubInput.click()} disabled={busyAction !== null}>EPUB</Button>
					<Button on:click={() => txtInput.click()} disabled={busyAction !== null}>TXT</Button>
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
			<Button
				type="submit"
				loading={busyAction === 'empty'}
				disabled={busyAction !== null || !emptyTitle.trim()}
				class="w-fit"
			>
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

<!-- BULK DELETE CONFIRMATION -->
<ConfirmDialog
	open={pendingBulkDelete}
	title="Delete selected books?"
	message={`${selected.size} book${selected.size === 1 ? '' : 's'} and their glossaries will be permanently removed.`}
	confirmLabel="Delete"
	on:confirm={confirmBulkDelete}
	on:cancel={() => (pendingBulkDelete = false)}
/>

<!-- EXPORT A BOOK (TXT / MARKDOWN / JSON) — EVERY CHAPTER, TRANSLATION WHERE AVAILABLE ELSE THE ORIGINAL -->
<Modal open={!!exportTarget} title="Export book" size="sm" on:close={() => (exportTarget = null)}>
	<p class="mb-3 text-sm opacity-60">
		Download “{exportTarget?.titleTarget || exportTarget?.title}” with every chapter included.
	</p>
	<div class="flex flex-col gap-2">
		{#each EXPORT_FORMATS as f (f.format)}
			<Button class="justify-start" on:click={() => exportTarget && exportBook(exportTarget, f.format)}>
				<Download size={15} />
				{f.label}
			</Button>
		{/each}
	</div>
</Modal>

<!-- SET A CUSTOM COVER: PASTE AN IMAGE URL, UPLOAD A FILE (RESIZED ON-DEVICE), OR SCRAPE THE SOURCE PAGE -->
<Modal open={!!coverTarget} title="Set cover" size="sm" on:close={() => (coverTarget = null)}>
	{#if coverTarget}
		<div class="flex flex-col gap-4">
			<!-- CURRENT COVER PREVIEW -->
			{#if coverTarget.coverUrl}
				<img
					src={coverTarget.coverUrl}
					alt=""
					class="mx-auto h-40 w-auto rounded-lg border border-black/10 object-cover dark:border-white/10"
					on:error={hideImg}
				/>
			{/if}
			<!-- BY URL -->
			<form class="flex flex-col gap-2" on:submit|preventDefault={applyCoverUrl}>
				<TextField bind:value={coverUrlInput} type="url" label="Image URL" placeholder="https://…/cover.jpg" />
				<Button
					type="submit"
					variant="primary"
					loading={coverBusy}
					disabled={coverBusy || !coverUrlInput.trim()}
					class="w-fit"
				>
					<Link2 size={14} /> Use this URL
				</Button>
			</form>
			<!-- UPLOAD (CLIENT-RESIZED → data: URI; NO STORAGE SERVER) -->
			<div class="border-t border-black/[0.06] pt-4 dark:border-white/[0.045]">
				<span class="mb-2 block text-xs font-medium opacity-60">Upload an image</span>
				<Button on:click={() => coverFileInput.click()} disabled={coverBusy}
					><Upload size={14} /> Choose image…</Button
				>
				<p class="mt-1.5 text-xs opacity-50">
					Resized to a thumbnail on your device — no upload server needed.
				</p>
			</div>
			<!-- FETCH FROM THE SOURCE PAGE (WEB BOOKS ONLY) -->
			{#if canFetchCover(coverTarget)}
				<div class="border-t border-black/[0.06] pt-4 dark:border-white/[0.045]">
					<Button
						disabled={coverBusy}
						on:click={() => {
							const t = coverTarget;
							coverTarget = null;
							if (t) fetchCover(t);
						}}
					>
						<Image size={14} /> Fetch from source page
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</Modal>
