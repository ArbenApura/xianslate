<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { ComponentType } from 'svelte';
	// IMPORTED TYPES
	import type { SessionUser } from '$lib/stores/auth';
	// IMPORTED DEP-MODULES
	import { page } from '$app/stores';
	// IMPORTED MODULES
	import { currentUser } from '$lib/stores/auth';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Gauge from 'lucide-svelte/icons/gauge';
	import Palette from 'lucide-svelte/icons/palette';
	import Shield from 'lucide-svelte/icons/shield';
	import UserRound from 'lucide-svelte/icons/user-round';

	// -- TYPES -- //

	// THE ACCOUNT SECTIONS — EACH IS A REAL ROUTE UNDER /app/account/ (NOT CLIENT-SIDE STATE), SO EVERY
	// SECTION IS DEEP-LINKABLE, BACK-BUTTON-FRIENDLY, AND SSR'D WITH ITS OWN SERVER LOAD.
	type Section = 'profile' | 'appearance' | 'security' | 'usage';

	// -- CONSTANTS -- //

	// THE SIDEBAR NAV. icon IS A lucide COMPONENT RENDERED VIA <svelte:component>; href IS THE SECTION ROUTE.
	const NAV: { id: Section; href: string; label: string; desc: string; icon: ComponentType; tint: string }[] = [
		{
			id: 'profile',
			href: '/app/account/profile/',
			label: 'Profile',
			desc: 'Your identity and how you appear.',
			icon: UserRound,
			tint: 'bg-[#c0392b]/10 text-[#b23a2e] dark:text-[#e08a63]',
		},
		{
			id: 'appearance',
			href: '/app/account/appearance/',
			label: 'Appearance',
			desc: 'Theme, language, and translation model.',
			icon: Palette,
			tint: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
		},
		{
			id: 'security',
			href: '/app/account/security/',
			label: 'Security',
			desc: 'Sign-in, verification, and your account.',
			icon: Shield,
			tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
		},
		{
			id: 'usage',
			href: '/app/account/usage/',
			label: 'Usage',
			desc: 'Translation, AI, and page-fetch spend.',
			icon: Gauge,
			tint: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
		},
	];
	// SHARED CARD + MUTED-TEXT TOKENS — MATCH THE ADMIN CONSOLE + CHAPTER STATS DIALOG SO ALL SURFACES READ
	// AS ONE APP.
	const CARD = 'rounded-2xl border border-black/10 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]';
	const MUTED = 'text-slate-500 dark:text-slate-400';

	// -- REACTIVE STATES -- //

	// CLIENT STORE IS AUTHORITATIVE; $page.data.user IS THE SSR SEED FOR FIRST PAINT.
	$: user = ($currentUser ?? $page.data.user ?? null) as SessionUser | null;
	// THE ACTIVE SECTION COMES FROM THE URL — MATCHES THE LONGEST ROUTE PREFIX SO /app/account/usage/
	// SELECTS Usage, NOT Profile (THE FALLBACK).
	$: active = NAV.find((n) => $page.url.pathname.startsWith(n.href)) ?? NAV[0];
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
				<!-- VERTICAL NAV — REAL ROUTES, SO THE ACTIVE SECTION IS THE URL, NOT LOCAL STATE -->
				<nav class="flex flex-col gap-1">
					{#each NAV as item (item.id)}
						<a
							use:ripple
							href={item.href}
							aria-current={active.id === item.id ? 'page' : undefined}
							class={cn(
								'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
								active.id === item.id
									? 'bg-[#c0392b]/10 font-medium text-[#b23a2e] dark:text-[#e08a63]'
									: cn('hover:bg-black/[0.04] dark:hover:bg-white/[0.06]', MUTED),
							)}
						>
							<svelte:component this={item.icon} size={18} />
							{item.label}
						</a>
					{/each}
				</nav>
			</aside>

			<!-- CONTENT: THE ACTIVE SECTION RENDERS ITS ROUTE'S PAGE BELOW -->
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
				<!-- MOBILE SEGMENTED TAB BAR — 4 EQUAL COLUMNS, ICON OVER LABEL (NO HORIZONTAL SCROLL) -->
				<nav
					class="mb-5 grid grid-cols-4 gap-1 rounded-xl border border-black/10 bg-black/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04] lg:hidden"
				>
					{#each NAV as item (item.id)}
						<a
							use:ripple
							href={item.href}
							aria-current={active.id === item.id ? 'page' : undefined}
							class={cn(
								'flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center text-[11px] font-medium leading-tight transition-colors',
								active.id === item.id
									? 'bg-white text-[#b23a2e] shadow-sm dark:bg-white/10 dark:text-[#e08a63]'
									: cn('hover:bg-black/[0.03] dark:hover:bg-white/[0.05]', MUTED),
							)}
						>
							<svelte:component this={item.icon} size={18} />
							{item.label}
						</a>
					{/each}
				</nav>
				<!-- SECTION HEADER — ICON CHIP, TITLE + DESCRIPTION (DRIVEN BY THE ACTIVE ROUTE) -->
				<header class="mb-5 flex items-center gap-3">
					<span class={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', active.tint)}>
						<svelte:component this={active.icon} size={22} />
					</span>
					<div class="min-w-0 flex-1">
						<h2 class="text-xl font-semibold">{active.label}</h2>
						<p class={cn('truncate text-[13px]', MUTED)}>{active.desc}</p>
					</div>
				</header>

				<slot />
			</div>
		</div>
	{/if}
</div>
