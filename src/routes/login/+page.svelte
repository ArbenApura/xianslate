<script lang="ts">
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
	// IMPORTED MODULES
	import { page } from '$app/stores';
	import { firebaseAuth } from '$lib/firebase';
	import { authErrorMessage, establishSession } from '$lib/auth-client';
	import { googleSignIn } from '$lib/native-auth';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import LogIn from 'lucide-svelte/icons/log-in';

	// -- STATES -- //

	let email = '';
	let password = '';
	let busy = false;

	// -- REACTIVE STATES -- //

	// WHERE TO LAND AFTER SIGN-IN — THE GUARD IN hooks.server.ts PASSES ?redirect= WHEN IT BOUNCED A
	// PROTECTED PAGE; DEFAULT TO THE LIBRARY.
	$: redirectTo = $page.url.searchParams.get('redirect') || '/app/';
	// (redirectTo IS A FULL APP PATH FROM THE GUARD, ALREADY TRAILING-SLASH-NORMALISED, OR THE LIBRARY.)

	// -- FUNCTIONS -- //

	async function signInEmail() {
		if (busy || !email.trim() || !password) return;
		busy = true;
		try {
			const cred = await signInWithEmailAndPassword(firebaseAuth(), email.trim(), password);
			await establishSession(cred, redirectTo);
		} catch (e) {
			toast.error(authErrorMessage(e, 'Could not sign you in.'));
		} finally {
			busy = false;
		}
	}

	async function signInGoogle() {
		if (busy) return;
		busy = true;
		try {
			const cred = await googleSignIn();
			await establishSession(cred, redirectTo);
		} catch (e) {
			toast.error(authErrorMessage(e, 'Could not sign you in with Google.'));
		} finally {
			busy = false;
		}
	}

	async function resetPassword() {
		if (!email.trim()) {
			toast.error('Enter your email above first, then tap “Forgot password”.');
			return;
		}
		try {
			await sendPasswordResetEmail(firebaseAuth(), email.trim());
			toast.success('Password reset email sent — check your inbox.');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Could not send the reset email.'));
		}
	}
</script>

<svelte:head><title>Sign in — Xianslate</title></svelte:head>

<!-- CENTERED AUTH CARD — INHERITS THE PAGE SURFACE FROM THE LAYOUT ROOT (THEME_CLASS) -->
<div class="flex min-h-screen items-center justify-center px-4">
	<div
		class="w-full max-w-sm rounded-2xl border border-black/[0.08] bg-white/60 p-6 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]"
	>
		<!-- HEADER -->
		<div class="mb-6 text-center">
			<!-- BRAND MARK (static/logo.svg) -->
			<img src="/logo.svg" alt="" class="mx-auto mb-3 h-12 w-12 rounded-xl" />
			<h1 class="text-xl font-bold">Welcome back</h1>
			<p class="mt-1 text-sm opacity-60">Sign in to your Xianslate library.</p>
		</div>

		<!-- EMAIL / PASSWORD -->
		<form class="flex flex-col gap-3" on:submit|preventDefault={signInEmail}>
			<input
				type="email"
				autocomplete="email"
				placeholder="Email"
				bind:value={email}
				class="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/15"
			/>
			<input
				type="password"
				autocomplete="current-password"
				placeholder="Password"
				bind:value={password}
				class="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/15"
			/>
			<button
				type="submit"
				use:ripple={{ disabled: busy }}
				disabled={busy}
				class={cn(
					'mt-1 flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-opacity',
					busy && 'opacity-60',
				)}
			>
				<LogIn size={16} /> Sign in
			</button>
		</form>

		<!-- FORGOT PASSWORD -->
		<button
			use:ripple
			on:click={resetPassword}
			class="mt-2 w-full rounded-md py-1 text-xs opacity-60 hover:opacity-100">Forgot password?</button
		>

		<!-- DIVIDER -->
		<div class="my-4 flex items-center gap-3 text-xs opacity-40">
			<span class="h-px flex-1 bg-current"></span>or<span class="h-px flex-1 bg-current"></span>
		</div>

		<!-- GOOGLE -->
		<button
			use:ripple={{ disabled: busy }}
			disabled={busy}
			on:click={signInGoogle}
			class="flex w-full items-center justify-center gap-2 rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/15"
		>
			Continue with Google
		</button>

		<!-- SIGN-UP LINK -->
		<p class="mt-6 text-center text-sm opacity-60">
			New here?
			<a href="/signup/" use:ripple class="rounded font-medium text-sky-600 hover:underline dark:text-sky-400"
				>Create an account</a
			>
		</p>
	</div>
</div>
