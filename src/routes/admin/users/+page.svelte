<script lang="ts">
	// IMPORTED TYPES
	import type { AdminUser } from '$lib/types';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { currentUser, isAdmin } from '$lib/stores/auth';
	import { ripple } from '$lib/actions/ripple';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import BadgeCheck from 'lucide-svelte/icons/badge-check';
	import Search from 'lucide-svelte/icons/search';
	import Shield from 'lucide-svelte/icons/shield';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

	// -- CONSTANTS -- //

	const CARD = 'rounded-xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]';
	const MUTED = 'text-slate-500 dark:text-slate-400';
	const AVATARS = [
		'from-rose-500 to-orange-400',
		'from-sky-500 to-indigo-600',
		'from-emerald-500 to-teal-600',
		'from-violet-500 to-fuchsia-600',
		'from-amber-500 to-red-500',
		'from-cyan-500 to-blue-600',
	];

	// -- STATES -- //

	let users: AdminUser[] = [];
	let loading = true;
	let errMsg = '';
	let search = '';
	let busyId: string | null = null;
	// THE PENDING ROLE CHANGE AWAITING CONFIRMATION.
	let pending: { user: AdminUser; role: 'user' | 'admin' } | null = null;

	// -- REACTIVE STATES -- //

	$: meId = $currentUser?.id ?? '';
	$: q = search.trim().toLowerCase();
	$: filtered = q ? users.filter((u) => `${u.name ?? ''} ${u.email}`.toLowerCase().includes(q)) : users;
	$: adminCount = users.filter((u) => u.role === 'admin').length;

	// -- FUNCTIONS -- //

	function hash(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
		return h;
	}

	function nameOf(u: AdminUser): string {
		return u.name?.trim() || u.email;
	}

	function initialsOf(u: AdminUser): string {
		const s = nameOf(u);
		const parts = s
			.replace(/@.*/, '')
			.split(/[\s._-]+/)
			.filter(Boolean);
		const a = parts[0]?.[0] ?? s[0] ?? '?';
		const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
		return (a + b).toUpperCase();
	}

	function avatarClass(u: AdminUser): string {
		return AVATARS[hash(u.id) % AVATARS.length];
	}

	function joinedOf(u: AdminUser): string {
		return new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	async function load() {
		loading = true;
		errMsg = '';
		try {
			const res = await apiFetch('/api/admin/users');
			if (!res.ok) throw new Error('users fetch failed');
			users = await res.json();
		} catch {
			errMsg = 'Couldn’t load users. Try again.';
		} finally {
			loading = false;
		}
	}

	async function applyRole() {
		const req = pending;
		pending = null;
		if (!req || busyId) return;
		busyId = req.user.id;
		try {
			const res = await apiFetch(`/api/admin/users/${req.user.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ role: req.role }),
			});
			const data = (await res.json().catch(() => ({}))) as { role?: 'user' | 'admin'; message?: string };
			if (!res.ok) throw new Error(data.message ?? 'Could not update the role.');
			users = users.map((x) => (x.id === req.user.id ? { ...x, role: data.role ?? req.role } : x));
			toast.success(
				req.role === 'admin' ? `${nameOf(req.user)} is now an admin.` : `${nameOf(req.user)} is now a reader.`,
			);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not update the role.');
		} finally {
			busyId = null;
		}
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		// CLIENT GUARD FOR NATIVE (NO hooks PAGE REDIRECT IN THE STATIC SPA) — BOUNCE NON-ADMINS TO THE LIBRARY.
		if (!get(isAdmin)) {
			goto('/app/');
			return;
		}
		load();
	});
</script>

<svelte:head><title>Users · Admin · Xianslate</title></svelte:head>

<!-- USER MANAGEMENT: ACCOUNTS, ROLES, AND LIBRARY SIZES -->
<div class="mx-auto max-w-4xl px-4 py-6">
	<!-- HEADER -->
	<header class="mb-6 flex items-center gap-3">
		<a
			href="/admin/"
			class="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
			aria-label="Back to admin"
			use:ripple
		>
			<ArrowLeft size={20} />
		</a>
		<div class="flex-1">
			<h1 class="flex items-center gap-2 text-xl font-semibold">
				<Shield size={18} class="text-amber-500" /> Users
			</h1>
			<p class={cn('text-[13px]', MUTED)}>
				{#if !loading}{users.length} account{users.length === 1 ? '' : 's'} · {adminCount} admin{adminCount ===
					1
						? ''
						: 's'}{:else}Accounts, roles, and library sizes{/if}
			</p>
		</div>
	</header>

	<!-- SEARCH -->
	<div class="relative mb-4 w-full sm:max-w-xs">
		<Search size={15} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
		<input
			bind:value={search}
			type="search"
			placeholder="Search name or email…"
			class="w-full rounded-lg border border-black/10 bg-transparent py-2 pl-8 pr-2.5 text-sm outline-none placeholder:opacity-40 focus:border-sky-500 dark:border-white/[0.08]"
		/>
	</div>

	{#if loading}
		<!-- LOADING SKELETON -->
		<div class="flex flex-col gap-2">
			{#each [0, 1, 2, 3, 4] as i (i)}<div
					class="h-16 animate-pulse rounded-xl bg-black/10 dark:bg-white/10"
				></div>{/each}
		</div>
	{:else if errMsg}
		<!-- ERROR STATE -->
		<div class={cn(CARD, 'flex items-center justify-center gap-3 text-center text-[13px]', MUTED)}>
			<TriangleAlert size={16} class="text-amber-500" />
			{errMsg}
			<button
				use:ripple
				on:click={load}
				class="rounded-lg border border-black/10 px-2.5 py-1 text-xs dark:border-white/10">Retry</button
			>
		</div>
	{:else if filtered.length === 0}
		<!-- EMPTY STATE -->
		<div class={cn(CARD, 'text-center text-[13px]', MUTED)}>No users match your search.</div>
	{:else}
		<!-- USER LIST -->
		<div class="flex flex-col gap-2">
			{#each filtered as u (u.id)}
				<div class={cn(CARD, 'flex items-center gap-3')}>
					<!-- AVATAR -->
					<div
						class={cn(
							'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white',
							!u.avatarUrl && 'bg-gradient-to-br',
							!u.avatarUrl && avatarClass(u),
						)}
					>
						{#if u.avatarUrl}<img
								src={u.avatarUrl}
								alt=""
								class="h-full w-full object-cover"
							/>{:else}{initialsOf(u)}{/if}
					</div>
					<!-- IDENTITY -->
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-1.5">
							<span class="truncate text-sm font-medium">{nameOf(u)}</span>
							{#if u.id === meId}<span
									class="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400"
									>You</span
								>{/if}
							{#if u.role === 'admin'}
								<span
									class="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
									><Shield size={9} /> Admin</span
								>
							{/if}
							{#if u.emailVerified}<BadgeCheck size={13} class="text-emerald-500" />{/if}
						</div>
						<p class={cn('truncate text-xs', MUTED)}>{u.email}</p>
						<p class={cn('mt-0.5 text-[11px]', MUTED)}>
							{u.books} book{u.books === 1 ? '' : 's'} · joined {joinedOf(u)}
						</p>
					</div>
					<!-- ROLE ACTION -->
					<div class="shrink-0">
						{#if u.role === 'admin'}
							<Button
								size="sm"
								variant="ghost"
								disabled={u.id === meId || busyId === u.id}
								loading={busyId === u.id}
								on:click={() => (pending = { user: u, role: 'user' })}
							>
								{u.id === meId ? 'You' : 'Make reader'}
							</Button>
						{:else}
							<Button
								size="sm"
								disabled={busyId === u.id}
								loading={busyId === u.id}
								on:click={() => (pending = { user: u, role: 'admin' })}
							>
								Make admin
							</Button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- ROLE-CHANGE CONFIRMATION -->
<ConfirmDialog
	open={!!pending}
	variant={pending?.role === 'admin' ? 'default' : 'danger'}
	title={pending?.role === 'admin' ? 'Promote to admin?' : 'Remove admin access?'}
	message={pending
		? pending.role === 'admin'
			? `${nameOf(pending.user)} will get full access to the admin dashboard, including all users and AI spend.`
			: `${nameOf(pending.user)} will lose access to the admin dashboard and become a regular reader.`
		: ''}
	confirmLabel={pending?.role === 'admin' ? 'Make admin' : 'Make reader'}
	on:confirm={applyRole}
	on:cancel={() => (pending = null)}
/>
