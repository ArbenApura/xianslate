<script lang="ts">
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
	// IMPORTED MODULES
	import { firebaseAuth } from '$lib/firebase';
	import { authErrorMessage, establishSession } from '$lib/auth-client';
	import { googleSignIn } from '$lib/native-auth';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import UserPlus from 'lucide-svelte/icons/user-plus';

	// -- STATES -- //

	let email = '';
	let password = '';
	let busy = false;

	// -- FUNCTIONS -- //

	async function signUpEmail() {
		if (busy || !email.trim() || !password) return;
		busy = true;
		try {
			const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password);
			// FIRE THE VERIFICATION EMAIL, THEN START THE SESSION AND SEND THEM TO THE VERIFY NOTICE.
			await sendEmailVerification(cred.user).catch(() => {});
			await establishSession(cred, '/verify-email/');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Could not create your account.'));
		} finally {
			busy = false;
		}
	}

	async function signInGoogle() {
		if (busy) return;
		busy = true;
		try {
			const cred = await googleSignIn();
			await establishSession(cred, '/app/');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Could not sign you up with Google.'));
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Create account — Xianslate</title></svelte:head>

<!-- CENTERED AUTH CARD — INHERITS THE PAGE SURFACE FROM THE LAYOUT ROOT (THEME_CLASS) -->
<div class="flex min-h-screen items-center justify-center px-4">
	<div
		class="w-full max-w-sm rounded-2xl border border-black/[0.08] bg-white/60 p-6 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]"
	>
		<!-- HEADER -->
		<div class="mb-6 text-center">
			<!-- BRAND MARK (static/logo.svg) -->
			<img src="/logo.svg" alt="" class="mx-auto mb-3 h-12 w-12 rounded-xl" />
			<h1 class="text-xl font-bold">Create your account</h1>
			<p class="mt-1 text-sm opacity-60">Your own private translated library.</p>
		</div>

		<!-- EMAIL / PASSWORD -->
		<form class="flex flex-col gap-3" on:submit|preventDefault={signUpEmail}>
			<input
				type="email"
				autocomplete="email"
				placeholder="Email"
				bind:value={email}
				class="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-white/15"
			/>
			<input
				type="password"
				autocomplete="new-password"
				placeholder="Password (8+ characters)"
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
				<UserPlus size={16} /> Create account
			</button>
		</form>

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

		<!-- SIGN-IN LINK -->
		<p class="mt-6 text-center text-sm opacity-60">
			Already have an account?
			<a href="/login/" use:ripple class="rounded font-medium text-sky-600 hover:underline dark:text-sky-400"
				>Sign in</a
			>
		</p>
	</div>
</div>
