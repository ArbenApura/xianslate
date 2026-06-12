<script lang="ts">
	// IMPORTED DEP-MODULES
	import { signOut } from 'firebase/auth';
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { apiFetch } from '$lib/api';
	import { firebaseAuth } from '$lib/firebase';

	// -- LIFECYCLES -- //

	// SIGN OUT BOTH SIDES: CLEAR THE SERVER SESSION COOKIE AND THE CLIENT FIREBASE SESSION, THEN GO TO /login.
	onMount(async () => {
		if (!browser) return;
		await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
		await signOut(firebaseAuth).catch(() => {});
		await goto('/login/');
	});
</script>

<svelte:head><title>Signing out… — Xianslate</title></svelte:head>

<!-- BRIEF NOTICE WHILE THE SIGN-OUT COMPLETES -->
<div class="flex min-h-screen items-center justify-center px-4">
	<p class="text-sm opacity-60">Signing you out…</p>
</div>
