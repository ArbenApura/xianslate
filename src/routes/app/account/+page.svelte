<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { ComponentType } from 'svelte';
	import type { User } from 'firebase/auth';
	// IMPORTED TYPES
	import type { SessionUser } from '$lib/stores/auth';
	import type { Theme } from '$lib/stores/settings';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authErrorMessage } from '$lib/auth-client';
	import { currentUser, refreshUser, signOutEverywhere } from '$lib/stores/auth';
	import { firebaseAuth } from '$lib/firebase';
	import { languageName } from '$lib/languages';
	import { settings, TRANSLATION_MODELS } from '$lib/stores/settings';
	import { ripple } from '$lib/actions/ripple';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import BadgeCheck from 'lucide-svelte/icons/badge-check';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import Languages from 'lucide-svelte/icons/languages';
	import LogOut from 'lucide-svelte/icons/log-out';
	import Mail from 'lucide-svelte/icons/mail';
	import Palette from 'lucide-svelte/icons/palette';
	import Shield from 'lucide-svelte/icons/shield';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import UserRound from 'lucide-svelte/icons/user-round';
	// IMPORTED COMPONENTS
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import LanguagePicker from '$lib/components/ui/LanguagePicker.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import TextField from '$lib/components/ui/TextField.svelte';

	// -- TYPES -- //

	// THE ACCOUNT SECTIONS — SWITCHED CLIENT-SIDE FROM THE SIDEBAR (NO ROUTE CHANGE), SO THE SHARED FIREBASE
	// USER + MUTATIONS STAY IN ONE COMPONENT.
	type Section = 'profile' | 'appearance' | 'security';

	// -- CONSTANTS -- //

	// THE SIDEBAR NAV. icon IS A lucide COMPONENT RENDERED VIA <svelte:component>.
	const NAV: { id: Section; label: string; desc: string; icon: ComponentType; tint: string }[] = [
		{
			id: 'profile',
			label: 'Profile',
			desc: 'Your identity and how you appear.',
			icon: UserRound,
			tint: 'bg-[#c0392b]/10 text-[#b23a2e] dark:text-[#e08a63]',
		},
		{
			id: 'appearance',
			label: 'Appearance',
			desc: 'Theme, language, and translation model.',
			icon: Palette,
			tint: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
		},
		{
			id: 'security',
			label: 'Security',
			desc: 'Sign-in, verification, and your account.',
			icon: Shield,
			tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
		},
	];
	// THE FIVE APP THEMES + A REPRESENTATIVE SWATCH (COMPLETE LITERAL bg-[#HEX]/bg-black CLASSES — MIRRORS
	// THE THEME_BG MAP IN $lib/stores/settings; KEPT LITERAL SO cn()/TAILWIND CAN SEE THEM).
	const THEMES: { id: Theme; label: string; swatch: string }[] = [
		{ id: 'light', label: 'Light', swatch: 'bg-[#fbfaf7]' },
		{ id: 'sepia', label: 'Sepia', swatch: 'bg-[#f4ecd8]' },
		{ id: 'dark', label: 'Dark', swatch: 'bg-[#0e131c]' },
		{ id: 'oled', label: 'OLED', swatch: 'bg-black' },
		{ id: 'contrast', label: 'Contrast', swatch: 'bg-black' },
	];
	const CARD = 'rounded-2xl border border-black/10 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]';
	// SLATE MUTED-TEXT TOKEN — MATCHES THE ADMIN CONSOLE SO THE TWO SURFACES READ AS ONE APP.
	const MUTED = 'text-slate-500 dark:text-slate-400';

	// -- STATES -- //

	// THE ACTIVE SIDEBAR SECTION.
	let section: Section = 'profile';
	// THE LIVE FIREBASE CLIENT USER (RESTORED ASYNC AFTER HYDRATION) — REQUIRED FOR PROFILE / EMAIL MUTATIONS.
	let fbUser: User | null = null;
	let newName = '';
	let nameSeeded = false;
	let savingName = false;
	let sendingVerify = false;
	let sendingReset = false;
	let showDelete = false;
	let deleteConfirm = '';
	let deleting = false;

	// -- REACTIVE STATES -- //

	// CLIENT STORE IS AUTHORITATIVE; $page.data.user IS THE SSR SEED FOR FIRST PAINT.
	$: user = ($currentUser ?? $page.data.user ?? null) as SessionUser | null;
	$: label = user?.name?.trim() || user?.email || 'Account';
	$: providerLabel = providerLabelOf(fbUser);
	$: joined = user
		? new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
		: '';
	$: nameDirty = !!user && newName.trim() !== (user.name ?? '').trim() && newName.trim().length > 0;
	// THE ACTIVE SIDEBAR SECTION'S METADATA — DRIVES THE CONTENT HEADER (ICON / TITLE / DESCRIPTION).
	$: active = NAV.find((n) => n.id === section) ?? NAV[0];

	// -- REACTIVE STATEMENTS -- //

	// SEED THE EDITABLE NAME FIELD ONCE THE USER IS KNOWN (CLIENT-SIDE — NOT DURING SSR).
	$: if (!nameSeeded && user) {
		newName = user.name ?? '';
		nameSeeded = true;
	}

	// -- FUNCTIONS -- //

	// HUMAN LABEL FOR THE SIGN-IN METHOD (FROM FIREBASE providerData) — SHOWN SO THE USER KNOWS WHETHER A
	// PASSWORD RESET EVEN APPLIES TO THEM.
	function providerLabelOf(u: User | null): string {
		const id = u?.providerData?.[0]?.providerId ?? '';
		if (id === 'google.com') return 'Google';
		if (id === 'password') return 'Email & password';
		if (id === 'apple.com') return 'Apple';
		return id || '—';
	}

	// UPDATE THE FIREBASE displayName, FORCE-REFRESH THE ID TOKEN (SO IT CARRIES THE NEW NAME), THEN RE-MINT
	// THE SESSION COOKIE — OTHERWISE THE PER-REQUEST upsert WOULD SYNC THE DB BACK TO THE OLD TOKEN NAME.
	async function saveName() {
		const fb = fbUser;
		const name = newName.trim();
		if (!fb || savingName || !nameDirty) return;
		savingName = true;
		try {
			await updateProfile(fb, { displayName: name });
			const idToken = await fb.getIdToken(true);
			await apiFetch('/api/auth/session', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ idToken }),
			});
			await refreshUser();
			toast.success('Display name updated!');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Couldn’t update your display name. Try again.'));
		} finally {
			savingName = false;
		}
	}

	async function resendVerification() {
		const fb = fbUser;
		if (!fb || sendingVerify) return;
		sendingVerify = true;
		try {
			await sendEmailVerification(fb);
			toast.success('Verification email sent — check your inbox.');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Couldn’t send the verification email.'));
		} finally {
			sendingVerify = false;
		}
	}

	async function resetPassword() {
		const email = user?.email;
		if (!email || sendingReset) return;
		sendingReset = true;
		try {
			await sendPasswordResetEmail(firebaseAuth(), email);
			toast.success('Password reset email sent — check your inbox.');
		} catch (e) {
			toast.error(authErrorMessage(e, 'Couldn’t send the reset email.'));
		} finally {
			sendingReset = false;
		}
	}

	function setTheme(t: Theme) {
		settings.update((s) => ({ ...s, theme: t }));
	}

	function setDefaultLang(code: string) {
		settings.update((s) => ({ ...s, newBookTargetLang: code }));
	}

	function setModel(id: string) {
		settings.update((s) => ({ ...s, model: id }));
	}

	// IRREVERSIBLE: REMOVES THE ACCOUNT + ENTIRE LIBRARY (SERVER CASCADE) AND THE FIREBASE USER, THEN LANDS
	// ON THE LANDING PAGE. GUARDED BY A TYPED "DELETE" CONFIRMATION.
	async function confirmDelete() {
		if (deleteConfirm.trim().toUpperCase() !== 'DELETE' || deleting) return;
		deleting = true;
		try {
			const res = await apiFetch('/api/me', { method: 'DELETE' });
			if (!res.ok) throw new Error('delete failed');
			try {
				await firebaseAuth().signOut();
			} catch {
				// IGNORE — THE SERVER-SIDE ACCOUNT IS ALREADY GONE.
			}
			currentUser.set(null);
			toast.success('Your account has been deleted.');
			await goto('/');
		} catch {
			toast.error('Couldn’t delete your account. Please try again.');
			deleting = false;
		}
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		// TRACK THE RESTORED FIREBASE CLIENT USER — PROFILE / EMAIL ACTIONS NEED IT, AND IT ARRIVES ASYNC.
		return onAuthStateChanged(firebaseAuth(), (u) => {
			fbUser = u;
		});
	});
</script>

<svelte:head><title>Account · Xianslate</title></svelte:head>

<!-- ACCOUNT MANAGEMENT — INHERITS THE PAGE SURFACE FROM THE LAYOUT ROOT (THEME_CLASS) -->
<div class="mx-auto max-w-5xl px-4 py-6 sm:py-8">
	{#if !user}
		<!-- NO SESSION (SHOULDN'T HAPPEN BEHIND THE GUARD, BUT KEEPS THE PAGE ROBUST) -->
		<header class="mb-6 flex items-center gap-3">
			<a
				href="/app/"
				class="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
				aria-label="Back to library"
				use:ripple
			>
				<ArrowLeft size={20} />
			</a>
			<h1 class="text-xl font-semibold">Account</h1>
		</header>
		<div class={cn(CARD, 'text-center text-sm opacity-60')}>
			You’re signed out. <a href="/login/" class="text-[#b23a2e] hover:underline dark:text-[#e08a63]" use:ripple
				>Sign in</a
			> to manage your account.
		</div>
	{:else}
		<!-- SIDEBAR SHELL: VERTICAL NAV ON DESKTOP, HORIZONTAL SEGMENTED TABS ON MOBILE -->
		<div class="lg:flex lg:gap-7">
			<!-- DESKTOP SIDEBAR -->
			<aside class="hidden lg:sticky lg:top-8 lg:block lg:h-fit lg:w-56 lg:shrink-0">
				<!-- BACK + TITLE -->
				<div class="mb-4 flex items-center gap-2">
					<a
						href="/app/"
						use:ripple
						aria-label="Back to library"
						class="-ml-1 rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
					>
						<ArrowLeft size={20} />
					</a>
					<h1 class="text-xl font-semibold">Account</h1>
				</div>
				<!-- VERTICAL NAV -->
				<nav class="flex flex-col gap-1">
					{#each NAV as item (item.id)}
						<button
							use:ripple
							on:click={() => (section = item.id)}
							aria-current={section === item.id ? 'page' : undefined}
							class={cn(
								'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
								section === item.id
									? 'bg-[#c0392b]/10 font-medium text-[#b23a2e] dark:text-[#e08a63]'
									: cn('hover:bg-black/[0.04] dark:hover:bg-white/[0.06]', MUTED),
							)}
						>
							<svelte:component this={item.icon} size={18} />
							{item.label}
						</button>
					{/each}
				</nav>
			</aside>

			<!-- CONTENT: ONE SECTION AT A TIME -->
			<div class="min-w-0 flex-1">
				<!-- MOBILE TOP BAR (BACK + TITLE) -->
				<div class="mb-3 flex items-center gap-2 lg:hidden">
					<a
						href="/app/"
						use:ripple
						aria-label="Back to library"
						class="-ml-1 rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
					>
						<ArrowLeft size={20} />
					</a>
					<h1 class="text-xl font-semibold">Account</h1>
				</div>
				<!-- MOBILE SEGMENTED TAB BAR — 3 EQUAL COLUMNS, ICON OVER LABEL (NO HORIZONTAL SCROLL) -->
				<nav
					class="mb-5 grid grid-cols-3 gap-1 rounded-xl border border-black/10 bg-black/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04] lg:hidden"
				>
					{#each NAV as item (item.id)}
						<button
							use:ripple
							on:click={() => (section = item.id)}
							aria-current={section === item.id ? 'page' : undefined}
							class={cn(
								'flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center text-[11px] font-medium leading-tight transition-colors',
								section === item.id
									? 'bg-white text-[#b23a2e] shadow-sm dark:bg-white/10 dark:text-[#e08a63]'
									: cn('hover:bg-black/[0.03] dark:hover:bg-white/[0.05]', MUTED),
							)}
						>
							<svelte:component this={item.icon} size={18} />
							{item.label}
						</button>
					{/each}
				</nav>
				<!-- SECTION HEADER — ICON CHIP, TITLE + DESCRIPTION -->
				<header class="mb-5 flex items-center gap-3">
					<span class={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', active.tint)}>
						<svelte:component this={active.icon} size={22} />
					</span>
					<div class="min-w-0 flex-1">
						<h2 class="text-xl font-semibold">{active.label}</h2>
						<p class={cn('truncate text-[13px]', MUTED)}>{active.desc}</p>
					</div>
				</header>

				{#if section === 'profile'}
					<!-- PROFILE -->
					<section class={CARD}>
						<div class="flex items-center gap-4">
							<!-- AVATAR (PHOTO OR GRADIENT INITIALS) -->
							<Avatar name={label} src={user.avatarUrl ?? null} size={64} class="shrink-0" />
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<h2 class="truncate text-lg font-semibold">{label}</h2>
									{#if user.role === 'admin'}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
											><Shield size={11} /> Admin</span
										>
									{/if}
								</div>
								<p class={cn('mt-0.5 truncate text-sm', MUTED)}>{user.email}</p>
								<p class="mt-0.5 text-xs opacity-50">Member since {joined}</p>
							</div>
						</div>

						<!-- EDIT DISPLAY NAME -->
						<form
							class="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end"
							on:submit|preventDefault={saveName}
						>
							<div class="min-w-0 flex-1">
								<TextField bind:value={newName} label="Display name" placeholder="Your name" />
							</div>
							<Button
								type="submit"
								variant="primary"
								loading={savingName}
								disabled={savingName || !nameDirty || !fbUser}
							>
								Save
							</Button>
						</form>
					</section>
				{:else if section === 'appearance'}
					<!-- APPEARANCE & READING PREFERENCES -->
					<section class={CARD}>
						<!-- THEME -->
						<span class={cn('mb-2 block text-xs font-medium', MUTED)}>Theme</span>
						<div class="flex flex-wrap gap-2">
							{#each THEMES as t (t.id)}
								<button
									use:ripple
									on:click={() => setTheme(t.id)}
									class={cn(
										'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
										$settings.theme === t.id
											? 'border-[#c0392b] ring-1 ring-[#c0392b]'
											: 'border-black/10 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20',
									)}
								>
									<span
										class={cn(
											'h-4 w-4 rounded-full border border-black/10 dark:border-white/20',
											t.swatch,
										)}
									></span>
									{t.label}
								</button>
							{/each}
						</div>

						<!-- DEFAULT TRANSLATION LANGUAGE -->
						<div class="mt-5">
							<span class={cn('mb-2 flex items-center gap-1.5 text-xs font-medium', MUTED)}
								><Languages size={13} /> Default translation language</span
							>
							<LanguagePicker
								value={$settings.newBookTargetLang}
								allowNone={false}
								on:change={(e) => setDefaultLang(e.detail)}
							/>
							<p class="mt-1.5 text-xs opacity-50">
								New books translate into {languageName($settings.newBookTargetLang)} unless you pick otherwise.
							</p>
						</div>

						<!-- TRANSLATION MODEL -->
						<div class="mt-5">
							<span class={cn('mb-2 flex items-center gap-1.5 text-xs font-medium', MUTED)}
								><Sparkles size={13} /> Translation model</span
							>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each TRANSLATION_MODELS as m (m.id)}
									<button
										use:ripple
										on:click={() => setModel(m.id)}
										class={cn(
											'flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
											$settings.model === m.id
												? 'border-[#c0392b] ring-1 ring-[#c0392b]'
												: 'border-black/10 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20',
										)}
									>
										<span class="text-sm font-medium">{m.label}</span>
										<span class={cn('text-xs', MUTED)}>{m.blurb}</span>
									</button>
								{/each}
							</div>
						</div>
					</section>
				{:else if section === 'security'}
					<div class="flex flex-col gap-5">
						<!-- SIGN-IN & SECURITY -->
						<section class={CARD}>
							<h2 class="mb-1 flex items-center gap-2 text-[15px] font-semibold">
								<Mail size={16} /> Sign-in
							</h2>
							<p class={cn('mb-4 text-[13px]', MUTED)}>
								Signed in with <span class="font-medium">{providerLabel}</span>.
							</p>

							<!-- EMAIL VERIFICATION STATUS -->
							<div
								class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 p-3 dark:border-white/10"
							>
								<div class="flex items-center gap-2 text-sm">
									{#if user.emailVerified}
										<BadgeCheck size={18} class="text-emerald-500" />
										<span>Email verified</span>
									{:else}
										<TriangleAlert size={18} class="text-amber-500" />
										<span>Email not verified</span>
									{/if}
								</div>
								{#if !user.emailVerified}
									<Button
										size="sm"
										loading={sendingVerify}
										disabled={sendingVerify || !fbUser}
										on:click={resendVerification}
									>
										Resend verification
									</Button>
								{/if}
							</div>

							<!-- PASSWORD RESET -->
							<div
								class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 p-3 dark:border-white/10"
							>
								<div class="flex items-center gap-2 text-sm">
									<KeyRound size={18} class={MUTED} />
									<span>Password</span>
								</div>
								<Button
									size="sm"
									loading={sendingReset}
									disabled={sendingReset}
									on:click={resetPassword}
								>
									Send reset email
								</Button>
							</div>
						</section>

						<!-- SESSION -->
						<section class={CARD}>
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div>
									<h2 class="text-[15px] font-semibold">Session</h2>
									<p class={cn('text-[13px]', MUTED)}>Sign out of Xianslate on this device.</p>
								</div>
								<Button on:click={() => signOutEverywhere()}><LogOut size={15} /> Sign out</Button>
							</div>
						</section>

						<!-- DANGER ZONE -->
						<section class="rounded-2xl border border-red-500/30 bg-red-500/[0.03] p-5">
							<h2
								class="flex items-center gap-2 text-[15px] font-semibold text-red-600 dark:text-red-400"
							>
								<TriangleAlert size={16} /> Danger zone
							</h2>
							<p class="mt-1 text-[13px] opacity-70">
								Deleting your account permanently removes your library — every book, chapter,
								translation, and glossary term. This can’t be undone.
							</p>
							<div class="mt-4">
								<Button variant="danger" on:click={() => ((showDelete = true), (deleteConfirm = ''))}>
									<Trash2 size={15} /> Delete account
								</Button>
							</div>
						</section>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- DELETE ACCOUNT — TYPED CONFIRMATION (ConfirmDialog HAS NO TEXT INPUT, SO THIS USES A Modal) -->
<Modal open={showDelete} title="Delete account" size="sm" on:close={() => (showDelete = false)}>
	<div class="flex flex-col gap-4">
		<p class="text-sm opacity-70">
			This permanently deletes your account and your entire library. Type <span class="font-semibold">DELETE</span
			> to confirm.
		</p>
		<TextField bind:value={deleteConfirm} placeholder="DELETE" />
	</div>
	<svelte:fragment slot="footer">
		<Button on:click={() => (showDelete = false)} disabled={deleting}>Cancel</Button>
		<Button
			variant="danger"
			loading={deleting}
			disabled={deleting || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
			on:click={confirmDelete}
			class="bg-red-600 text-white hover:bg-red-500"
		>
			<Trash2 size={15} /> Delete forever
		</Button>
	</svelte:fragment>
</Modal>
