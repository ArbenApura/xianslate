<script lang="ts">
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	// IMPORTED MODULES
	import { chapterLabel, stripChapterPrefix } from '$lib/chapter-label';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';
	import Languages from 'lucide-svelte/icons/languages';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Plus from 'lucide-svelte/icons/plus';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import X from 'lucide-svelte/icons/x';
	// IMPORTED COMPONENTS
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	// IMPORTED TYPES
	import type { PageData } from './$types';

	// -- REQUIRED PROPS -- //
	export let data: PageData;

	// -- TYPES -- //
	type Item = { uuid: string; seq: number; titleZh: string; titleEn: string | null; hasEn: boolean };

	// -- CONSTANTS -- //
	type AddMode = 'paste' | 'url' | 'file';
	const ADD_MODES: { id: AddMode; label: string }[] = [
		{ id: 'paste', label: 'Paste' },
		{ id: 'url', label: 'From URL' },
		{ id: 'file', label: 'EPUB / TXT' },
	];

	// -- STATES -- //
	const book = data.book;
	let items: Item[] = data.chapters;
	let addMode: AddMode = 'paste';
	let pasteTitle = '';
	let pasteContent = '';
	let urlInput = '';
	let busy = false;
	let epubInput: HTMLInputElement;
	let txtInput: HTMLInputElement;

	let editingUuid: string | null = null;
	let editTitle = '';
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
				body: JSON.stringify({ kind: 'manual', titleZh: pasteTitle.trim(), contentZh: pasteContent.trim() }),
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Failed to add chapter');
			pasteTitle = '';
			pasteContent = '';
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
			toast.success(`Added ${d.chapters} chapter${d.chapters === 1 ? '' : 's'}.`, { id: tid });
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Import failed.', { id: tid });
		} finally {
			busy = false;
		}
	}

	// -- RENAME -- //
	function startEdit(it: Item) {
		editingUuid = it.uuid;
		editTitle = it.titleZh;
	}
	function cancelEdit() {
		editingUuid = null;
		editTitle = '';
	}
	async function saveEdit(it: Item) {
		const title = editTitle.trim();
		if (!title || title === it.titleZh) return cancelEdit();
		try {
			const res = await fetch(`/api/chapters/${it.uuid}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ titleZh: title }),
			});
			if (!res.ok) throw new Error();
			items = items.map((x) => (x.uuid === it.uuid ? { ...x, titleZh: title } : x));
			cancelEdit();
		} catch {
			toast.error('Could not rename chapter.');
		}
	}

	// -- DELETE -- //
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

	// -- REORDER -- //
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

<div class="mx-auto min-h-full w-full max-w-4xl px-4 py-8 sm:px-6">
	<!-- HEADER -->
	<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
		<a href="/" class="inline-flex items-center gap-1.5 text-sm opacity-70 hover:opacity-100">
			<ArrowLeft size={15} /> Library
		</a>
		<div class="flex items-center gap-2">
			{#if items.length}
				<Button href="/book/{book.id}/" size="sm"><BookOpen size={14} /> Read</Button>
			{/if}
			<Button href="/book/{book.id}/glossary/" size="sm"><Languages size={14} /> Glossary</Button>
		</div>
	</div>

	<h1 class="mb-1 text-2xl font-bold">{book.title}</h1>
	<p class="mb-6 text-sm opacity-50">
		{items.length} chapter{items.length === 1 ? '' : 's'} · manage, reorder, and add content
	</p>

	<!-- ADD PANEL -->
	<section class="bg-current/[0.02] mb-8 rounded-2xl border border-black/[0.06] p-4 dark:border-white/[0.045]">
		<div class="mb-3 inline-flex overflow-hidden rounded-lg border border-black/[0.12] text-xs dark:border-white/[0.08]">
			{#each ADD_MODES as m (m.id)}
				<button
					on:click={() => (addMode = m.id)}
					class={cn(
						'px-3 py-1.5 transition-colors',
						addMode === m.id ? 'bg-sky-600 text-white' : 'opacity-70 hover:opacity-100',
					)}>{m.label}</button
				>
			{/each}
		</div>

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
		{:else}
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<Button size="sm" disabled={busy} on:click={() => epubInput.click()}>Import EPUB</Button>
				<Button size="sm" disabled={busy} on:click={() => txtInput.click()}>Import TXT</Button>
				<span class="text-xs opacity-50">Its chapters are appended to this book.</span>
			</div>
		{/if}
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
	</section>

	<!-- CHAPTER LIST -->
	{#if items.length === 0}
		<div class="rounded-xl border border-dashed border-black/10 p-10 text-center text-sm opacity-60 dark:border-white/[0.06]">
			<p>No chapters yet.</p>
			<p class="mt-1">
				Add one above, or <a href="/book/{book.id}/glossary/" class="text-sky-600 hover:underline">set up the glossary</a> first.
			</p>
		</div>
	{:else}
		<ul class="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06] dark:divide-white/[0.045] dark:border-white/[0.045]">
			{#each items as it, i (it.uuid)}
				{@const lbl = chapterLabel(it.titleZh, it.titleEn)}
				<li
					draggable={editingUuid === null}
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
					<!-- UP/DOWN -->
					<div class="flex shrink-0 flex-col">
						<button
							on:click={() => move(i, -1)}
							disabled={i === 0}
							class="opacity-50 hover:opacity-100 disabled:opacity-20"
							aria-label="Move up"><ChevronUp size={14} /></button
						>
						<button
							on:click={() => move(i, 1)}
							disabled={i === items.length - 1}
							class="opacity-50 hover:opacity-100 disabled:opacity-20"
							aria-label="Move down"><ChevronDown size={14} /></button
						>
					</div>
					<!-- REAL CHAPTER NUMBER FROM THE TITLE; '·' FOR NON-CHAPTER ENTRIES -->
					<span class="shrink-0 text-right text-xs tabular-nums opacity-40" style="min-width:2rem"
						>{lbl.kind === 'chapter' ? lbl.number : '·'}</span
					>

					<!-- TITLE / RENAME -->
					{#if editingUuid === it.uuid}
						<input
							bind:value={editTitle}
							on:keydown={(e) => {
								if (e.key === 'Enter') saveEdit(it);
								else if (e.key === 'Escape') cancelEdit();
							}}
							class="min-w-0 flex-1 rounded-md border border-sky-500 bg-transparent px-2 py-1 text-sm outline-none"
						/>
						<button on:click={() => saveEdit(it)} class="text-emerald-600 hover:opacity-100" aria-label="Save"
							><Check size={16} /></button
						>
						<button on:click={cancelEdit} class="opacity-60 hover:opacity-100" aria-label="Cancel"
							><X size={16} /></button
						>
					{:else}
						<a href="/book/{book.id}/{it.uuid}/" class="min-w-0 flex-1 truncate text-sm hover:text-sky-600"
							>{stripChapterPrefix(it.titleEn || it.titleZh)}</a
						>
						{#if lbl.kind === 'special'}<Badge variant="neutral" class="shrink-0">{lbl.tag}</Badge>{/if}
						{#if it.hasEn}<Badge variant="emerald" class="shrink-0">EN</Badge>{/if}
						<button on:click={() => startEdit(it)} class="shrink-0 opacity-50 hover:opacity-100" aria-label="Rename"
							><Pencil size={14} /></button
						>
						<button
							on:click={() => (pendingDelete = it)}
							class="shrink-0 text-red-500/70 hover:text-red-500"
							aria-label="Delete chapter"><Trash2 size={14} /></button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<ConfirmDialog
	open={!!pendingDelete}
	title="Delete chapter?"
	message={pendingDelete ? `"${pendingDelete.titleZh}" and its translation will be permanently removed.` : ''}
	confirmLabel="Delete"
	on:confirm={confirmDelete}
	on:cancel={() => (pendingDelete = null)}
/>
