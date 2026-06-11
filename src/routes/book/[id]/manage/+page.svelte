<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { PageData } from './$types';
	// IMPORTED TYPES
	import type { MenuAction } from '$lib/components/ui/ActionMenu.svelte';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	// IMPORTED MODULES
	import { goto } from '$app/navigation';
	import { chapterLabel, stripChapterPrefix } from '$lib/chapter-label';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import Circle from 'lucide-svelte/icons/circle';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';
	import Languages from 'lucide-svelte/icons/languages';
	import ListChecks from 'lucide-svelte/icons/list-checks';
	import ListX from 'lucide-svelte/icons/list-x';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Plus from 'lucide-svelte/icons/plus';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	// IMPORTED COMPONENTS
	import ActionMenu from '$lib/components/ui/ActionMenu.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import GlossaryPanel from '$lib/components/GlossaryPanel.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';

	// -- REQUIRED PROPS -- //

	export let data: PageData;

	// -- TYPES -- //

	type Item = {
		uuid: string;
		seq: number;
		titleSource: string;
		titleTarget: string | null;
		hasTarget: boolean;
		// 0..1 FRACTION ACTUALLY READ — DRIVES THE ✓ (DONE) AND THE IN-PROGRESS BAR
		readProgress: number;
	};
	type AddMode = 'paste' | 'url' | 'file';

	// -- CONSTANTS -- //

	const book = data.book;
	const ADD_MODES: { id: AddMode; label: string }[] = [
		{ id: 'paste', label: 'Paste' },
		{ id: 'url', label: 'From URL' },
		{ id: 'file', label: 'EPUB / TXT' },
	];
	// A CHAPTER IS "READ" ONLY ONCE SCROLLED ~TO THE END (0.9 TOLERATES THE FOOTER BELOW THE PROSE).
	const READ_DONE = 0.9;

	// -- STATES -- //

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
	// EDIT-TITLE DIALOG: THE CHAPTER BEING RENAMED (null = CLOSED) + ITS WORKING SOURCE/TARGET TITLES
	let editItem: Item | null = null;
	let editTitle = '';
	let editTitleTarget = '';
	// TRUE WHILE THE EDIT DIALOG'S "Translate" HELPER IS FILLING THE TARGET TITLE FROM THE SOURCE ONE
	let translatingTitle = false;
	let pendingDelete: Item | null = null;
	let dragIndex: number | null = null;
	let dragOverIndex: number | null = null;

	// -- FUNCTIONS -- //

	async function refresh() {
		try {
			const res = await fetch(`/api/books/${book.id}`);
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
			const res = await fetch(`/api/books/${book.id}/chapters`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'manual', titleSource: pasteTitle.trim(), contentSource: pasteContent.trim() }),
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
			const res = await fetch(`/api/books/${book.id}/chapters`, {
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
			const res = await fetch(`/api/import/${kind}`, { method: 'POST', body: fd });
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
		if (action === 'open') goto(`/book/${book.id}/${it.uuid}/`);
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
				scope === 'all' ||
				(scope === 'this' && x.uuid === it.uuid) ||
				(scope === 'previous' && x.seq < it.seq);
			return hit ? { ...x, readProgress: value } : x;
		});
		try {
			const res = await fetch(`/api/books/${book.id}/read`, {
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
			const res = await fetch('/api/translate-text', {
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
			const res = await fetch(`/api/chapters/${it.uuid}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ titleSource, titleTarget: titleTarget || null }),
			});
			if (!res.ok) throw new Error();
			items = items.map((x) => (x.uuid === it.uuid ? { ...x, titleSource, titleTarget: titleTarget || null } : x));
			cancelEdit();
		} catch {
			toast.error('Could not save the chapter title.');
		}
	}

	async function confirmDelete() {
		const it = pendingDelete;
		pendingDelete = null;
		if (!it) return;
		try {
			const res = await fetch(`/api/chapters/${it.uuid}`, { method: 'DELETE' });
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
			const res = await fetch(`/api/books/${book.id}/chapters`, {
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
</script>

<svelte:head><title>{book.title} — Manage chapters</title></svelte:head>

<!-- PAGE WRAPPER -->
<div class="mx-auto min-h-full w-full max-w-4xl px-4 py-8 sm:px-6">
	<!-- HEADER -->
	<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
		<!-- BACK TO THE READER (THE BOOK'S RESUME CHAPTER), NOT THE LIBRARY -->
		<a
			use:ripple
			href="/book/{book.id}/"
			class="inline-flex items-center gap-1.5 text-sm opacity-70 hover:opacity-100"
		>
			<ArrowLeft size={15} /> Back to reading
		</a>
		<div class="flex items-center gap-2">
			<!-- OPENS THE ADD-CHAPTER DIALOG -->
			<Button variant="primary" size="sm" on:click={() => (addOpen = true)}><Plus size={14} /> Add chapter</Button>
			{#if items.length}
				<Button href="/book/{book.id}/" size="sm"><BookOpen size={14} /> Read</Button>
			{/if}
			<Button on:click={() => (glossaryOpen = true)} size="sm"><Languages size={14} /> Glossary</Button>
		</div>
	</div>

	<!-- BOOK TITLE AND CHAPTER COUNT -->
	<h1 class="mb-1 text-2xl font-bold">{book.title}</h1>
	<p class="mb-6 text-sm opacity-50">
		{items.length} chapter{items.length === 1 ? '' : 's'} · manage, reorder, and add content
	</p>

	<!-- ADD-CHAPTER DIALOG: TABBED PASTE / URL / FILE IMPORT -->
	<Modal open={addOpen} title="Add chapter" size="lg" on:close={() => (addOpen = false)}>
		<!-- ADD MODE TABS -->
		<div class="mb-3 inline-flex overflow-hidden rounded-lg border border-black/[0.12] text-xs dark:border-white/[0.08]">
			{#each ADD_MODES as m (m.id)}
				<button
					use:ripple
					on:click={() => (addMode = m.id)}
					class={cn(
						'px-3 py-1.5 transition-colors',
						addMode === m.id ? 'bg-sky-600 text-white' : 'opacity-70 hover:opacity-100',
					)}>{m.label}</button
				>
			{/each}
		</div>

		<!-- PASTE MODE FORM -->
		{#if addMode === 'paste'}
			<form class="flex flex-col gap-2" on:submit|preventDefault={addManual}>
				<input
					bind:value={pasteTitle}
					placeholder="Chapter title (Chinese)…"
					class="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
				/>
				<textarea
					bind:value={pasteContent}
					rows="6"
					placeholder="Paste the Chinese chapter text here…"
					class="resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
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
					placeholder="Paste a uukanshu.cc chapter URL…"
					class="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
				/>
				<Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy}>Fetch into book</Button>
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

	<!-- CHAPTER LIST -->
	{#if items.length === 0}
		<!-- EMPTY STATE -->
		<div class="rounded-xl border border-dashed border-black/10 p-10 text-center text-sm opacity-60 dark:border-white/[0.06]">
			<p>No chapters yet.</p>
			<p class="mt-1">
				Paste, fetch, or import one — or <button
					use:ripple
					type="button"
					on:click={() => (glossaryOpen = true)}
					class="text-sky-600 hover:underline">set up the glossary</button
				> first.
			</p>
			<!-- PRIMARY EMPTY-STATE CTA: OPENS THE ADD-CHAPTER DIALOG -->
			<div class="mt-4 flex justify-center">
				<Button variant="primary" size="sm" on:click={() => (addOpen = true)}><Plus size={14} /> Add chapter</Button>
			</div>
		</div>
	{:else}
		<!-- CHAPTER ROWS -->
		<ul class="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06] dark:divide-white/[0.045] dark:border-white/[0.045]">
			{#each items as it, i (it.uuid)}
				{@const lbl = chapterLabel(it.titleSource, it.titleTarget)}
				{@const isResume = it.uuid === data.resumeUuid}
				<!-- DONE = ACTUALLY SCROLLED ~TO THE END (NOT JUST POSITIONED BEFORE THE RESUME POINT) -->
				{@const isRead = !isResume && it.readProgress >= READ_DONE}
				{@const partial = !isResume && it.readProgress > 0.02 && it.readProgress < READ_DONE}
				<li
					draggable={editItem === null}
					on:dragstart={() => (dragIndex = i)}
					on:dragover|preventDefault={() => (dragOverIndex = i)}
					on:dragend={() => {
						dragIndex = null;
						dragOverIndex = null;
					}}
					on:drop|preventDefault={() => onDrop(i)}
					class={cn(
						'flex items-center gap-2 px-2 py-2 sm:px-3',
						dragOverIndex === i && dragIndex !== null && dragIndex !== i && 'bg-sky-500/10',
						dragIndex === i && 'opacity-40',
					)}
				>
					<!-- DRAG HANDLE -->
					<span class="cursor-grab text-black/30 dark:text-white/30" title="Drag to reorder"><GripVertical size={16} /></span>

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

					<!-- REAL CHAPTER NUMBER FROM THE TITLE; '·' FOR NON-CHAPTER ENTRIES -->
					<span class="min-w-[2rem] shrink-0 text-right text-xs tabular-nums opacity-40"
						>{lbl.kind === 'chapter' ? lbl.number : '·'}</span
					>

					<!-- READING STATE: ✓ ONLY WHEN ACTUALLY FINISHED; A SMALL % FOR A PARTIALLY-READ CHAPTER -->
					{#if isRead}
						<Check size={14} class="shrink-0 text-emerald-500 opacity-90" />
					{:else if partial}
						<span class="shrink-0 text-[10px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
							>{Math.round(it.readProgress * 100)}%</span
						>
					{/if}

					<!-- CHAPTER LINK + BADGES + KEBAB MENU (EDIT / DELETE / OPEN) -->
					<a
						href="/book/{book.id}/{it.uuid}/"
						class={cn(
							'min-w-0 flex-1 truncate text-sm hover:text-sky-600',
							isResume && 'font-medium text-sky-600 dark:text-sky-300',
							isRead && 'opacity-55',
						)}>{stripChapterPrefix(it.titleTarget || it.titleSource)}</a
					>
					{#if isResume}<Badge variant="sky" class="shrink-0">Reading</Badge>{/if}
					{#if lbl.kind === 'special'}<Badge variant="neutral" class="shrink-0">{lbl.tag}</Badge>{/if}
					<ActionMenu
						class="shrink-0"
						label="Chapter actions"
						items={rowActions(it)}
						on:select={(e) => onAction(it, e.detail)}
					/>
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

<!-- EDIT CHAPTER TITLE DIALOG — BOTH THE TARGET AND THE SOURCE TITLE -->
<Modal open={editItem !== null} title="Edit chapter title" size="sm" on:close={cancelEdit}>
	<form class="flex flex-col gap-4" on:submit|preventDefault={saveEdit}>
		<!-- TARGET-LANGUAGE TITLE (WHAT THE LISTING + READER SHOW; EMPTY = FALL BACK TO THE SOURCE TITLE) -->
		<div class="block">
			<div class="mb-1 flex items-center justify-between gap-2">
				<span class="text-xs font-medium opacity-60">Translated title</span>
				<!-- AI-FILL FROM THE SOURCE TITLE -->
				<button
					use:ripple
					type="button"
					on:click={translateEditTitle}
					disabled={translatingTitle || !editTitle.trim()}
					class="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline disabled:opacity-40 dark:text-sky-300"
				>
					<Languages size={12} /> {translatingTitle ? 'Translating…' : 'Translate'}
				</button>
			</div>
			<input
				bind:value={editTitleTarget}
				on:keydown={(e) => {
					if (e.key === 'Escape') cancelEdit();
				}}
				placeholder="Not translated yet"
				class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
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
				class="w-full rounded-md border border-black/10 bg-transparent px-2.5 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
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

<!-- BOOK GLOSSARY DIALOG — REPLACES THE OLD STANDALONE /glossary/ PAGE -->
<Modal
	open={glossaryOpen}
	title="Book glossary"
	size="xl"
	bodyClass="flex min-h-0 flex-col overflow-hidden px-5 py-0"
	on:close={() => (glossaryOpen = false)}
>
	<GlossaryPanel scope="book" bookId={book.id} bookTitle={book.title} surface="bg-white dark:bg-slate-900" />
</Modal>
