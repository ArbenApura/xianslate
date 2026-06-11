<script lang="ts">
	// IMPORTED DEP-MODULES
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	// IMPORTED MODULES
	import { ripple } from '$lib/actions/ripple';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { scrollLock } from '$lib/actions/scrollLock';
	// IMPORTED COMPONENTS
	import ChapterList from './ChapterList.svelte';

	// -- REQUIRED PROPS -- //

	export let bookId: string;

	// -- OPTIONAL PROPS -- //

	export let open = false;
	export let currentUuid: string | null = null;

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher();
</script>

{#if open}
	<!-- BACKDROP OVERLAY (MOBILE/TABLET). use:scrollLock ONLY BELOW lg (1024px) — THE DRAWER IS lg:hidden,
	     SO ON DESKTOP IT IS INVISIBLE AND MUST NOT FREEZE PAGE SCROLL. -->
	<div
		use:scrollLock={{ maxWidth: 1023 }}
		class="fixed inset-0 z-40 bg-black/30 lg:hidden"
		role="button"
		tabindex="-1"
		aria-label="Close contents"
		use:ripple
		on:click={() => dispatch('close')}
		on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
		transition:fade={{ duration: 150 }}
	></div>
	<!-- TOC DRAWER (MOBILE/TABLET): BOTTOM SHEET ON MOBILE, LEFT PANEL ON SMALL DESKTOP -->
	<aside
		use:focusTrap
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		aria-label="Table of contents"
		transition:fly={{ y: 320, duration: 220, easing: cubicOut }}
		class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-slate-200 bg-white text-slate-900 shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:inset-y-0 sm:left-0 sm:right-auto sm:max-h-none sm:w-80 sm:rounded-none sm:border-r sm:border-t-0 lg:hidden"
	>
		<ChapterList {bookId} {currentUuid} on:select={(e) => dispatch('select', e.detail)}>
			<!-- CLOSE BUTTON SLOT -->
			<button
				slot="action"
				use:ripple
				on:click={() => dispatch('close')}
				class="rounded p-1 opacity-50 hover:opacity-100"
				aria-label="Close">✕</button
			>
		</ChapterList>
	</aside>
{/if}
