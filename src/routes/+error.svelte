<script lang="ts">
	// IMPORTED MODULES
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Compass from 'lucide-svelte/icons/compass';
	import Home from 'lucide-svelte/icons/home';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';

	// -- REACTIVE STATES -- //
	$: status = $page.status;
	$: isNotFound = status === 404;
	$: message = $page.error?.message ?? '';
	$: heading = isNotFound ? 'Lost in the archives' : 'Something went wrong';
	$: blurb = isNotFound
		? "This page wandered off — the chapter, book, or scroll you were after isn't here anymore."
		: message || 'An unexpected error interrupted your reading. Try again, or head back to the library.';

	// -- FUNCTIONS -- //
	// PREFER THE BROWSER HISTORY WHEN THERE IS ONE; OTHERWISE FALL BACK TO THE LIBRARY
	function goBack() {
		if (browser && window.history.length > 1) window.history.back();
		else goto('/');
	}
</script>

<svelte:head><title>{status} · Xianslate</title></svelte:head>

<!-- THEMED ERROR PAGE — BACKGROUND + TEXT COLOUR COME FROM THE LAYOUT ROOT, SO IT MATCHES EVERY THEME -->
<div class="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
	<!-- BIG STATUS WITH A FLOATING BOOK/COMPASS BADGE -->
	<div class="relative mb-6 sm:mb-8">
		<span
			class="select-none bg-gradient-to-br from-sky-500 to-indigo-600 bg-clip-text text-[5.5rem] font-black leading-none tracking-tight text-transparent sm:text-[8rem]"
		>
			{status}
		</span>
		<div
			class="absolute -right-2 -top-2 rotate-6 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-400 p-3 text-white shadow-lg sm:-right-4 sm:p-4"
		>
			{#if isNotFound}<Compass size={26} />{:else}<BookOpen size={26} />{/if}
		</div>
	</div>

	<h1 class="text-2xl font-bold sm:text-3xl">{heading}</h1>
	<p class="mt-3 max-w-md text-sm leading-relaxed opacity-60 sm:text-base">{blurb}</p>
	{#if message && !isNotFound}
		<p class="mt-2 max-w-md break-words font-mono text-xs opacity-40">{message}</p>
	{/if}

	<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
		<Button variant="primary" href="/"><Home size={16} /> Back to library</Button>
		<Button on:click={goBack}><ArrowLeft size={16} /> Go back</Button>
	</div>
</div>
