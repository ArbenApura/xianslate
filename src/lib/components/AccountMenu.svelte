<script lang="ts" context="module">
	// MOVE THE DROPDOWN TO document.body SO A CLIPPING ANCESTOR (THE STICKY HEADER) CAN'T CUT IT OFF.
	function portal(node: HTMLElement, target: HTMLElement) {
		target.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) node.parentNode.removeChild(node);
			},
		};
	}
</script>

<script lang="ts">
	// IMPORTED TYPES
	import type { SessionUser } from '$lib/stores/auth';
	// IMPORTED DEP-MODULES
	import { onDestroy, onMount, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	// IMPORTED MODULES
	import { goto } from '$app/navigation';
	import { signOutEverywhere } from '$lib/stores/auth';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import LogOut from 'lucide-svelte/icons/log-out';
	import Shield from 'lucide-svelte/icons/shield';
	import UserCog from 'lucide-svelte/icons/user-cog';

	// -- REQUIRED PROPS -- //

	export let user: SessionUser | null;

	// -- CONSTANTS -- //

	// FIXED MENU WIDTH SO THE PORTALED POPOVER CAN BE PLACED WITHOUT MEASURING ITS CONTENTS.
	const MENU_W = 240;
	// DETERMINISTIC AVATAR GRADIENTS (COMPLETE LITERAL CLASSES — KEEPS cn()/TAILWIND HAPPY).
	const AVATARS = [
		'from-rose-500 to-orange-400',
		'from-sky-500 to-indigo-600',
		'from-emerald-500 to-teal-600',
		'from-violet-500 to-fuchsia-600',
		'from-amber-500 to-red-500',
		'from-cyan-500 to-blue-600',
	];

	// -- STATES -- //

	let open = false;
	let triggerEl: HTMLButtonElement;
	let menuEl: HTMLDivElement;
	let portalTarget: HTMLDivElement;
	let menuStyle = '';
	let signingOut = false;

	// -- REACTIVE STATES -- //

	$: label = user?.name?.trim() || user?.email || 'Account';
	$: initials = initialsOf(label);
	$: avatarClass = AVATARS[hash(label) % AVATARS.length];

	// -- FUNCTIONS -- //

	function hash(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
		return h;
	}

	function initialsOf(s: string): string {
		const parts = s
			.replace(/@.*/, '')
			.split(/[\s._-]+/)
			.filter(Boolean);
		const a = parts[0]?.[0] ?? s[0] ?? '?';
		const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
		return (a + b).toUpperCase();
	}

	function updatePosition() {
		if (!triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		const gap = 8;
		let left = rect.right - MENU_W;
		if (left + MENU_W > window.innerWidth - 8) left = window.innerWidth - MENU_W - 8;
		if (left < 8) left = 8;
		// RUNTIME-DYNAMIC PIXEL VALUES FROM getBoundingClientRect() CANNOT BE TAILWIND CLASSES — style="" EXCEPTION (b).
		menuStyle = `left:${Math.round(left)}px;top:${Math.round(rect.bottom + gap)}px;width:${MENU_W}px;`;
	}

	async function openMenu() {
		open = true;
		updatePosition();
		await tick();
		updatePosition();
	}

	function toggle() {
		if (open) open = false;
		else openMenu();
	}

	function go(path: string) {
		open = false;
		goto(path);
	}

	async function doSignOut() {
		if (signingOut) return;
		signingOut = true;
		open = false;
		await signOutEverywhere();
	}

	function onClickOutside(e: MouseEvent) {
		if (!open) return;
		const t = e.target as Node;
		if (triggerEl?.contains(t) || menuEl?.contains(t)) return;
		open = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			open = false;
			triggerEl?.focus();
		}
	}

	function onScroll() {
		if (open) updatePosition();
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		portalTarget = document.createElement('div');
		document.body.appendChild(portalTarget);
		document.addEventListener('mousedown', onClickOutside);
		document.addEventListener('keydown', onKeydown);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onScroll);
	});
	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.removeEventListener('mousedown', onClickOutside);
			document.removeEventListener('keydown', onKeydown);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onScroll);
			if (portalTarget?.parentNode) portalTarget.parentNode.removeChild(portalTarget);
		}
	});
</script>

<!-- AVATAR TRIGGER (PHOTO IF PRESENT, ELSE A GRADIENT INITIALS CHIP) -->
<button
	bind:this={triggerEl}
	type="button"
	use:ripple
	on:click={toggle}
	aria-haspopup="menu"
	aria-expanded={open}
	aria-label="Account menu"
	class={cn(
		'flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-black/10 text-xs font-semibold text-white transition-transform hover:scale-105 dark:border-white/10',
		!user?.avatarUrl && 'bg-gradient-to-br',
		!user?.avatarUrl && avatarClass,
	)}
>
	{#if user?.avatarUrl}
		<img src={user.avatarUrl} alt="" class="h-full w-full object-cover" />
	{:else}
		{initials}
	{/if}
</button>

<!-- ACCOUNT DROPDOWN (PORTALED TO body SO THE STICKY HEADER'S STACKING CAN'T CLIP IT) -->
<!-- RUNTIME-DYNAMIC PIXEL VALUES (left, top, width) REQUIRE style="" — EXCEPTION (b). -->
{#if open && portalTarget}
	<div
		bind:this={menuEl}
		use:portal={portalTarget}
		role="menu"
		tabindex="-1"
		transition:fly={{ y: -8, duration: 150, easing: cubicOut }}
		style={menuStyle}
		class="fixed z-[9999] overflow-hidden rounded-xl border border-black/10 bg-white p-1 shadow-lg dark:border-white/[0.08] dark:bg-slate-800"
	>
		<!-- IDENTITY HEADER -->
		<div class="flex items-center gap-2.5 px-2.5 py-2.5">
			<div
				class={cn(
					'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white',
					!user?.avatarUrl && 'bg-gradient-to-br',
					!user?.avatarUrl && avatarClass,
				)}
			>
				{#if user?.avatarUrl}<img
						src={user.avatarUrl}
						alt=""
						class="h-full w-full object-cover"
					/>{:else}{initials}{/if}
			</div>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{label}</p>
				{#if user?.email && user.email !== label}
					<p class="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
				{/if}
			</div>
			{#if user?.role === 'admin'}
				<span
					class="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
					>Admin</span
				>
			{/if}
		</div>

		<div class="my-1 h-px bg-black/[0.06] dark:bg-white/10"></div>

		<!-- ACCOUNT SETTINGS -->
		<button
			type="button"
			role="menuitem"
			use:ripple
			on:click={() => go('/app/account/')}
			class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/5"
		>
			<UserCog size={15} class="shrink-0" /> <span class="flex-1">Account settings</span>
		</button>

		<!-- ADMIN (ADMINS ONLY) -->
		{#if user?.role === 'admin'}
			<button
				type="button"
				role="menuitem"
				use:ripple
				on:click={() => go('/admin/')}
				class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/5"
			>
				<Shield size={15} class="shrink-0" /> <span class="flex-1">Admin dashboard</span>
			</button>
		{/if}

		<div class="my-1 h-px bg-black/[0.06] dark:bg-white/10"></div>

		<!-- SIGN OUT -->
		<button
			type="button"
			role="menuitem"
			use:ripple={{ disabled: signingOut }}
			on:click={doSignOut}
			class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
		>
			<LogOut size={15} class="shrink-0" /> <span class="flex-1">Sign out</span>
		</button>
	</div>
{/if}
