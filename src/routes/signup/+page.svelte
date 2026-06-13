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

<!-- CENTERED AUTH CARD — INHERITS THE PAGE SURFACE FROM THE LAYOUT ROOT (THEME_CLASS). THE CARD SURFACE STAYS
     TRANSLUCENT + dark:-DRIVEN (NOT $settings-DRIVEN) SO IT MATCHES THE SSR THEME WITH NO HYDRATION FLASH. -->
<div class="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4">
	<!-- AMBIENT GLOW (DECORATIVE) -->
	<div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
		<div
			class="absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-sky-500/15 to-indigo-500/15 blur-3xl"
		></div>
	</div>
	<div
		class="w-full max-w-sm rounded-2xl border border-black/[0.08] bg-white/70 p-6 shadow-xl shadow-black/5 backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.04]"
	>
		<!-- HEADER -->
		<div class="mb-6 text-center">
			<!-- BRAND MARK (static/logo.svg) WITH A SOFT GLOW -->
			<div class="relative mx-auto mb-3 h-12 w-12">
				<div
					class="absolute inset-0 -z-10 rounded-xl bg-gradient-to-br from-sky-500/40 to-indigo-500/40 blur-lg"
					aria-hidden="true"
				></div>
				<img src="/logo.svg" alt="" class="h-12 w-12 rounded-xl" />
			</div>
			<h1 class="text-xl font-bold">Create your account</h1>
			<p class="mt-1 text-sm opacity-60">Your own private translated library.</p>
		</div>

		<!-- EMAIL / PASSWORD — outline-none + focus:ring IS THE SANCTIONED KEYBOARD-FOCUS PATTERN -->
		<form class="flex flex-col gap-3" on:submit|preventDefault={signUpEmail}>
			<input
				type="email"
				autocomplete="email"
				placeholder="Email"
				bind:value={email}
				class="rounded-lg border border-black/10 bg-transparent px-3 py-2.5 text-sm outline-none transition-colors placeholder:opacity-40 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:border-white/[0.12]"
			/>
			<input
				type="password"
				autocomplete="new-password"
				placeholder="Password (8+ characters)"
				bind:value={password}
				class="rounded-lg border border-black/10 bg-transparent px-3 py-2.5 text-sm outline-none transition-colors placeholder:opacity-40 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:border-white/[0.12]"
			/>
			<button
				type="submit"
				use:ripple={{ disabled: busy }}
				disabled={busy}
				class={cn(
					'mt-1 flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-sky-500 active:scale-[0.99]',
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

		<!-- GOOGLE — REAL MULTI-COLOUR "G" MARK (INLINE SVG, BRAND COLOURS ARE FIXED, NOT THEME-DEPENDENT) -->
		<button
			use:ripple={{ disabled: busy }}
			disabled={busy}
			on:click={signInGoogle}
			class="flex w-full items-center justify-center gap-2.5 rounded-lg border border-black/10 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/[0.03] dark:border-white/[0.12] dark:hover:bg-white/[0.04]"
		>
			<svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" aria-hidden="true">
				<path
					fill="#4285F4"
					d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
				/>
				<path
					fill="#34A853"
					d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
				/>
				<path
					fill="#FBBC05"
					d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
				/>
				<path
					fill="#EA4335"
					d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
				/>
			</svg>
			Continue with Google
		</button>

		<!-- TRUST MICROCOPY -->
		<p class="mt-4 text-center text-[11px] leading-relaxed opacity-45">
			Your library is private to your account. We email a verification link after sign-up.
		</p>

		<!-- SIGN-IN LINK -->
		<p class="mt-4 text-center text-sm opacity-60">
			Already have an account?
			<a href="/login/" use:ripple class="rounded font-medium text-sky-600 hover:underline dark:text-sky-400"
				>Sign in</a
			>
		</p>
	</div>
</div>
