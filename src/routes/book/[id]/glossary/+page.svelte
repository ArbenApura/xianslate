<script lang="ts">
	// IMPORTED COMPONENTS
	import GlossaryPanel from '$lib/components/GlossaryPanel.svelte';
	// IMPORTED TYPES
	import type { PageData } from './$types';

	// -- REQUIRED PROPS -- //

	export let data: PageData;
</script>

<svelte:head><title>{data.bookTitle} — Glossary</title></svelte:head>

<!-- BOOK GLOSSARY PAGE -->
<div class="mx-auto min-h-full w-full max-w-4xl px-4 py-8 sm:px-6">
	<div class="mb-4 flex items-center justify-between gap-4">
		<a href="/book/{data.bookId}/" class="text-sm text-slate-500 hover:text-sky-600">← Back to reader</a>
		<a href="/glossary/" class="text-sm text-sky-600 hover:underline">Global glossary →</a>
	</div>
	<header class="mb-6">
		<h1 class="text-2xl font-bold leading-tight sm:text-3xl">{data.bookTitle}</h1>
		<p class="mt-1 text-sm opacity-60">Book glossary</p>
	</header>
	<GlossaryPanel scope="book" bookId={data.bookId} bookTitle={data.bookTitle} />
</div>
