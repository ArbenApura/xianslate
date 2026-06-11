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
	import { settings, THEME_CLASS } from '$lib/stores/settings';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import { Toaster } from 'svelte-sonner';

	// -- REQUIRED PROPS -- //

	export let data: LayoutData;

	// -- REACTIVE STATES -- //

	// SSR USES THE COOKIE THEME; THE CLIENT FOLLOWS THE STORE (BOTH AGREE → NO FLICKER)
	$: theme = (browser ? $settings.theme : (data.theme as Theme)) ?? 'sepia';
	$: rootClass = THEME_CLASS[theme] ?? THEME_CLASS.sepia;
</script>

<!-- GLOBAL TOAST HOST -->
<Toaster richColors closeButton position="bottom-right" />

<!-- THEMED APP ROOT — ONE THEME APPLIES TO EVERY PAGE (LIBRARY, READER, GLOSSARY) -->
<div class={cn('min-h-screen', rootClass)}>
	<slot />
</div>
