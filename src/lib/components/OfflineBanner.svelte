<script lang="ts">
	// OFFLINE BANNER — A TRANSIENT PILL: APPEARS WHEN THE NETWORK DROPS, THEN AUTO-HIDES AFTER A FEW
	// SECONDS. DELIBERATELY NOT PERSISTENT — A PERMANENT PILL IS DISTRACTING WHILE READING. REAPPEARS
	// ONLY ON THE NEXT OFFLINE TRANSITION, NOT ON EVERY QUEUED WRITE (PROGRESS OPS QUEUE CONSTANTLY
	// WHILE READING OFFLINE — RE-SHOWING PER OP WOULD FLASH THE PILL THE WHOLE TIME).

	import { offlineBanner } from '$lib/offline/gate';
	import { pendingCount } from '$lib/offline/outbox';
	import { currentUser } from '$lib/stores/auth';
	import { online } from '$lib/offline/network';
	import { get } from 'svelte/store';
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';

	// HOW LONG THE PILL STAYS UP BEFORE FADING (ms).
	const SHOW_MS = 4000;

	// HOW MANY WRITES ARE QUEUED (SHOWN SO THE USER KNOWS SYNCING IS PENDING, NOT LOST).
	let queued = 0;
	// WHETHER THE PILL IS CURRENTLY ON SCREEN (TIMER-CONTROLLED — THE STORE JUST TRIGGERS RE-SHOWS).
	let visible = false;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	async function recount() {
		const uid = get(currentUser)?.id;
		if (!uid) return;
		queued = await pendingCount(uid);
	}

	function show() {
		visible = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => (visible = false), SHOW_MS);
	}

	onMount(() => {
		// THE FIRST SUBSCRIBE FIRES IMMEDIATELY — ON AN OFFLINE COLD START currentUser IS STILL null AT
		// THAT MOMENT (SESSION HYDRATION RUNS CONCURRENTLY), SO RE-RUN WHEN THE USER ARRIVES TOO.
		const unsubUser = currentUser.subscribe(() => {
			void recount();
		});
		const unsubOnline = online.subscribe((up) => {
			if (!up) show(); // NETWORK JUST DROPPED → SHOW THE PILL
			void recount();
		});
		// THE FIRST subscribe() CALLBACK ALSO FIRES ON SUBSCRIBE — WHILE ONLINE offlineBanner IS FALSE
		// (NOTHING SHOWS); ON AN OFFLINE COLD START IT FLIPS TRUE AFTER HYDRATION → SHOW THE PILL.
		const unsubBanner = offlineBanner.subscribe((off) => {
			if (off) show();
		});
		return () => {
			unsubUser();
			unsubOnline();
			unsubBanner();
		};
	});

	onDestroy(() => clearTimeout(hideTimer));
</script>

{#if $offlineBanner && visible}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3"
		role="status"
		aria-live="polite"
		transition:fade={{ duration: 250 }}
	>
		<div
			class="flex items-center gap-2 rounded-full border border-black/10 bg-[#f7efe0]/95 px-4 py-1.5 text-xs font-medium shadow-md backdrop-blur dark:border-white/10 dark:bg-[#2a2118]/95"
		>
			<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-[#c0392b]"></span>
			<span>Offline — showing saved content</span>
			{#if queued > 0}
				<span class="opacity-60">· {queued} change{queued === 1 ? '' : 's'} waiting to sync</span>
			{/if}
		</div>
	</div>
{/if}
