<script lang="ts">
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
	// IMPORTED MODULES
	import { firebaseAuth } from '$lib/firebase';
	import { authErrorMessage, establishSession } from '$lib/auth-client';
	import { googleSignIn } from '$lib/google-auth';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import BookMarked from 'lucide-svelte/icons/book-marked';
	import Languages from 'lucide-svelte/icons/languages';
	import Volume2 from 'lucide-svelte/icons/volume-2';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';
	import Seal from '$lib/components/ui/Seal.svelte';

	// -- TYPES -- //

	type Benefit = { icon: typeof BookMarked; title: string; blurb: string };

	// -- CONSTANTS -- //

	// BRAND-PANEL BENEFIT BULLETS — THE SAME THREE PILLARS AS THE LANDING PAGE
	const BENEFITS: Benefit[] = [
		{
			icon: BookMarked,
			title: 'Your library, always synced',
			blurb: 'Upload EPUB or TXT, or paste a chapter link — build your shelf in seconds.',
		},
		{
			icon: Languages,
			title: 'A living glossary',
			blurb: 'Names, ranks, and realms locked in place so they never drift across chapters.',
		},
		{
			icon: Volume2,
			title: 'Read hands-free',
			blurb: 'Listen to any chapter, anywhere, in the voice you choose.',
		},
	];

	// -- STATES -- //

	let email = '';
	let password = '';
	// PER-BUTTON LOADING — ONLY THE BUTTON THAT WAS CLICKED SHOWS ITS SPINNER/LABEL. THE OTHER STAYS
	// IDLE (JUST DISABLED), SO THE TWO SIGN-UP PATHS ARE VISUALLY DISTINCT.
	let busyEmail = false;
	let busyGoogle = false;

	// ANY AUTH IN FLIGHT — DISABLES THE FIELDS + THE OTHER BUTTON (GUARDS DOUBLE-SUBMIT).
	$: busy = busyEmail || busyGoogle;

	// -- FUNCTIONS -- //

	async function signUpEmail() {
		if (busy || !email.trim() || !password) return;
		busyEmail = true;
		try {
			const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password);
			// FIRE THE VERIFICATION EMAIL, THEN START THE SESSION AND SEND THEM TO THE VERIFY NOTICE.
			await sendEmailVerification(cred.user).catch(() => {});
			await establishSession(cred, '/verify-email/');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Could not create your account.'));
		} finally {
			busyEmail = false;
		}
	}

	async function signInGoogle() {
		if (busy) return;
		busyGoogle = true;
		try {
			const cred = await googleSignIn();
			await establishSession(cred, '/app/');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Could not sign you up with Google.'));
		} finally {
			busyGoogle = false;
		}
	}
</script>

<svelte:head><title>Create account — Xianslate</title></svelte:head>

<!-- SPLIT AUTH SHELL — CINNABAR BRAND PANEL (DESKTOP) + THEME-SURFACE FORM COLUMN. THE FORM CARD STAYS
     TRANSLUCENT + dark:-DRIVEN (NOT $settings-DRIVEN) SO IT MATCHES THE SSR THEME WITH NO HYDRATION FLASH. -->
<div class="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
	<!-- BRAND PANEL — DESKTOP ONLY; THE MOBILE BAND INSIDE <main> CARRIES THE MARK BELOW lg -->
	<aside
		class="relative hidden flex-col justify-between overflow-hidden bg-[#b23a2e] px-10 py-12 text-[#f7efe0] lg:flex lg:min-h-screen lg:px-14 lg:py-14"
	>
		<!-- DECOR — RED-ON-RED GLOWS + A FAINT WATERMARK SEAL -->
		<div class="pointer-events-none absolute inset-0" aria-hidden="true">
			<div class="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#c0392b]/60 blur-3xl"></div>
			<div class="absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-[#8e2519]/70 blur-3xl"></div>
			<div class="absolute -bottom-14 -right-12 rotate-12 opacity-[0.08]"><Seal size={280} /></div>
		</div>

		<!-- WORDMARK — NEGATIVE SEAL (CREAM CHOP ON RED) SO THE MARK READS ON THE PANEL. CLICK → LANDING -->
		<a
			href="/"
			use:ripple
			class="relative flex w-fit items-center gap-2.5 rounded-lg transition-opacity hover:opacity-85"
		>
			<span
				class="inline-flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-[5px] bg-[#f7efe0] font-['LXGW_WenKai_TC'] font-bold leading-none text-[#b23a2e] shadow-sm"
				style="font-size:20px"
				aria-hidden="true">仙</span
			>
			<span class="text-lg font-bold tracking-tight">Xianslate</span>
		</a>

		<!-- PITCH — THE SAME BRAND LINE AS THE LANDING HERO, IN THE READER'S SERIF -->
		<div class="relative my-10 max-w-md">
			<h1 class="font-[Literata,Georgia,serif] text-[2rem] font-bold leading-[1.15] tracking-tight xl:text-4xl">
				Web novels that read like a real translation
			</h1>
			<p class="mt-4 text-sm leading-relaxed opacity-75">
				Xianslate re-tells Chinese, Japanese, and Korean web-novel raws as fluent, consistent prose — with a
				living glossary that keeps every name, rank, and realm in place.
			</p>
			<ul class="mt-9 space-y-4">
				{#each BENEFITS as { icon, title, blurb } (title)}
					<li class="flex items-start gap-3">
						<span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
							<svelte:component this={icon} size={17} />
						</span>
						<div>
							<p class="text-sm font-semibold">{title}</p>
							<p class="mt-0.5 text-[13px] leading-snug opacity-70">{blurb}</p>
						</div>
					</li>
				{/each}
			</ul>
		</div>

		<!-- FOOTNOTE -->
		<p class="relative text-xs opacity-70">Free to start · Read on any device · Private to you</p>
	</aside>

	<!-- FORM COLUMN -->
	<main class="relative isolate flex items-center justify-center px-4 py-10 lg:min-h-screen lg:px-10">
		<!-- AMBIENT GLOW (DECORATIVE) -->
		<div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
			<div
				class="absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-[#c0392b]/10 to-indigo-500/10 blur-3xl"
			></div>
		</div>

		<div class="w-full max-w-sm">
			<!-- MOBILE BRAND BAND — MARK + WORDMARK (CLICK → LANDING); THE DESKTOP PANEL ABOVE REPLACES THIS AT lg -->
			<a
				href="/"
				use:ripple
				class="mb-7 flex flex-col items-center gap-2.5 rounded-lg text-center transition-opacity hover:opacity-85 lg:hidden"
			>
				<div class="relative h-12 w-12">
					<div
						class="absolute inset-0 -z-10 rounded-xl bg-gradient-to-br from-[#c0392b]/40 to-indigo-500/40 blur-lg"
						aria-hidden="true"
					></div>
					<img src="/logo.svg" alt="" class="h-12 w-12 rounded-xl" />
				</div>
				<span class="text-lg font-bold tracking-tight">Xianslate</span>
			</a>

			<!-- CARD -->
			<div
				class="rounded-2xl border border-black/[0.08] bg-white/70 p-6 shadow-xl shadow-black/5 backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.04]"
			>
				<!-- HEADER -->
				<div class="mb-6 text-center">
					<h1 class="font-[Literata,Georgia,serif] text-2xl font-bold tracking-tight">Create your account</h1>
					<p class="mt-1.5 text-sm opacity-60">Your own private translated library.</p>
				</div>

				<!-- EMAIL / PASSWORD — outline-none + focus:ring IS THE SANCTIONED KEYBOARD-FOCUS PATTERN -->
				<form class="flex flex-col gap-4" on:submit|preventDefault={signUpEmail}>
					<label class="flex flex-col gap-1.5">
						<span class="text-xs font-medium opacity-70">Email</span>
						<input
							type="email"
							autocomplete="email"
							placeholder="you@example.com"
							bind:value={email}
							disabled={busy}
							class="rounded-lg border border-black/10 bg-transparent px-3 py-2.5 text-sm outline-none transition-colors placeholder:opacity-40 focus:border-[#b23a2e] focus:ring-2 focus:ring-[#b23a2e]/30 disabled:opacity-60 dark:border-white/[0.12]"
						/>
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="text-xs font-medium opacity-70">Password</span>
						<input
							type="password"
							autocomplete="new-password"
							placeholder="Password (8+ characters)"
							bind:value={password}
							disabled={busy}
							class="rounded-lg border border-black/10 bg-transparent px-3 py-2.5 text-sm outline-none transition-colors placeholder:opacity-40 focus:border-[#b23a2e] focus:ring-2 focus:ring-[#b23a2e]/30 disabled:opacity-60 dark:border-white/[0.12]"
						/>
						<span class="text-[11px] leading-snug opacity-45"
							>Use 8+ characters — a passphrase is best.</span
						>
					</label>
					<Button
						type="submit"
						variant="primary"
						loading={busyEmail}
						disabled={busy}
						class="mt-1 w-full py-2.5"
					>
						{#if busyEmail}Creating account…{:else}<UserPlus size={16} /> Create account{/if}
					</Button>
				</form>

				<!-- DIVIDER -->
				<div class="my-5 flex items-center gap-3 text-xs uppercase tracking-wider opacity-40">
					<span class="h-px flex-1 bg-current"></span>or<span class="h-px flex-1 bg-current"></span>
				</div>

				<!-- GOOGLE — REAL MULTI-COLOUR "G" MARK (INLINE SVG, BRAND COLOURS ARE FIXED, NOT THEME-DEPENDENT);
				     SWAPS TO A SPINNER + "Creating account…" WHILE AUTH IS IN FLIGHT -->
				<button
					use:ripple={{ disabled: busy }}
					disabled={busy}
					on:click={signInGoogle}
					class="flex w-full items-center justify-center gap-2.5 rounded-lg border border-black/10 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/[0.03] disabled:opacity-60 dark:border-white/[0.12] dark:hover:bg-white/[0.04]"
				>
					{#if busyGoogle}
						<Loader2 size={16} class="animate-spin" /> Creating account…
					{:else}
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
					{/if}
				</button>

				<!-- TRUST MICROCOPY -->
				<p class="mt-3 text-center text-[11px] leading-relaxed opacity-45">
					Your library is private to your account. We email a verification link after sign-up.
				</p>

				<!-- SIGN-IN LINK -->
				<p class="mt-4 text-center text-sm opacity-60">
					Already have an account?
					<a
						href="/login/"
						use:ripple
						class="rounded font-medium text-[#b23a2e] hover:underline dark:text-[#e08a63]">Sign in</a
					>
				</p>
			</div>
		</div>
	</main>
</div>
