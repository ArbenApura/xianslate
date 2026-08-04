<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { PageData } from './$types';
	// IMPORTED TYPES
	import type { MenuAction } from '$lib/components/ui/ActionMenu.svelte';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { goto } from '$app/navigation';
	import { isMonolingual, languageName } from '$lib/languages';
	import { chapterLabel, stripChapterPrefix } from '$lib/chapter-label';
	import { settings, THEME_PANEL, TRANSLATION_MODELS } from '$lib/stores/settings';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import BarChart3 from 'lucide-svelte/icons/bar-chart-3';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import Circle from 'lucide-svelte/icons/circle';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';
	import Languages from 'lucide-svelte/icons/languages';
	import ListChecks from 'lucide-svelte/icons/list-checks';
	import ListX from 'lucide-svelte/icons/list-x';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import Minus from 'lucide-svelte/icons/minus';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Plus from 'lucide-svelte/icons/plus';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import Search from 'lucide-svelte/icons/search';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	// IMPORTED COMPONENTS
	import ActionMenu from '$lib/components/ui/ActionMenu.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ChapterStats from '$lib/components/ChapterStats.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import GlossaryPanel from '$lib/components/GlossaryPanel.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';

	// -- REQUIRED PROPS -- //

	export let data: PageData;

	// -- TYPES -- //

	type Item = {
		// NUMERIC CHAPTER id — DRIVES /api/translate (BATCH TRANSLATE). uuid IS THE PUBLIC URL KEY.
		id: number;
		uuid: string;
		seq: number;
		titleSource: string;
		titleTarget: string | null;
		hasTarget: boolean;
		// 0..1 FRACTION ACTUALLY READ — DRIVES THE ✓ (DONE) AND THE IN-PROGRESS BAR
		readProgress: number;
	};
	type AddMode = 'paste' | 'url' | 'file';
	type StatusFilter = 'all' | 'untranslated' | 'translated' | 'unread' | 'read';

	// -- CONSTANTS -- //

	const ADD_MODES: { id: AddMode; label: string }[] = [
		{ id: 'paste', label: 'Paste' },
		{ id: 'url', label: 'From URL' },
		{ id: 'file', label: 'EPUB / TXT' },
	];
	// A CHAPTER IS "READ" ONLY ONCE SCROLLED ~TO THE END (0.9 TOLERATES THE FOOTER BELOW THE PROSE).
	const READ_DONE = 0.9;
	const SOURCE_LABEL: Record<string, string> = { web: 'Web', epub: 'EPUB', txt: 'Text', manual: 'Manual' };
	const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'untranslated', label: 'Untranslated' },
		{ key: 'translated', label: 'Translated' },
		{ key: 'unread', label: 'Unread' },
		{ key: 'read', label: 'Read' },
	];

	// -- STATES -- //

	// MUTABLE SO THE "EDIT DETAILS" DIALOG CAN UPDATE THE HEADER IN PLACE AFTER A SUCCESSFUL PATCH.
	let book = data.book;
	let items: Item[] = data.chapters;
	let addOpen = false;
	let addMode: AddMode = 'paste';
	let pasteTitle = '';
	let pasteContent = '';
	let urlInput = '';
	let busy = false;
	let epubInput: HTMLInputElement;
	let txtInput: HTMLInputElement;

	let glossaryOpen = false;
	// CHAPTER-STATS DIALOG: THE uuid WHOSE STATS TO SHOW (null = CLOSED).
	let statsUuid: string | null = null;
	// LIST TOOLS: FREE-TEXT SEARCH + A STATUS FILTER OVER THE CHAPTER LIST.
	let search = '';
	let statusFilter: StatusFilter = 'all';
	// EDIT-TITLE DIALOG: THE CHAPTER BEING RENAMED (null = CLOSED) + ITS WORKING SOURCE/TARGET TITLES
	let editItem: Item | null = null;
	let editTitle = '';
	let editTitleTarget = '';
	// TRUE WHILE THE EDIT DIALOG'S "Translate" HELPER IS FILLING THE TARGET TITLE FROM THE SOURCE ONE
	let translatingTitle = false;
	// EDIT-BOOK DIALOG: WORKING TITLE/AUTHOR (SOURCE + TRANSLATED) + IN-FLIGHT FLAGS.
	let editBookOpen = false;
	let bTitle = '';
	let bTitleTarget = '';
	let bAuthor = '';
	let bAuthorTarget = '';
	let savingBook = false;
	let translatingBookTitle = false;
	let translatingBookAuthor = false;
	let pendingDelete: Item | null = null;
	let dragIndex: number | null = null;
	let dragOverIndex: number | null = null;
	// BATCH-SELECT MODE: TOGGLED FROM THE HEADER; `selected` HOLDS THE CHECKED CHAPTER uuids.
	let selecting = false;
	let selected: Set<string> = new Set();
	// TRUE WHILE A BATCH DELETE / READ REQUEST IS IN FLIGHT — DISABLES THE TOOLBAR BUTTONS.
	let batchBusy = false;
	let pendingBatchDelete = false;
	// BATCH TRANSLATE: SEQUENTIAL RUN STATE + LIVE PROGRESS. translateAbort CANCELS THE REMAINING QUEUE.
	let batchTranslating = false;
	let translateDone = 0;
	let translateTotal = 0;
	let translateCurrent = '';
	let translateAbort: AbortController | null = null;
	// PENDING TRANSLATE CONFIRMATION: THE CHAPTERS TO RUN + WHETHER IT'S A FORCED RE-TRANSLATE.
	let pendingTranslate: { targets: Item[]; force: boolean } | null = null;

	// -- REACTIVE STATES -- //

	// AN EMPTY BOOK HAS NOTHING TO RESUME, SO "BACK TO READING" (→ /app/book/[id]/) JUST 307-LOOPS BACK
	// HERE AND LOOKS STUCK. WHEN THERE ARE NO CHAPTERS, SEND "BACK" TO THE LIBRARY INSTEAD.
	$: hasChapters = items.length > 0;
	$: total = items.length;
	$: backHref = hasChapters ? `/app/book/${book.id}/` : '/app';
	$: backLabel = hasChapters ? 'Back to reading' : 'Back to library';
	// READ-IN-ORIGINAL BOOK (NO TRANSLATION DIRECTION) — HIDES EVERYTHING TRANSLATION-RELATED.
	$: mono = isMonolingual(book.targetLang);
	// THE LIBRARY-STYLE DISPLAY TITLE: PREFER THE TRANSLATED TITLE, FALL BACK TO THE SOURCE.
	$: displayTitle = book.titleTarget || book.title;
	// PROGRESS ROLLUPS — DERIVED FROM DATA ALREADY ON THE CLIENT (hasTarget / readProgress).
	$: translatedCount = items.filter((i) => i.hasTarget).length;
	$: readCount = items.filter((i) => i.readProgress >= READ_DONE).length;
	$: translatedPct = total ? Math.round((translatedCount / total) * 100) : 0;
	$: readPct = total ? Math.round((readCount / total) * 100) : 0;
	// SEARCH/FILTER → THE VISIBLE SUBSET. REORDERING IS SUPPRESSED WHILE FILTERING (THE RENDERED INDEX NO
	// LONGER MAPS 1:1 ONTO `items`), SO THE DRAG/MOVE CONTROLS HIDE WHEN `filtering` IS TRUE.
	$: q = search.trim().toLowerCase();
	$: filtering = q !== '' || statusFilter !== 'all';
	$: visibleItems = items.filter(
		(it) => matchesStatus(it) && (!q || `${it.titleSource} ${it.titleTarget ?? ''}`.toLowerCase().includes(q)),
	);
	// SELECT-ALL OPERATES ON THE CURRENTLY VISIBLE SET (SELECTION OUTSIDE THE FILTER IS PRESERVED).
	$: allSelected = visibleItems.length > 0 && visibleItems.every((i) => selected.has(i.uuid));
	$: someSelected = selected.size > 0 && !allSelected;
	// BATCH-TRANSLATE TARGETS: EVERY UNTRANSLATED CHAPTER, AND THE UNTRANSLATED SUBSET OF THE SELECTION.
	$: untranslated = items.filter((i) => !i.hasTarget);
	$: selectedUntranslated = items.filter((i) => selected.has(i.uuid) && !i.hasTarget);
	// FRIENDLY MODEL NAME FOR THE CONFIRM COPY (Flash / Pro).
	$: modelLabel = TRANSLATION_MODELS.find((m) => m.id === $settings.model)?.label ?? 'the selected model';

	// -- FUNCTIONS -- //

	function matchesStatus(it: Item): boolean {
		switch (statusFilter) {
			case 'untranslated':
				return !it.hasTarget;
			case 'translated':
				return it.hasTarget;
			case 'unread':
				return it.readProgress < READ_DONE;
			case 'read':
				return it.readProgress >= READ_DONE;
			default:
				return true;
		}
	}

	async function refresh() {
		try {
			const res = await apiFetch(`/api/books/${book.id}`);
			const d = await res.json();
			items = d.chapters ?? [];
		} catch {
			toast.error('Could not refresh chapters.');
		}
	}

	async function addManual() {
		if (!pasteTitle.trim() || !pasteContent.trim() || busy) return;
		busy = true;
		try {
			const res = await apiFetch(`/api/books/${book.id}/chapters`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					kind: 'manual',
					titleSource: pasteTitle.trim(),
					contentSource: pasteContent.trim(),
				}),
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Failed to add chapter');
			pasteTitle = '';
			pasteContent = '';
			addOpen = false;
			toast.success('Chapter added.');
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to add chapter.');
		} finally {
			busy = false;
		}
	}

	async function addFromUrl() {
		if (!urlInput.trim() || busy) return;
		busy = true;
		const tid = toast.loading('Fetching chapter…');
		try {
			const res = await apiFetch(`/api/books/${book.id}/chapters`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'url', url: urlInput.trim() }),
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Fetch failed');
			urlInput = '';
			addOpen = false;
			toast.success('Chapter fetched.', { id: tid });
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not fetch that URL.', { id: tid });
		} finally {
			busy = false;
		}
	}

	async function importFile(kind: 'epub' | 'txt', file: File) {
		busy = true;
		const tid = toast.loading(`Importing ${file.name}…`);
		try {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('bookId', book.id);
			const res = await apiFetch(`/api/import/${kind}`, { method: 'POST', body: fd });
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Import failed');
			const d = await res.json();
			addOpen = false;
			toast.success(`Added ${d.chapters} chapter${d.chapters === 1 ? '' : 's'}.`, { id: tid });
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Import failed.', { id: tid });
		} finally {
			busy = false;
		}
	}

	// PER-ROW KEBAB ITEMS — THE READ/UNREAD ITEM FLIPS BASED ON WHETHER THE CHAPTER IS ALREADY FINISHED.
	function rowActions(it: Item): MenuAction[] {
		const done = it.readProgress >= READ_DONE;
		return [
			{ value: 'open', label: 'Open in reader', icon: BookOpen },
			// TRANSLATE / RE-TRANSLATE — HIDDEN FOR READ-IN-ORIGINAL BOOKS (NO TRANSLATION DIRECTION).
			...(mono
				? []
				: [
						it.hasTarget
							? { value: 'retranslate', label: 'Re-translate', icon: RefreshCw }
							: { value: 'translate', label: 'Translate', icon: Languages },
					]),
			{ value: 'stats', label: 'View stats', icon: BarChart3 },
			{ value: 'edit', label: 'Edit title', icon: Pencil },
			done
				? { value: 'unread', label: 'Mark unread', icon: Circle }
				: { value: 'read', label: 'Mark read', icon: Check },
			{ value: 'prev-read', label: 'Mark previous read', icon: ListChecks },
			{ value: 'prev-unread', label: 'Mark previous unread', icon: ListX },
			{ value: 'delete', label: 'Delete', icon: Trash2, danger: true },
		];
	}

	// KEBAB MENU ROUTER — MAPS A CHOSEN ACTION TO ITS HANDLER FOR THIS ROW
	function onAction(it: Item, action: string) {
		if (action === 'open') goto(`/app/book/${book.id}/${it.uuid}/`);
		else if (action === 'translate') askTranslate([it], false);
		else if (action === 'retranslate') askTranslate([it], true);
		else if (action === 'stats') statsUuid = it.uuid;
		else if (action === 'edit') startEdit(it);
		else if (action === 'delete') pendingDelete = it;
		else if (action === 'read') setReadStatus(it, 'this', true);
		else if (action === 'unread') setReadStatus(it, 'this', false);
		else if (action === 'prev-read') setReadStatus(it, 'previous', true);
		else if (action === 'prev-unread') setReadStatus(it, 'previous', false);
	}

	// APPLY A READ/UNREAD CHANGE OPTIMISTICALLY (INSTANT ✓ / BAR UPDATE), THEN PERSIST IT SERVER-SIDE.
	async function setReadStatus(it: Item, scope: 'this' | 'previous' | 'all', read: boolean) {
		const value = read ? 1 : 0;
		items = items.map((x) => {
			const hit =
				scope === 'all' || (scope === 'this' && x.uuid === it.uuid) || (scope === 'previous' && x.seq < it.seq);
			return hit ? { ...x, readProgress: value } : x;
		});
		try {
			const res = await apiFetch(`/api/books/${book.id}/read`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uuid: it.uuid, scope, read }),
			});
			if (!res.ok) throw new Error();
		} catch {
			toast.error('Could not update read status.');
			await refresh();
		}
	}

	function startEdit(it: Item) {
		editItem = it;
		editTitle = it.titleSource;
		editTitleTarget = it.titleTarget ?? '';
	}

	// AI-FILL THE TARGET-LANGUAGE TITLE FROM THE SOURCE TITLE — GLOSSARY-AWARE FOR THIS BOOK
	async function translateEditTitle() {
		const source = editTitle.trim();
		if (!source || translatingTitle) return;
		translatingTitle = true;
		try {
			const res = await apiFetch('/api/translate-text', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: source, kind: 'title', bookId: book.id }),
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.message ?? 'Translation failed');
			editTitleTarget = d.text;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not translate the title.');
		} finally {
			translatingTitle = false;
		}
	}

	function cancelEdit() {
		editItem = null;
		editTitle = '';
		editTitleTarget = '';
	}

	async function saveEdit() {
		const it = editItem;
		if (!it) return;
		const titleSource = editTitle.trim();
		const titleTarget = editTitleTarget.trim();
		if (!titleSource) {
			toast.error('The source title cannot be empty.');
			return;
		}
		// NOTHING CHANGED — JUST CLOSE
		if (titleSource === it.titleSource && titleTarget === (it.titleTarget ?? '')) return cancelEdit();
		try {
			const res = await apiFetch(`/api/chapters/${it.uuid}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ titleSource, titleTarget: titleTarget || null }),
			});
			if (!res.ok) throw new Error();
			items = items.map((x) =>
				x.uuid === it.uuid ? { ...x, titleSource, titleTarget: titleTarget || null } : x,
			);
			cancelEdit();
		} catch {
			toast.error('Could not save the chapter title.');
		}
	}

	// OPEN THE EDIT-BOOK DIALOG SEEDED WITH THE CURRENT TITLE/AUTHOR.
	function openBookEdit() {
		bTitle = book.title;
		bTitleTarget = book.titleTarget ?? '';
		bAuthor = book.author ?? '';
		bAuthorTarget = book.authorTarget ?? '';
		editBookOpen = true;
	}

	// AI-FILL A TARGET FIELD (TITLE OR AUTHOR) FROM ITS SOURCE VALUE — GLOSSARY-AWARE FOR THIS BOOK.
	async function translateBookField(field: 'title' | 'author') {
		const source = (field === 'title' ? bTitle : bAuthor).trim();
		if (!source) return;
		if (field === 'title') translatingBookTitle = true;
		else translatingBookAuthor = true;
		try {
			const res = await apiFetch('/api/translate-text', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: source, kind: field === 'title' ? 'title' : 'term', bookId: book.id }),
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.message ?? 'Translation failed');
			if (field === 'title') bTitleTarget = d.text;
			else bAuthorTarget = d.text;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not translate that.');
		} finally {
			if (field === 'title') translatingBookTitle = false;
			else translatingBookAuthor = false;
		}
	}

	async function saveBook() {
		const title = bTitle.trim();
		if (!title) {
			toast.error('The book title cannot be empty.');
			return;
		}
		savingBook = true;
		try {
			const res = await apiFetch(`/api/books/${book.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title,
					titleTarget: bTitleTarget.trim() || null,
					author: bAuthor.trim() || null,
					authorTarget: bAuthorTarget.trim() || null,
				}),
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(d.message ?? 'Could not save.');
			book = {
				...book,
				title: d.book.title,
				titleTarget: d.book.titleTarget,
				author: d.book.author,
				authorTarget: d.book.authorTarget,
			};
			editBookOpen = false;
			toast.success('Book details updated.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not save the book details.');
		} finally {
			savingBook = false;
		}
	}

	async function confirmDelete() {
		const it = pendingDelete;
		pendingDelete = null;
		if (!it) return;
		try {
			const res = await apiFetch(`/api/chapters/${it.uuid}`, { method: 'DELETE' });
			if (!res.ok) throw new Error();
			items = items.filter((x) => x.uuid !== it.uuid).map((x, i) => ({ ...x, seq: i }));
			toast.success('Chapter deleted.');
		} catch {
			toast.error('Could not delete chapter.');
		}
	}

	async function commitOrder(next: Item[]) {
		const prev = items;
		items = next.map((it, i) => ({ ...it, seq: i }));
		try {
			const res = await apiFetch(`/api/books/${book.id}/chapters`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ order: next.map((i) => i.uuid) }),
			});
			if (!res.ok) throw new Error();
		} catch {
			items = prev;
			toast.error('Could not save the new order.');
		}
	}

	function move(index: number, dir: -1 | 1) {
		const j = index + dir;
		if (j < 0 || j >= items.length) return;
		const next = items.slice();
		[next[index], next[j]] = [next[j], next[index]];
		commitOrder(next);
	}

	function onDrop(target: number) {
		const from = dragIndex;
		dragIndex = null;
		dragOverIndex = null;
		if (from === null || from === target) return;
		const next = items.slice();
		const [moved] = next.splice(from, 1);
		next.splice(target, 0, moved);
		commitOrder(next);
	}

	// LEAVE BATCH-SELECT MODE AND DROP THE SELECTION.
	function exitSelect() {
		selecting = false;
		selected = new Set();
	}

	// TOGGLE ONE CHAPTER IN/OUT OF THE SELECTION (REASSIGN SO SVELTE RE-RENDERS THE Set).
	function toggleSelect(uuid: string) {
		const next = new Set(selected);
		if (next.has(uuid)) next.delete(uuid);
		else next.add(uuid);
		selected = next;
	}

	// HEADER CHECKBOX: SELECT EVERY VISIBLE CHAPTER, OR CLEAR THEM IF ALL VISIBLE ARE ALREADY SELECTED.
	function toggleSelectAll() {
		const vis = visibleItems.map((i) => i.uuid);
		if (allSelected) selected = new Set([...selected].filter((u) => !vis.includes(u)));
		else selected = new Set([...selected, ...vis]);
	}

	// MARK EVERY SELECTED CHAPTER READ/UNREAD — OPTIMISTIC, THEN ONE 'this'-SCOPED CALL PER uuid.
	async function batchSetRead(read: boolean) {
		const targets = selected;
		const uuids = [...targets];
		if (!uuids.length || batchBusy) return;
		const value = read ? 1 : 0;
		items = items.map((x) => (targets.has(x.uuid) ? { ...x, readProgress: value } : x));
		batchBusy = true;
		try {
			const results = await Promise.all(
				uuids.map((uuid) =>
					apiFetch(`/api/books/${book.id}/read`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ uuid, scope: 'this', read }),
					}),
				),
			);
			if (results.some((r) => !r.ok)) throw new Error();
			toast.success(
				`Marked ${uuids.length} chapter${uuids.length === 1 ? '' : 's'} ${read ? 'read' : 'unread'}.`,
			);
		} catch {
			toast.error('Could not update some chapters.');
			await refresh();
		} finally {
			batchBusy = false;
		}
	}

	// DELETE EVERY SELECTED CHAPTER, RESEQUENCE THE SURVIVORS, THEN LEAVE SELECT MODE.
	async function confirmBatchDelete() {
		pendingBatchDelete = false;
		const targets = selected;
		const uuids = [...targets];
		if (!uuids.length || batchBusy) return;
		batchBusy = true;
		try {
			const results = await Promise.all(
				uuids.map((uuid) => apiFetch(`/api/chapters/${uuid}`, { method: 'DELETE' })),
			);
			if (results.some((r) => !r.ok)) throw new Error();
			items = items.filter((x) => !targets.has(x.uuid)).map((x, i) => ({ ...x, seq: i }));
			toast.success(`Deleted ${uuids.length} chapter${uuids.length === 1 ? '' : 's'}.`);
		} catch {
			toast.error('Could not delete some chapters.');
			await refresh();
		} finally {
			batchBusy = false;
			exitSelect();
		}
	}

	// DRAIN ONE TRANSLATION SSE STREAM TO COMPLETION. THE SERVER JOB PERSISTS contentTarget ON `done` EVEN IF
	// WE STOP READING, BUT WE WAIT FOR CLOSE SO THE BATCH STAYS SEQUENTIAL (TRANSLATION IS IN-PROCESS, SINGLE
	// INSTANCE). A NON-OK RESPONSE IS THROWN AS AN Error SO THE RUNNER CAN COUNT IT AS FAILED.
	async function translateOne(id: number, force: boolean, signal: AbortSignal): Promise<void> {
		const res = await apiFetch('/api/translate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ chapterId: id, force, autoExtract: $settings.autoExtract, model: $settings.model }),
			signal,
		});
		if (!res.ok || !res.body) throw new Error('Translation request failed.');
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const blocks = buf.split('\n\n');
			buf = blocks.pop() ?? '';
			for (const block of blocks) {
				// SKIP SSE COMMENT HEARTBEATS (": ping"); ONLY "data:" LINES ARE JSON EVENTS.
				const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
				if (!dataLine) continue;
				const line = dataLine.slice(5).trim();
				if (!line) continue;
				let msg: { type?: string; message?: string };
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				if (msg.type === 'error') throw new Error(msg.message ?? 'Translation failed.');
			}
		}
	}

	// SEQUENTIAL BATCH TRANSLATE. STOPS THE WHOLE RUN ON CANCEL; OTHER PER-CHAPTER FAILURES ARE COUNTED AND
	// SKIPPED. hasTarget IS UPDATED OPTIMISTICALLY, THEN RECONCILED VIA refresh().
	async function runTranslate(targets: Item[], force: boolean) {
		if (batchTranslating || !targets.length) return;
		batchTranslating = true;
		translateAbort = new AbortController();
		translateTotal = targets.length;
		translateDone = 0;
		let ok = 0;
		let failed = 0;
		for (const t of targets) {
			if (translateAbort.signal.aborted) break;
			translateCurrent = stripChapterPrefix(t.titleTarget || t.titleSource) || t.titleTarget || t.titleSource;
			try {
				await translateOne(t.id, force, translateAbort.signal);
				ok++;
				items = items.map((x) => (x.uuid === t.uuid ? { ...x, hasTarget: true } : x));
			} catch (e) {
				if (e instanceof DOMException && e.name === 'AbortError') break;
				failed++;
			}
			translateDone++;
		}
		batchTranslating = false;
		translateAbort = null;
		translateCurrent = '';
		await refresh();
		if (failed === 0) toast.success(`Translated ${ok} chapter${ok === 1 ? '' : 's'}.`);
		else toast.error(`Translated ${ok} chapter${ok === 1 ? '' : 's'}, ${failed} failed.`);
	}

	function cancelTranslate() {
		translateAbort?.abort();
	}

	// OPEN THE CONFIRM DIALOG FOR A (BILLED) RUN — NARROWS TO THE CHAPTERS THAT ACTUALLY NEED WORK.
	function askTranslate(targets: Item[], force: boolean) {
		const list = targets.filter((t) => force || !t.hasTarget);
		if (!list.length) {
			toast('Those chapters are already translated.');
			return;
		}
		pendingTranslate = { targets: list, force };
	}

	function confirmTranslate() {
		const req = pendingTranslate;
		pendingTranslate = null;
		if (!req) return;
		// LEAVE SELECT MODE SO THE PROGRESS BANNER ISN'T BURIED UNDER THE BULK TOOLBAR.
		if (selecting) exitSelect();
		runTranslate(req.targets, req.force);
	}
</script>

<svelte:head><title>{displayTitle} — Manage chapters</title></svelte:head>

<!-- PAGE WRAPPER -->
<div class="mx-auto min-h-full w-full max-w-4xl px-4 py-8 sm:px-6">
	<!-- TOP BAR: BACK LINK + PRIMARY ACTIONS -->
	<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
		<!-- BACK LINK: THE READER WHEN THERE ARE CHAPTERS, ELSE THE LIBRARY (AN EMPTY BOOK HAS NOTHING TO RESUME) -->
		<a use:ripple href={backHref} class="inline-flex items-center gap-1.5 text-sm opacity-70 hover:opacity-100">
			<ArrowLeft size={15} />
			{backLabel}
		</a>
		<div class="flex items-center gap-2">
			<!-- OPENS THE ADD-CHAPTER DIALOG -->
			<Button variant="primary" size="sm" on:click={() => (addOpen = true)}><Plus size={14} /> Add chapter</Button
			>
			{#if items.length}
				<Button href="/app/book/{book.id}/" size="sm"><BookOpen size={14} /> Read</Button>
				<!-- ENTER BATCH-SELECT MODE (CHECKBOXES + BULK TOOLBAR) -->
				{#if !selecting}
					<Button size="sm" on:click={() => (selecting = true)}><ListChecks size={14} /> Select</Button>
				{/if}
			{/if}
			<Button on:click={() => (glossaryOpen = true)} size="sm"><Languages size={14} /> Glossary</Button>
		</div>
	</div>

	<!-- BOOK DETAIL HEADER: COVER · TITLE/AUTHOR · SOURCE + LANGUAGE CHIPS · EDIT -->
	<div class="mb-5 flex gap-4">
		<!-- COVER (OR GRADIENT PLACEHOLDER) -->
		<div class="h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
			{#if book.coverUrl}
				<img src={book.coverUrl} alt="" class="h-full w-full object-cover" />
			{:else}
				<div
					class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#c0392b]/20 to-violet-500/20 text-black/30 dark:text-white/30"
				>
					<BookOpen size={20} />
				</div>
			{/if}
		</div>
		<!-- META -->
		<div class="min-w-0 flex-1">
			<div class="flex items-start gap-1.5">
				<h1 class="min-w-0 break-words text-2xl font-bold leading-tight">{displayTitle}</h1>
				<button
					use:ripple
					on:click={openBookEdit}
					aria-label="Edit book details"
					class="shrink-0 rounded-lg p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
				>
					<Pencil size={15} />
				</button>
			</div>
			{#if book.author}<p class="mt-0.5 truncate text-sm opacity-60">{book.authorTarget || book.author}</p>{/if}
			<!-- CHIPS -->
			<div class="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-70">
				<Badge variant="neutral">{SOURCE_LABEL[book.sourceType] ?? book.sourceType}</Badge>
				<span
					>{languageName(book.sourceLang)}{#if !mono}
						→ {languageName(book.targetLang)}{/if}</span
				>
				{#if book.sourceUrl}
					<a
						use:ripple
						href={book.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 hover:text-[#b23a2e] hover:opacity-100"
					>
						<ExternalLink size={12} /> Source
					</a>
				{/if}
				<span>· {total} chapter{total === 1 ? '' : 's'}</span>
			</div>
		</div>
	</div>

	<!-- PROGRESS ROLLUP: TRANSLATION + READING -->
	{#if hasChapters}
		<div
			class={cn(
				'mb-5 grid gap-3 rounded-xl border border-black/[0.06] p-4 dark:border-white/[0.06]',
				mono ? 'grid-cols-1' : 'sm:grid-cols-2',
			)}
		>
			{#if !mono}
				<!-- TRANSLATION PROGRESS -->
				<div>
					<div class="mb-1.5 flex items-center justify-between text-xs">
						<span class="flex items-center gap-1.5 font-medium"><Languages size={13} /> Translated</span>
						<span class="tabular-nums opacity-60">{translatedCount}/{total} · {translatedPct}%</span>
					</div>
					<div class="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
						<!-- WIDTH IS RUNTIME-DYNAMIC (TRANSLATED SHARE) — NOT EXPRESSIBLE AS A TAILWIND CLASS -->
						<div class="h-full rounded-full bg-emerald-500" style="width: {translatedPct}%"></div>
					</div>
					<!-- ONE-TAP BATCH TRANSLATE OF EVERYTHING STILL UNTRANSLATED -->
					{#if untranslated.length && !batchTranslating}
						<button
							use:ripple
							on:click={() => askTranslate(untranslated, false)}
							class="mt-2 inline-flex items-center gap-1 text-xs text-[#b23a2e] hover:underline dark:text-[#e08a63]"
						>
							<Languages size={12} /> Translate {untranslated.length} untranslated
						</button>
					{/if}
				</div>
			{/if}
			<!-- READING PROGRESS -->
			<div>
				<div class="mb-1.5 flex items-center justify-between text-xs">
					<span class="flex items-center gap-1.5 font-medium"><BookOpen size={13} /> Read</span>
					<span class="tabular-nums opacity-60">{readCount}/{total} · {readPct}%</span>
				</div>
				<div class="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
					<!-- WIDTH IS RUNTIME-DYNAMIC (READ SHARE) — NOT EXPRESSIBLE AS A TAILWIND CLASS -->
					<div class="h-full rounded-full bg-[#c0392b]" style="width: {readPct}%"></div>
				</div>
			</div>
		</div>
	{/if}

	<!-- ADD-CHAPTER DIALOG: TABBED PASTE / URL / FILE IMPORT -->
	<Modal open={addOpen} title="Add chapter" size="lg" on:close={() => (addOpen = false)}>
		<!-- ADD MODE TABS -->
		<div
			class="mb-3 inline-flex overflow-hidden rounded-lg border border-black/[0.12] text-xs dark:border-white/[0.08]"
		>
			{#each ADD_MODES as m (m.id)}
				<button
					use:ripple
					on:click={() => (addMode = m.id)}
					class={cn(
						'px-3 py-1.5 transition-colors',
						addMode === m.id ? 'bg-[#b23a2e] text-white' : 'opacity-70 hover:opacity-100',
					)}>{m.label}</button
				>
			{/each}
		</div>

		<!-- PASTE MODE FORM -->
		{#if addMode === 'paste'}
			<form class="flex flex-col gap-2" on:submit|preventDefault={addManual}>
				<input
					bind:value={pasteTitle}
					placeholder="Chapter title…"
					class="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
				/>
				<textarea
					bind:value={pasteContent}
					rows="6"
					placeholder="Paste the chapter text here…"
					class="resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
				></textarea>
				<div>
					<Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy}>
						<Plus size={14} /> Add chapter
					</Button>
				</div>
			</form>
			<!-- URL MODE FORM -->
		{:else if addMode === 'url'}
			<form class="flex flex-col gap-2 sm:flex-row" on:submit|preventDefault={addFromUrl}>
				<input
					bind:value={urlInput}
					type="url"
					placeholder="Paste a chapter URL…"
					class="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
				/>
				<Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy}>Fetch into book</Button
				>
			</form>
			<p class="mt-2 text-xs opacity-50">Pulls just this page's content into this book as the next chapter.</p>
			<!-- FILE IMPORT MODE -->
		{:else}
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<Button size="sm" disabled={busy} on:click={() => epubInput.click()}>Import EPUB</Button>
				<Button size="sm" disabled={busy} on:click={() => txtInput.click()}>Import TXT</Button>
				<span class="text-xs opacity-50">Its chapters are appended to this book.</span>
			</div>
		{/if}

		<!-- HIDDEN FILE INPUTS FOR EPUB AND TXT IMPORT -->
		<input
			bind:this={epubInput}
			type="file"
			accept=".epub"
			class="hidden"
			on:change={(e) => {
				const f = e.currentTarget.files?.[0];
				if (f) importFile('epub', f);
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
				if (f) importFile('txt', f);
				e.currentTarget.value = '';
			}}
		/>
	</Modal>

	<!-- BATCH SELECT TOOLBAR — SHOWN WHILE IN SELECT MODE -->
	{#if selecting}
		<div
			class="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-black/[0.08] px-3 py-2 dark:border-white/[0.06]"
		>
			<!-- SELECT-ALL / INDETERMINATE CHECKBOX -->
			<button
				use:ripple
				type="button"
				on:click={toggleSelectAll}
				aria-label="Select all chapters"
				class={cn(
					'flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
					selected.size ? 'border-[#b23a2e] bg-[#b23a2e] text-white' : 'border-black/25 dark:border-white/25',
				)}
			>
				{#if allSelected}<Check size={13} />{:else if someSelected}<Minus size={13} />{/if}
			</button>
			<span class="text-sm opacity-70">{selected.size} selected</span>
			<!-- BULK ACTIONS -->
			<div class="ml-auto flex flex-wrap items-center gap-2">
				<!-- TRANSLATE THE UNTRANSLATED CHAPTERS AMONG THE SELECTION (HIDDEN FOR READ-IN-ORIGINAL BOOKS) -->
				{#if !mono}
					<Button
						size="sm"
						disabled={!selectedUntranslated.length || batchBusy || batchTranslating}
						on:click={() => askTranslate(selectedUntranslated, false)}
					>
						<Languages size={14} /> Translate{selectedUntranslated.length
							? ` (${selectedUntranslated.length})`
							: ''}
					</Button>
				{/if}
				<Button size="sm" disabled={!selected.size || batchBusy} on:click={() => batchSetRead(true)}>
					<Check size={14} /> Mark read
				</Button>
				<Button size="sm" disabled={!selected.size || batchBusy} on:click={() => batchSetRead(false)}>
					<Circle size={14} /> Mark unread
				</Button>
				<Button
					variant="danger"
					size="sm"
					loading={batchBusy}
					disabled={!selected.size || batchBusy}
					on:click={() => (pendingBatchDelete = true)}
				>
					<Trash2 size={14} /> Delete
				</Button>
				<Button variant="ghost" size="sm" on:click={exitSelect}>Done</Button>
			</div>
		</div>
	{/if}

	<!-- SEARCH + STATUS FILTER TOOLBAR -->
	{#if hasChapters}
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<!-- SEARCH -->
			<div class="relative w-full sm:max-w-xs">
				<Search size={15} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
				<input
					bind:value={search}
					type="search"
					placeholder="Search chapters…"
					class="w-full rounded-lg border border-black/10 bg-transparent py-2 pl-8 pr-2.5 text-sm outline-none placeholder:opacity-40 focus:border-[#c0392b] dark:border-white/[0.08]"
				/>
			</div>
			<!-- STATUS FILTER CHIPS (TRANSLATION FILTERS HIDDEN FOR READ-IN-ORIGINAL BOOKS) -->
			<div class="flex flex-wrap gap-1.5">
				{#each STATUS_FILTERS as f (f.key)}
					{#if !(mono && (f.key === 'translated' || f.key === 'untranslated'))}
						<button
							use:ripple
							on:click={() => (statusFilter = f.key)}
							class={cn(
								'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
								statusFilter === f.key
									? 'border-[#c0392b]/40 bg-[#c0392b]/10 font-medium text-[#b23a2e] dark:text-[#e08a63]'
									: 'border-black/10 opacity-70 hover:opacity-100 dark:border-white/10',
							)}>{f.label}</button
						>
					{/if}
				{/each}
			</div>
		</div>
		<!-- REORDER IS INDEX-BASED ON THE FULL LIST, SO IT'S PAUSED WHILE A SEARCH/FILTER NARROWS THE VIEW -->
		{#if filtering}
			<p class="mb-2 text-xs opacity-50">Clear the search and filter to reorder chapters.</p>
		{/if}
	{/if}

	<!-- BATCH-TRANSLATE PROGRESS BANNER -->
	{#if batchTranslating}
		<div
			class="mb-3 flex items-center gap-3 rounded-xl border border-[#c0392b]/30 bg-[#c0392b]/[0.06] px-3 py-2.5 text-sm"
		>
			<Loader2 size={16} class="shrink-0 animate-spin text-[#b23a2e] dark:text-[#e08a63]" />
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between gap-2 text-xs">
					<span class="min-w-0 truncate">Translating: {translateCurrent}</span>
					<span class="shrink-0 tabular-nums opacity-70">{translateDone}/{translateTotal}</span>
				</div>
				<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
					<!-- WIDTH IS RUNTIME-DYNAMIC (BATCH PROGRESS) — NOT EXPRESSIBLE AS A TAILWIND CLASS -->
					<div
						class="h-full rounded-full bg-[#c0392b] transition-all"
						style="width: {translateTotal ? (translateDone / translateTotal) * 100 : 0}%"
					></div>
				</div>
			</div>
			<Button size="sm" variant="ghost" on:click={cancelTranslate}>Cancel</Button>
		</div>
	{/if}

	<!-- CHAPTER LIST -->
	{#if items.length === 0}
		<!-- EMPTY STATE -->
		<div
			class="rounded-xl border border-dashed border-black/10 p-10 text-center text-sm opacity-60 dark:border-white/[0.06]"
		>
			<p>No chapters yet.</p>
			<p class="mt-1">
				Paste, fetch, or import one — or <button
					use:ripple
					type="button"
					on:click={() => (glossaryOpen = true)}
					class="text-[#b23a2e] hover:underline">set up the glossary</button
				> first.
			</p>
			<!-- PRIMARY EMPTY-STATE CTA: OPENS THE ADD-CHAPTER DIALOG -->
			<div class="mt-4 flex justify-center">
				<Button variant="primary" size="sm" on:click={() => (addOpen = true)}
					><Plus size={14} /> Add chapter</Button
				>
			</div>
		</div>
	{:else if visibleItems.length === 0}
		<!-- NO MATCHES FOR THE CURRENT SEARCH / FILTER -->
		<div
			class="rounded-xl border border-dashed border-black/10 p-10 text-center text-sm opacity-60 dark:border-white/[0.06]"
		>
			No chapters match your search or filter.
		</div>
	{:else}
		<!-- CHAPTER ROWS -->
		<ul
			class="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06] dark:divide-white/[0.045] dark:border-white/[0.045]"
		>
			{#each visibleItems as it, i (it.uuid)}
				{@const lbl = chapterLabel(it.titleSource, it.titleTarget)}
				{@const isResume = it.uuid === data.resumeUuid}
				<!-- DONE = ACTUALLY SCROLLED ~TO THE END (NOT JUST POSITIONED BEFORE THE RESUME POINT) -->
				{@const isRead = !isResume && it.readProgress >= READ_DONE}
				{@const partial = !isResume && it.readProgress > 0.02 && it.readProgress < READ_DONE}
				<li
					draggable={editItem === null && !selecting && !filtering}
					on:dragstart={() => (dragIndex = i)}
					on:dragover|preventDefault={() => (dragOverIndex = i)}
					on:dragend={() => {
						dragIndex = null;
						dragOverIndex = null;
					}}
					on:drop|preventDefault={() => onDrop(i)}
					class={cn(
						'flex items-center gap-2 px-2 py-2 sm:px-3',
						dragOverIndex === i && dragIndex !== null && dragIndex !== i && 'bg-[#c0392b]/10',
						dragIndex === i && 'opacity-40',
					)}
				>
					{#if selecting}
						<!-- SELECTION CHECKBOX (REPLACES THE DRAG/MOVE CONTROLS IN SELECT MODE) -->
						<button
							use:ripple
							type="button"
							on:click={() => toggleSelect(it.uuid)}
							aria-label="Select chapter"
							class={cn(
								'flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
								selected.has(it.uuid)
									? 'border-[#b23a2e] bg-[#b23a2e] text-white'
									: 'border-black/25 dark:border-white/25',
							)}
						>
							{#if selected.has(it.uuid)}<Check size={13} />{/if}
						</button>
					{:else if !filtering}
						<!-- DRAG HANDLE -->
						<span class="cursor-grab text-black/30 dark:text-white/30" title="Drag to reorder"
							><GripVertical size={16} /></span
						>
						<!-- UP/DOWN MOVE BUTTONS -->
						<div class="flex shrink-0 flex-col">
							<button
								use:ripple
								on:click={() => move(i, -1)}
								disabled={i === 0}
								class="opacity-50 hover:opacity-100 disabled:opacity-20"
								aria-label="Move up"><ChevronUp size={14} /></button
							>
							<button
								use:ripple
								on:click={() => move(i, 1)}
								disabled={i === items.length - 1}
								class="opacity-50 hover:opacity-100 disabled:opacity-20"
								aria-label="Move down"><ChevronDown size={14} /></button
							>
						</div>
					{/if}

					<!-- REAL CHAPTER NUMBER FROM THE TITLE; '·' FOR NON-CHAPTER ENTRIES -->
					<span class="min-w-[2rem] shrink-0 text-right text-xs tabular-nums opacity-40"
						>{lbl.kind === 'chapter' ? lbl.number : '·'}</span
					>

					<!-- READING STATE: ✓ ONLY WHEN ACTUALLY FINISHED; A SMALL % FOR A PARTIALLY-READ CHAPTER -->
					{#if isRead}
						<Check size={14} class="shrink-0 text-emerald-500 opacity-90" />
					{:else if partial}
						<span
							class="shrink-0 text-[10px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
							>{Math.round(it.readProgress * 100)}%</span
						>
					{/if}

					<!-- TITLE: A LINK NORMALLY; IN SELECT MODE IT TOGGLES THE ROW'S CHECKBOX INSTEAD OF NAVIGATING -->
					{#if selecting}
						<button
							use:ripple
							type="button"
							on:click={() => toggleSelect(it.uuid)}
							class={cn('min-w-0 flex-1 truncate text-left text-sm', isRead && 'opacity-55')}
							>{stripChapterPrefix(it.titleTarget || it.titleSource) ||
								it.titleTarget ||
								it.titleSource}</button
						>
					{:else}
						<a
							href="/app/book/{book.id}/{it.uuid}/"
							class={cn(
								'min-w-0 flex-1 truncate text-sm hover:text-[#b23a2e]',
								isResume && 'font-medium text-[#b23a2e] dark:text-[#e08a63]',
								isRead && 'opacity-55',
							)}
							>{stripChapterPrefix(it.titleTarget || it.titleSource) ||
								it.titleTarget ||
								it.titleSource}</a
						>
					{/if}
					<!-- STATUS BADGES: RESUME POINT · UNTRANSLATED · SPECIAL ENTRY -->
					{#if isResume}<Badge variant="sky" class="shrink-0">Reading</Badge>{/if}
					{#if !mono && !it.hasTarget}<Badge variant="amber" class="shrink-0">Untranslated</Badge>{/if}
					{#if lbl.kind === 'special'}<Badge variant="neutral" class="shrink-0">{lbl.tag}</Badge>{/if}
					<!-- PER-ROW KEBAB — HIDDEN IN SELECT MODE (THE BULK TOOLBAR TAKES OVER) -->
					{#if !selecting}
						<ActionMenu
							class="shrink-0"
							label="Chapter actions"
							items={rowActions(it)}
							on:select={(e) => onAction(it, e.detail)}
						/>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- CONFIRM DELETE DIALOG -->
<ConfirmDialog
	open={!!pendingDelete}
	title="Delete chapter?"
	message={pendingDelete ? `"${pendingDelete.titleSource}" and its translation will be permanently removed.` : ''}
	confirmLabel="Delete"
	on:confirm={confirmDelete}
	on:cancel={() => (pendingDelete = null)}
/>

<!-- CONFIRM BATCH DELETE DIALOG -->
<ConfirmDialog
	open={pendingBatchDelete}
	title="Delete selected chapters?"
	message={`${selected.size} chapter${selected.size === 1 ? '' : 's'} and their translations will be permanently removed.`}
	confirmLabel="Delete"
	on:confirm={confirmBatchDelete}
	on:cancel={() => (pendingBatchDelete = false)}
/>

<!-- CONFIRM TRANSLATE / RE-TRANSLATE DIALOG (BILLED — WARN BEFORE THE RUN) -->
<ConfirmDialog
	open={!!pendingTranslate}
	title={pendingTranslate?.force ? 'Re-translate chapters?' : 'Translate chapters?'}
	message={pendingTranslate
		? `${pendingTranslate.targets.length} chapter${pendingTranslate.targets.length === 1 ? '' : 's'} will be translated with ${modelLabel}. This may take a while.`
		: ''}
	confirmLabel={pendingTranslate?.force ? 'Re-translate' : 'Translate'}
	on:confirm={confirmTranslate}
	on:cancel={() => (pendingTranslate = null)}
/>

<!-- CHAPTER STATISTICS DIALOG (CONTENT METRICS · TOKENS · COST · TIMELINE) -->
<ChapterStats open={statsUuid !== null} uuid={statsUuid} on:close={() => (statsUuid = null)} />

<!-- EDIT CHAPTER TITLE DIALOG — BOTH THE TARGET AND THE SOURCE TITLE -->
<Modal open={editItem !== null} title="Edit chapter title" size="sm" on:close={cancelEdit}>
	<form class="flex flex-col gap-4" on:submit|preventDefault={saveEdit}>
		<!-- TARGET-LANGUAGE TITLE (WHAT THE LISTING + READER SHOW; EMPTY = FALL BACK TO THE SOURCE TITLE) -->
		<div class="block">
			<div class="mb-1 flex items-center justify-between gap-2">
				<span class="text-xs font-medium opacity-60">Translated title</span>
				<!-- AI-FILL FROM THE SOURCE TITLE — HIDDEN FOR READ-IN-ORIGINAL BOOKS (NO TRANSLATION DIRECTION) -->
				{#if !mono}
					<button
						use:ripple
						type="button"
						on:click={translateEditTitle}
						disabled={translatingTitle || !editTitle.trim()}
						class="inline-flex items-center gap-1 text-xs text-[#b23a2e] hover:underline disabled:opacity-40 dark:text-[#e08a63]"
					>
						<Languages size={12} />
						{translatingTitle ? 'Translating…' : 'Translate'}
					</button>
				{/if}
			</div>
			<input
				bind:value={editTitleTarget}
				on:keydown={(e) => {
					if (e.key === 'Escape') cancelEdit();
				}}
				placeholder="Not translated yet"
				class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
			/>
		</div>
		<!-- SOURCE TITLE — THE ORIGINAL TITLE AS WRITTEN IN THE SOURCE LANGUAGE -->
		<label class="block">
			<span class="mb-1 block text-xs font-medium opacity-60">Source title</span>
			<input
				bind:value={editTitle}
				on:keydown={(e) => {
					if (e.key === 'Escape') cancelEdit();
				}}
				placeholder="Chapter title…"
				class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
			/>
		</label>
		<!-- HIDDEN SUBMIT SO ENTER SAVES; THE VISIBLE ACTIONS LIVE IN THE FOOTER -->
		<button type="submit" class="hidden" aria-hidden="true"></button>
	</form>
	<svelte:fragment slot="footer">
		<Button on:click={cancelEdit}>Cancel</Button>
		<Button variant="primary" on:click={saveEdit}>Save</Button>
	</svelte:fragment>
</Modal>

<!-- EDIT BOOK DETAILS DIALOG — TITLE + AUTHOR (SOURCE & TRANSLATED) -->
<Modal open={editBookOpen} title="Edit book details" size="sm" on:close={() => (editBookOpen = false)}>
	<form class="flex flex-col gap-4" on:submit|preventDefault={saveBook}>
		{#if !mono}
			<!-- TRANSLATED TITLE + AI-FILL -->
			<div class="block">
				<div class="mb-1 flex items-center justify-between gap-2">
					<span class="text-xs font-medium opacity-60">Translated title</span>
					<button
						use:ripple
						type="button"
						on:click={() => translateBookField('title')}
						disabled={translatingBookTitle || !bTitle.trim()}
						class="inline-flex items-center gap-1 text-xs text-[#b23a2e] hover:underline disabled:opacity-40 dark:text-[#e08a63]"
					>
						<Languages size={12} />
						{translatingBookTitle ? 'Translating…' : 'Translate'}
					</button>
				</div>
				<input
					bind:value={bTitleTarget}
					placeholder="Not translated yet"
					class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
				/>
			</div>
		{/if}
		<!-- SOURCE TITLE -->
		<label class="block">
			<span class="mb-1 block text-xs font-medium opacity-60">{mono ? 'Title' : 'Source title'}</span>
			<input
				bind:value={bTitle}
				placeholder="Book title…"
				class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
			/>
		</label>
		<!-- AUTHOR (SOURCE) -->
		<label class="block">
			<span class="mb-1 block text-xs font-medium opacity-60">{mono ? 'Author' : 'Author (source)'}</span>
			<input
				bind:value={bAuthor}
				placeholder="Author…"
				class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
			/>
		</label>
		{#if !mono}
			<!-- TRANSLATED AUTHOR + AI-FILL -->
			<div class="block">
				<div class="mb-1 flex items-center justify-between gap-2">
					<span class="text-xs font-medium opacity-60">Author (translated)</span>
					<button
						use:ripple
						type="button"
						on:click={() => translateBookField('author')}
						disabled={translatingBookAuthor || !bAuthor.trim()}
						class="inline-flex items-center gap-1 text-xs text-[#b23a2e] hover:underline disabled:opacity-40 dark:text-[#e08a63]"
					>
						<Languages size={12} />
						{translatingBookAuthor ? 'Translating…' : 'Translate'}
					</button>
				</div>
				<input
					bind:value={bAuthorTarget}
					placeholder="Romanised / translated author"
					class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-[#c0392b] dark:border-white/[0.06]"
				/>
			</div>
		{/if}
		<!-- HIDDEN SUBMIT SO ENTER SAVES; THE VISIBLE ACTIONS LIVE IN THE FOOTER -->
		<button type="submit" class="hidden" aria-hidden="true"></button>
	</form>
	<svelte:fragment slot="footer">
		<Button on:click={() => (editBookOpen = false)}>Cancel</Button>
		<Button variant="primary" loading={savingBook} on:click={saveBook}>Save</Button>
	</svelte:fragment>
</Modal>

<!-- BOOK GLOSSARY DIALOG — REPLACES THE OLD STANDALONE /glossary/ PAGE -->
<Modal
	open={glossaryOpen}
	title="Book glossary"
	size="xl"
	bodyClass="flex min-h-0 flex-col overflow-hidden px-5 py-0"
	on:close={() => (glossaryOpen = false)}
>
	<GlossaryPanel scope="book" bookId={book.id} bookTitle={displayTitle} surface={THEME_PANEL[$settings.theme]} />
</Modal>
