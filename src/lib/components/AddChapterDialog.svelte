<script lang="ts">
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { createEventDispatcher } from 'svelte';
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import FileText from 'lucide-svelte/icons/file-text';
	import Globe from 'lucide-svelte/icons/globe';
	import Plus from 'lucide-svelte/icons/plus';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';

	// -- REQUIRED PROPS -- //

	export let bookId: string;

	// -- OPTIONAL PROPS -- //

	export let open = false;

	// -- TYPES -- //

	type AddMode = 'paste' | 'url' | 'file';

	// -- CONSTANTS -- //

	// EMITTED WITH THE FIRST NEW CHAPTER'S uuid + COUNT SO THE READER CAN JUMP STRAIGHT TO IT.
	const dispatch = createEventDispatcher<{ close: void; added: { firstUuid: string | null; count: number } }>();
	const MODES: { id: AddMode; label: string }[] = [
		{ id: 'paste', label: 'Paste text' },
		{ id: 'url', label: 'From URL' },
		{ id: 'file', label: 'EPUB / TXT' },
	];

	// -- STATES -- //

	let mode: AddMode = 'paste';
	let pasteTitle = '';
	let pasteContent = '';
	let urlInput = '';
	let busy = false;
	let epubInput: HTMLInputElement;
	let txtInput: HTMLInputElement;
	// CHOSEN-BUT-NOT-YET-IMPORTED FILE — PICKING STAGES IT; AN EXPLICIT "Import" CLICK COMMITS (NO AUTO-SUBMIT).
	let pendingImport: { kind: 'epub' | 'txt'; file: File } | null = null;

	// -- FUNCTIONS -- //

	function done(firstUuid: string | null, count: number) {
		pasteTitle = '';
		pasteContent = '';
		urlInput = '';
		dispatch('added', { firstUuid, count });
	}

	async function addManual() {
		if (!pasteTitle.trim() || !pasteContent.trim() || busy) return;
		busy = true;
		try {
			const res = await fetch(`/api/books/${bookId}/chapters`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					kind: 'manual',
					titleSource: pasteTitle.trim(),
					contentSource: pasteContent.trim(),
				}),
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(d.message ?? 'Failed to add chapter');
			toast.success('Chapter added.');
			done(d.firstUuid ?? null, d.added ?? 1);
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
			const res = await fetch(`/api/books/${bookId}/chapters`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'url', url: urlInput.trim() }),
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(d.message ?? 'Fetch failed');
			toast.success('Chapter fetched.', { id: tid });
			done(d.firstUuid ?? null, d.added ?? 1);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not fetch that URL.', { id: tid });
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
			fd.append('bookId', bookId);
			const res = await fetch(`/api/import/${kind}`, { method: 'POST', body: fd });
			const d = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(d.message ?? 'Import failed');
			toast.success(`Added ${d.chapters} chapter${d.chapters === 1 ? '' : 's'}.`, { id: tid });
			done(d.firstChapterUuid ?? null, d.chapters ?? 0);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Import failed.', { id: tid });
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	{open}
	title="Add chapter"
	size="lg"
	on:close={() => {
		pendingImport = null;
		dispatch('close');
	}}
>
	<!-- MODE TABS -->
	<div
		class="mb-3 inline-flex overflow-hidden rounded-lg border border-black/[0.12] text-xs dark:border-white/[0.08]"
	>
		{#each MODES as m (m.id)}
			<button
				use:ripple
				on:click={() => (mode = m.id)}
				class={cn(
					'px-3 py-1.5 transition-colors',
					mode === m.id ? 'bg-sky-600 text-white' : 'opacity-70 hover:opacity-100',
				)}>{m.label}</button
			>
		{/each}
	</div>

	{#if mode === 'paste'}
		<!-- PASTE A CHAPTER'S TITLE + BODY -->
		<form class="flex flex-col gap-2" on:submit|preventDefault={addManual}>
			<input
				bind:value={pasteTitle}
				placeholder="Chapter title…"
				class="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
			/>
			<textarea
				bind:value={pasteContent}
				rows="7"
				placeholder="Paste the chapter text here…"
				class="resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
			></textarea>
			<div>
				<Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy}>
					<Plus size={14} /> Add chapter
				</Button>
			</div>
		</form>
	{:else if mode === 'url'}
		<!-- FETCH A SINGLE CHAPTER PAGE FROM ANY SUPPORTED SITE INTO THIS BOOK -->
		<form class="flex flex-col gap-2 sm:flex-row" on:submit|preventDefault={addFromUrl}>
			<input
				bind:value={urlInput}
				type="url"
				placeholder="Paste any chapter URL…"
				class="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/[0.06]"
			/>
			<Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy}>
				<Globe size={14} /> Fetch into book
			</Button>
		</form>
		<p class="mt-2 text-xs opacity-50">Pulls that page's content into this book as the next chapter.</p>
	{:else if pendingImport}
		<!-- STAGED FILE — CONFIRM OR CLEAR BEFORE ANYTHING IS APPENDED -->
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
		<!-- IMPORT AN EPUB OR TXT — PICKING A FILE STAGES IT; "Import" APPENDS ITS CHAPTERS TO THIS BOOK -->
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<Button size="sm" disabled={busy} on:click={() => epubInput.click()}
				><FileText size={14} /> Choose EPUB</Button
			>
			<Button size="sm" disabled={busy} on:click={() => txtInput.click()}
				><FileText size={14} /> Choose TXT</Button
			>
			<span class="text-xs opacity-50">Appended to this book in order.</span>
		</div>
	{/if}

	<!-- HIDDEN FILE INPUTS FOR EPUB / TXT -->
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
</Modal>
