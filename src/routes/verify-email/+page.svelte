<script lang="ts">
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { sendEmailVerification } from 'firebase/auth';
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { browser } from '$app/environment';
	import { firebaseAuth } from '$lib/firebase';
	import { authErrorMessage } from '$lib/auth-client';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import MailCheck from 'lucide-svelte/icons/mail-check';

	// -- STATES -- //

	let email = '';
	let busy = false;

	// -- FUNCTIONS -- //

	async function resend() {
		const user = firebaseAuth.currentUser;
		if (!user || busy) return;
		busy = true;
		try {
			await sendEmailVerification(user);
			toast.success('Verification email sent — check your inbox.');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Could not resend the verification email.'));
		} finally {
			busy = false;
		}
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		if (browser) email = firebaseAuth.currentUser?.email ?? '';
	});
</script>

<svelte:head><title>Verify your email — Xianslate</title></svelte:head>

<!-- VERIFY-EMAIL NOTICE — INHERITS THE PAGE SURFACE FROM THE LAYOUT ROOT (THEME_CLASS) -->
<div class="flex min-h-screen items-center justify-center px-4">
	<div
		class="w-full max-w-sm rounded-2xl border border-black/[0.08] bg-white/60 p-6 text-center shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]"
	>
		<MailCheck size={32} class="mx-auto mb-3 text-sky-600 dark:text-sky-400" />
		<h1 class="text-xl font-bold">Check your inbox</h1>
		<p class="mt-2 text-sm opacity-70">
			We sent a verification link{#if email} to <span class="font-medium">{email}</span>{/if}. Verifying secures your
			account and lets us reach you about your library.
		</p>

		<!-- ACTIONS -->
		<div class="mt-6 flex flex-col gap-2">
			<a
				href="/app/"
				use:ripple
				class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white">Continue to my library</a
			>
			<button
				use:ripple={{ disabled: busy }}
				disabled={busy}
				on:click={resend}
				class="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/15">Resend email</button
			>
			<a href="/logout/" use:ripple class="rounded-md py-1 text-xs opacity-60 hover:opacity-100">Sign out</a>
		</div>
	</div>
</div>
