<script lang="ts">
	// IMPORTED DEP-MODULES
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { ripple } from '$lib/actions/ripple';
	import { scrollLock } from '$lib/actions/scrollLock';
	// IMPORTED DEP-COMPONENTS
	import X from 'lucide-svelte/icons/x';

	// -- OPTIONAL PROPS -- //

	export let open = false;
	export let title = '';
	export let size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
	// PADDING OF THE SCROLLABLE BODY. OVERRIDE (E.G. DROP THE TOP PAD) WHEN THE SLOT HAS ITS OWN STICKY HEADER.
	export let bodyClass = 'p-5';

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher();
	const SIZES: Record<string, string> = {
		sm: 'sm:max-w-sm',
		md: 'sm:max-w-lg',
		lg: 'sm:max-w-2xl',
		xl: 'sm:max-w-4xl',
	};

	// -- FUNCTIONS -- //

	function close() {
		dispatch('close');
	}
</script>

<svelte:window on:keydown={(e) => open && e.key === 'Escape' && close()} />

{#if open}
	<!-- DIALOG: BOTTOM SHEET ON MOBILE, CENTERED CARD ON DESKTOP. use:scrollLock FREEZES THE PAGE BEHIND. -->
	<div
		use:scrollLock
		class="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
		role="dialog"
		aria-modal="true"
	>
		<!-- BACKDROP OVERLAY — NO RIPPLE (A FULL-SCREEN DISMISS SHOULDN'T FLASH A RIPPLE ON CLICK) -->
		<button
			class="absolute inset-0 bg-black/40 backdrop-blur-sm"
			on:click={close}
			aria-label="Close dialog"
			tabindex="-1"
			transition:fade={{ duration: 150 }}
		></button>
		<!-- MODAL CARD -->
		<div
			use:focusTrap
			tabindex="-1"
			transition:fly={{ y: 24, duration: 220, easing: cubicOut }}
			class={cn(
				'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white text-slate-900 shadow-2xl outline-none dark:bg-slate-900 dark:text-slate-100 sm:rounded-2xl',
				SIZES[size],
			)}
		>
			{#if title || $$slots.header}
				<!-- MODAL HEADER -->
				<header
					class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700"
				>
					<h2 class="text-base font-semibold">{title}</h2>
					<slot name="header" />
					<!-- CLOSE BUTTON -->
					<button
						on:click={close}
						use:ripple
						class="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
						aria-label="Close"
					>
						<X size={18} />
					</button>
				</header>
			{/if}
			<!-- MODAL BODY -->
			<div class={cn('min-h-0 flex-1 overflow-y-auto', bodyClass)}>
				<slot />
			</div>
			{#if $$slots.footer}
				<!-- MODAL FOOTER -->
				<footer
					class="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700"
				>
					<slot name="footer" />
				</footer>
			{/if}
		</div>
	</div>
{/if}
