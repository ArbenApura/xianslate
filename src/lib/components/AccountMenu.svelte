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
	import { settings, THEME_POPOVER, THEME_PANEL_BORDER } from '$lib/stores/settings';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import LogOut from 'lucide-svelte/icons/log-out';
	import UserCog from 'lucide-svelte/icons/user-cog';
	import UserRound from 'lucide-svelte/icons/user-round';
	// IMPORTED COMPONENTS
	import Avatar from '$lib/components/ui/Avatar.svelte';

	// -- REQUIRED PROPS -- //

	export let user: SessionUser | null;

	// -- OPTIONAL PROPS -- //

	// PLAIN MODE — RENDER A NEUTRAL PROFILE ICON TRIGGER (NOT THE AVATAR), FOR THE READER'S MINIMAL TOP BAR.
	export let plain = false;

	// -- CONSTANTS -- //

	// FIXED MENU WIDTH SO THE PORTALED POPOVER CAN BE PLACED WITHOUT MEASURING ITS CONTENTS.
	const MENU_W = 240;

	// -- STATES -- //

	let open = false;
	let triggerEl: HTMLButtonElement;
	let menuEl: HTMLDivElement;
	let portalTarget: HTMLDivElement;
	let menuStyle = '';
	let signingOut = false;

	// -- REACTIVE STATES -- //

	$: label = user?.name?.trim() || user?.email || 'Account';
	// THEME-AWARE OPAQUE POPOVER SURFACE + BORDER (WAS A HARDCODED white / slate-800 PLANE)
	$: popover = THEME_POPOVER[$settings.theme];
	$: popoverBorder = THEME_PANEL_BORDER[$settings.theme];

	// -- FUNCTIONS -- //

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
		plain
			? 'rounded-md p-1.5 opacity-70 transition-opacity hover:opacity-100'
			: 'overflow-hidden rounded-full transition-transform hover:scale-105',
	)}
>
	{#if plain}
		<UserRound size={18} />
	{:else}
		<Avatar
			name={label}
			src={user?.avatarUrl ?? null}
			size={36}
			class="border border-black/10 dark:border-white/10"
		/>
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
		class={cn('fixed z-[9999] overflow-hidden rounded-xl border p-1 shadow-lg', popover, popoverBorder)}
	>
		<!-- IDENTITY HEADER -->
		<div class="flex items-center gap-2.5 px-2.5 py-2.5">
			<Avatar name={label} src={user?.avatarUrl ?? null} size={36} class="shrink-0" />
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium">{label}</p>
				{#if user?.email && user.email !== label}
					<p class="truncate text-xs opacity-60">{user.email}</p>
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
			class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
		>
			<UserCog size={15} class="shrink-0" /> <span class="flex-1">Account settings</span>
		</button>

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
