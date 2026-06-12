<script lang="ts">
	// IMPORTED MODULES
	import { get } from 'svelte/store';
	import { languageOptions } from '$lib/languages';
	import { settings } from '$lib/stores/settings';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED COMPONENTS
	import GlossaryPanel from '$lib/components/GlossaryPanel.svelte';
	import Select from '$lib/components/ui/Select.svelte';

	// -- CONSTANTS -- //

	const LANG_ITEMS = languageOptions();

	// -- STATES -- //

	// THE LANGUAGE PAIR WHOSE GLOBAL GLOSSARY IS BEING VIEWED/EDITED — SEEDED FROM THE NEW-BOOK DEFAULT.
	let sourceLang = get(settings).newBookSourceLang;
	let targetLang = get(settings).newBookTargetLang;
</script>

<svelte:head><title>Global glossary — Xianslate</title></svelte:head>

<!-- GLOBAL GLOSSARY PAGE -->
<div class="mx-auto min-h-full w-full max-w-4xl px-4 py-8 sm:px-6">
	<!-- BACK NAVIGATION -->
	<div class="mb-4 flex items-center justify-between">
		<a href="/app/" use:ripple class="text-sm text-slate-500 hover:text-sky-600">← Library</a>
	</div>
	<!-- PAGE HEADER -->
	<header class="mb-6">
		<h1 class="text-2xl font-bold leading-tight sm:text-3xl">Global glossary</h1>
		<p class="mt-1 text-sm opacity-60">Shared terms applied to every book of the selected language pair</p>
	</header>

	<!-- LANGUAGE-PAIR PICKER — A GLOBAL GLOSSARY IS PARTITIONED PER DIRECTION (e.g. zh→en VS ja→en) -->
	<div class="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
		<div class="min-w-0">
			<span class="mb-1 block text-xs opacity-50">Source (original)</span>
			<Select items={LANG_ITEMS} value={sourceLang} on:change={(e) => (sourceLang = e.detail)} />
		</div>
		<span class="hidden pb-2 text-center opacity-40 sm:block">→</span>
		<div class="min-w-0">
			<span class="mb-1 block text-xs opacity-50">Target (translation)</span>
			<Select items={LANG_ITEMS} value={targetLang} on:change={(e) => (targetLang = e.detail)} />
		</div>
	</div>

	<!-- GLOSSARY PANEL — REMOUNTS ON A PAIR CHANGE SO ITS PAGINATION/SEARCH RESET CLEANLY -->
	{#key `${sourceLang}>${targetLang}`}
		<GlossaryPanel scope="global" {sourceLang} {targetLang} />
	{/key}
</div>
