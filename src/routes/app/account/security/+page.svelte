<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { User } from 'firebase/auth';
	// IMPORTED TYPES
	import type { SessionUser } from '$lib/stores/auth';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail } from 'firebase/auth';
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authErrorMessage } from '$lib/auth-client';
	import { currentUser, signOutEverywhere } from '$lib/stores/auth';
	import { firebaseAuth } from '$lib/firebase';
	import { clearUserData } from '$lib/offline/db';
	import { persistSessionUser } from '$lib/offline/session';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import BadgeCheck from 'lucide-svelte/icons/badge-check';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import LogOut from 'lucide-svelte/icons/log-out';
	import Mail from 'lucide-svelte/icons/mail';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import TextField from '$lib/components/ui/TextField.svelte';

	// -- CONSTANTS -- //

	const CARD = 'rounded-2xl border border-black/10 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]';
	// SLATE MUTED-TEXT TOKEN — MATCHES THE ADMIN CONSOLE SO THE TWO SURFACES READ AS ONE APP.
	const MUTED = 'text-slate-500 dark:text-slate-400';

	// -- STATES -- //

	// THE LIVE FIREBASE CLIENT USER (RESTORED ASYNC AFTER HYDRATION) — REQUIRED FOR EMAIL MUTATIONS.
	let fbUser: User | null = null;
	let sendingVerify = false;
	let sendingReset = false;
	let showDelete = false;
	let deleteConfirm = '';
	let deleting = false;

	// -- REACTIVE STATES -- //

	// CLIENT STORE IS AUTHORITATIVE; $page.data.user IS THE SSR SEED FOR FIRST PAINT.
	$: user = ($currentUser ?? $page.data.user ?? null) as SessionUser | null;
	$: uid = user?.id ?? null;
	$: providerLabel = providerLabelOf(fbUser);

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
			// WIPE THE DELETED ACCOUNT'S OFFLINE CACHE + PENDING QUEUE (ITS SERVER DATA IS CASCADED AWAY).
			if (uid) void clearUserData(uid).finally(() => persistSessionUser(null));
			toast.success('Your account has been deleted.');
			await goto('/');
		} catch {
			toast.error('Couldn’t delete your account. Please try again.');
			deleting = false;
		}
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		// TRACK THE RESTORED FIREBASE CLIENT USER — EMAIL ACTIONS NEED IT, AND IT ARRIVES ASYNC.
		return onAuthStateChanged(firebaseAuth(), (u) => {
			fbUser = u;
		});
	});
</script>

<!-- SIGN-IN & SECURITY -->
{#if user}
	<div class="flex flex-col gap-5">
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
				<Button size="sm" loading={sendingReset} disabled={sendingReset} on:click={resetPassword}>
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
			<h2 class="flex items-center gap-2 text-[15px] font-semibold text-red-600 dark:text-red-400">
				<TriangleAlert size={16} /> Danger zone
			</h2>
			<p class="mt-1 text-[13px] opacity-70">
				Deleting your account permanently removes your library — every book, chapter, translation, and glossary
				term. This can’t be undone.
			</p>
			<div class="mt-4">
				<Button variant="danger" on:click={() => ((showDelete = true), (deleteConfirm = ''))}>
					<Trash2 size={15} /> Delete account
				</Button>
			</div>
		</section>
	</div>
{/if}

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
