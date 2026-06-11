<script lang="ts">
	// IMPORTED MODULES
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED COMPONENTS
	import GlossaryPanel from '$lib/components/GlossaryPanel.svelte';
</script>

<svelte:head><title>Global glossary — Xianslate</title></svelte:head>

<!-- GLOBAL GLOSSARY PAGE -->
<div class="mx-auto min-h-full w-full max-w-4xl px-4 py-8 sm:px-6">
	<!-- BACK NAVIGATION -->
	<div class="mb-4 flex items-center justify-between">
		<a href="/" use:ripple class="text-sm text-slate-500 hover:text-sky-600">← Library</a>
	</div>
	<!-- PAGE HEADER -->
	<header class="mb-6">
		<h1 class="text-2xl font-bold leading-tight sm:text-3xl">Global glossary</h1>
		<p class="mt-1 text-sm opacity-60">Shared terms applied to every book</p>
	</header>
	<!-- GLOSSARY PANEL -->
	<GlossaryPanel scope="global" />
</div>
