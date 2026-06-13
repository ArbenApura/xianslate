<script lang="ts">
	// IMPORTED ASSETS
	import '../app.css';
	// IMPORTED DEP-TYPES
	import type { LayoutData } from './$types';
	// IMPORTED TYPES
	import type { Theme } from '$lib/stores/settings';
	// IMPORTED ENVS
	import { browser } from '$app/environment';
	// IMPORTED MODULES
	import { refreshUser, seedUser } from '$lib/stores/auth';
	import { settings, THEME_CLASS } from '$lib/stores/settings';
	import { cn } from '$lib/utils/cn';
	import { onMount } from 'svelte';
	// IMPORTED DEP-COMPONENTS
	import { Toaster } from 'svelte-sonner';

	// -- REQUIRED PROPS -- //

	export let data: LayoutData;

	// -- REACTIVE STATES -- //

	// SSR USES THE COOKIE THEME; THE CLIENT FOLLOWS THE STORE (BOTH AGREE → NO FLICKER)
	$: theme = (browser ? $settings.theme : (data.theme as Theme)) ?? 'sepia';
	$: rootClass = THEME_CLASS[theme] ?? THEME_CLASS.sepia;

	// -- REACTIVE STATEMENTS -- //

	// SEED THE auth STORE FROM SSR LAYOUT DATA ON EVERY NAVIGATION (WEB) — browser-GUARDED SO THE MODULE-LEVEL
	// STORE IS NEVER MUTATED DURING SSR (THAT WOULD LEAK BETWEEN REQUESTS). NO-OP ON NATIVE (data.user undefined).
	$: if (browser) seedUser(data.user);

	// -- LIFECYCLES -- //

	onMount(() => {
		// CONFIRM / FRESHEN THE SESSION FROM /api/me. ON NATIVE THIS IS THE ONLY SOURCE (NO SERVER LOAD); ON WEB
		// IT KEEPS THE STORE CURRENT AFTER A PROFILE EDIT. SKIP ONLY WHEN THE SERVER ALREADY SAID "SIGNED OUT".
		if (data.user === undefined || data.user) refreshUser();
	});
</script>

<!-- GLOBAL TOAST HOST -->
<Toaster richColors closeButton position="bottom-right" />

<!-- THEMED APP ROOT — ONE THEME APPLIES TO EVERY PAGE (LIBRARY, READER, GLOSSARY) -->
<div class={cn('min-h-screen', rootClass)}>
	<slot />
</div>
