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
		const user = firebaseAuth().currentUser;
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
		if (browser) email = firebaseAuth().currentUser?.email ?? '';
	});
</script>

<svelte:head><title>Verify your email — Xianslate</title></svelte:head>

<!-- VERIFY-EMAIL NOTICE — INHERITS THE PAGE SURFACE FROM THE LAYOUT ROOT (THEME_CLASS). THE CARD SURFACE STAYS
     TRANSLUCENT + dark:-DRIVEN (NOT $settings-DRIVEN) SO IT MATCHES THE SSR THEME WITH NO HYDRATION FLASH. -->
<div class="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4">
	<!-- AMBIENT GLOW (DECORATIVE) -->
	<div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
		<div
			class="absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-sky-500/15 to-indigo-500/15 blur-3xl"
		></div>
	</div>
	<div
		class="w-full max-w-sm rounded-2xl border border-black/[0.08] bg-white/70 p-6 text-center shadow-xl shadow-black/5 backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.04]"
	>
		<!-- MAIL ICON WITH A SOFT GLOW -->
		<div class="relative mx-auto mb-3 flex h-14 w-14 items-center justify-center">
			<div class="absolute inset-0 -z-10 rounded-full bg-sky-500/20 blur-lg" aria-hidden="true"></div>
			<div class="flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/10">
				<MailCheck size={28} class="text-sky-600 dark:text-sky-400" />
			</div>
		</div>
		<h1 class="text-xl font-bold">Check your inbox</h1>
		<p class="mt-2 text-sm opacity-70">
			We sent a verification link{#if email}
				to <span class="font-medium">{email}</span>{/if}. Verifying secures your account and lets us reach you
			about your library.
		</p>

		<!-- ACTIONS -->
		<div class="mt-6 flex flex-col gap-2">
			<a
				href="/app/"
				use:ripple
				class="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-sky-500 active:scale-[0.99]"
				>Continue to my library</a
			>
			<button
				use:ripple={{ disabled: busy }}
				disabled={busy}
				on:click={resend}
				class="rounded-lg border border-black/10 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/[0.03] dark:border-white/[0.12] dark:hover:bg-white/[0.04]"
				>Resend email</button
			>
			<a href="/logout/" use:ripple class="rounded-md py-1 text-xs opacity-60 hover:opacity-100">Sign out</a>
		</div>
	</div>
</div>
