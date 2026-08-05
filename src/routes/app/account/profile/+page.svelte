<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { User } from 'firebase/auth';
	// IMPORTED TYPES
	import type { SessionUser } from '$lib/stores/auth';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onAuthStateChanged, updateProfile } from 'firebase/auth';
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { page } from '$app/stores';
	import { authErrorMessage } from '$lib/auth-client';
	import { currentUser, refreshUser } from '$lib/stores/auth';
	import { firebaseAuth } from '$lib/firebase';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import Shield from 'lucide-svelte/icons/shield';
	// IMPORTED COMPONENTS
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import TextField from '$lib/components/ui/TextField.svelte';

	// -- CONSTANTS -- //

	const CARD = 'rounded-2xl border border-black/10 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]';
	const MUTED = 'text-slate-500 dark:text-slate-400';

	// -- STATES -- //

	// THE LIVE FIREBASE CLIENT USER (RESTORED ASYNC AFTER HYDRATION) — REQUIRED FOR displayName MUTATIONS.
	let fbUser: User | null = null;
	let newName = '';
	let nameSeeded = false;
	let savingName = false;

	// -- REACTIVE STATES -- //

	// CLIENT STORE IS AUTHORITATIVE; $page.data.user IS THE SSR SEED FOR FIRST PAINT.
	$: user = ($currentUser ?? $page.data.user ?? null) as SessionUser | null;
	$: label = user?.name?.trim() || user?.email || 'Account';
	$: joined = user
		? new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
		: '';
	$: nameDirty = !!user && newName.trim() !== (user.name ?? '').trim() && newName.trim().length > 0;

	// -- REACTIVE STATEMENTS -- //

	// SEED THE EDITABLE NAME FIELD ONCE THE USER IS KNOWN (CLIENT-SIDE — NOT DURING SSR).
	$: if (!nameSeeded && user) {
		newName = user.name ?? '';
		nameSeeded = true;
	}

	// -- FUNCTIONS -- //

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

	// -- LIFECYCLES -- //

	onMount(() => {
		// TRACK THE RESTORED FIREBASE CLIENT USER — PROFILE ACTIONS NEED IT, AND IT ARRIVES ASYNC.
		return onAuthStateChanged(firebaseAuth(), (u) => {
			fbUser = u;
		});
	});
</script>

<!-- PROFILE — IDENTITY, AVATAR, AND THE DISPLAY NAME -->
{#if user}
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
		<form class="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end" on:submit|preventDefault={saveName}>
			<div class="min-w-0 flex-1">
				<TextField bind:value={newName} label="Display name" placeholder="Your name" />
			</div>
			<Button type="submit" variant="primary" loading={savingName} disabled={savingName || !nameDirty || !fbUser}>
				Save
			</Button>
		</form>
	</section>
{/if}
