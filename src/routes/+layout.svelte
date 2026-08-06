<script lang="ts">
	// IMPORTED ASSETS
	import '../app.css';
	// IMPORTED DEP-TYPES
	import type { LayoutData } from './$types';
	// IMPORTED TYPES
	import type { SessionUser } from '$lib/stores/auth';
	import type { Theme } from '$lib/stores/settings';
	// IMPORTED ENVS
	import { browser } from '$app/environment';
	// IMPORTED MODULES
	import { Capacitor } from '@capacitor/core';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authReady, currentUser, hydrateSession, refreshUser, seedUser } from '$lib/stores/auth';
	import { initNativeRuntime } from '$lib/native';
	import { initNetworkListeners, online } from '$lib/offline/network';
	import { syncNow } from '$lib/offline/sync';
	import { settings, THEME_CLASS } from '$lib/stores/settings';
	import { cn } from '$lib/utils/cn';
	import { onMount } from 'svelte';
	// IMPORTED DEP-COMPONENTS
	import { Toaster } from 'svelte-sonner';
	// IMPORTED COMPONENTS
	import OfflineBanner from '$lib/components/OfflineBanner.svelte';

	// -- REQUIRED PROPS -- //

	export let data: LayoutData;

	// -- REACTIVE STATES -- //

	// SSR USES THE COOKIE THEME; THE CLIENT FOLLOWS THE STORE (BOTH AGREE → NO FLICKER)
	$: theme = (browser ? $settings.theme : (data.theme as Theme)) ?? 'sepia';
	$: rootClass = THEME_CLASS[theme] ?? THEME_CLASS.sepia;

	// -- REACTIVE STATEMENTS -- //

	// SEED THE auth STORE FROM SSR LAYOUT DATA ON EVERY NAVIGATION — browser-GUARDED SO THE MODULE-LEVEL
	// STORE IS NEVER MUTATED DURING SSR (THAT WOULD LEAK BETWEEN REQUESTS).
	$: if (browser) seedUser(data.user);

	// CLIENT-SIDE ROUTE GUARD — THE SERVER hooks GUARD ONLY FIRES ON FULL LOADS / SERVER-LOAD DATA REQUESTS,
	// SO A CLIENT-SIDE NAVIGATION INTO /app (NO SERVER LOAD RE-RUNS) WOULD RENDER THE SHELL WITHOUT AUTH.
	// ENFORCE IT HERE ONCE AUTH IS KNOWN (authReady), SO "Open app" AND ANY /app DEEP LINK BOUNCE TO /login
	// WHEN SIGNED OUT — MATCHING hooks.server.ts.
	$: if (browser && $authReady) enforceAuth($page.url.pathname, $page.url.search, $currentUser);

	// NATIVE APP: THE LANDING PAGE IS WEB-ONLY. THE COLD-START REDIRECT LIVES IN app-capacitor.html; THIS
	// GUARD CATCHES ANY CLIENT-SIDE NAVIGATION TO / (E.G. THE BRAND LINKS ON /login AND /signup) AND BLANKS
	// THE SLOT SO THE LANDING NEVER FLASHES IN THE APP. /app/ THEN RESOLVES VIA enforceAuth: LIBRARY WHEN
	// SIGNED IN, /login WHEN NOT.
	$: nativeLanding = browser && Capacitor.isNativePlatform() && $page.url.pathname === '/';
	$: if (nativeLanding) goto('/app/', { replaceState: true });

	// -- FUNCTIONS -- //

	function enforceAuth(pathname: string, search: string, user: SessionUser | null) {
		if (pathname.startsWith('/app') && !user) {
			// PRESERVE THE INTENDED DESTINATION SO LOGIN CAN RETURN THERE (SAME ?redirect= CONTRACT AS THE SERVER).
			goto(`/login/?redirect=${encodeURIComponent(pathname + search)}`, { replaceState: true });
		} else if (user && /^\/(login|signup)\/?$/.test(pathname)) {
			// ALREADY SIGNED IN → DON'T SHOW THE AUTH PAGES. HONOUR A SAFE INTERNAL ?redirect= (THE BOUNCE
			// TARGET), ELSE GO TO THE LIBRARY.
			const dest = new URLSearchParams(search).get('redirect');
			const safe = !!dest && dest.startsWith('/') && !dest.startsWith('//') && !/^\/(login|signup)/.test(dest);
			goto(safe ? dest : '/app/', { replaceState: true });
		}
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		// NETWORK-AWARENESS FIRST SO EVERYTHING ELSE KNOWS WHETHER /api IS REACHABLE.
		initNetworkListeners();
		// WHEN THE NETWORK COMES BACK, FLUSH THE QUEUED WRITES + REVALIDATE CACHES (DEBOUNCED INSIDE).
		const unsubOnline = online.subscribe((up) => {
			if (up) void syncNow();
		});
		// CONFIRM / FRESHEN THE SESSION FROM /api/me. SKIP ONLY WHEN THE SERVER ALREADY SAID "SIGNED OUT".
		// ON THE CAPACITOR SPA data.user IS undefined (NO SSR): HYDRATE THE STORE FROM THE LOCAL SESSION
		// CACHE FIRST SO AN OFFLINE COLD START RENDERS THE APP INSTEAD OF BOUNCING TO /login — THE PROBE
		// BELOW THEN REFRESHES (OR EXPLICITLY SIGNS OUT) WHEN THE NETWORK RETURNS.
		if (data.user === undefined) {
			void hydrateSession().finally(() => refreshUser().then(() => syncNow()));
		} else if (data.user) {
			refreshUser().then(() => syncNow());
		}
		// CAPACITOR NATIVE: BACK BUTTON, LIFECYCLE, KEYBOARD, STATUS BAR (NO-OP ON WEB).
		initNativeRuntime();
		return () => {
			unsubOnline();
		};
	});
</script>

<!-- GLOBAL TOAST HOST -->
<Toaster richColors closeButton position="bottom-right" />

<!-- OFFLINE BANNER — SHOWN ONLY WHILE THE NETWORK IS DOWN (NATIVE + WEB ALIKE) -->
<OfflineBanner />

<!-- THEMED APP ROOT — ONE THEME APPLIES TO EVERY PAGE (LIBRARY, READER, GLOSSARY) -->
<div class={cn('min-h-screen', rootClass)}>
	{#if nativeLanding}
		<!-- BLANK — THE LANDING PAGE MUST NOT SHOW IN THE NATIVE APP; THE GUARD ABOVE REDIRECTS TO /app/ -->
	{:else}
		<slot />
	{/if}
</div>
