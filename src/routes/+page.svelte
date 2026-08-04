<script lang="ts">
	// IMPORTED TYPES
	import type { SessionUser } from '$lib/stores/auth';
	// IMPORTED ENVS
	import { browser } from '$app/environment';
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	import { reveal } from '$lib/actions/reveal';
	import { ripple } from '$lib/actions/ripple';
	import { page } from '$app/stores';
	import { currentUser } from '$lib/stores/auth';
	import { settings, type Theme } from '$lib/stores/settings';
	import { onDestroy, onMount } from 'svelte';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import AudioLines from 'lucide-svelte/icons/audio-lines';
	import BookMarked from 'lucide-svelte/icons/book-marked';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Check from 'lucide-svelte/icons/check';
	import Clock from 'lucide-svelte/icons/clock';
	import Coffee from 'lucide-svelte/icons/coffee';
	import Contrast from 'lucide-svelte/icons/contrast';
	import Globe from 'lucide-svelte/icons/globe';
	import Languages from 'lucide-svelte/icons/languages';
	import Link2 from 'lucide-svelte/icons/link-2';
	import Moon from 'lucide-svelte/icons/moon';
	import MoonStar from 'lucide-svelte/icons/moon-star';
	import Play from 'lucide-svelte/icons/play';
	import Settings from 'lucide-svelte/icons/settings';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Star from 'lucide-svelte/icons/star';
	import Sun from 'lucide-svelte/icons/sun';
	import Type from 'lucide-svelte/icons/type';
	import UserRound from 'lucide-svelte/icons/user-round';
	import Volume2 from 'lucide-svelte/icons/volume-2';
	// IMPORTED COMPONENTS
	import AccountMenu from '$lib/components/AccountMenu.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import InkDivider from '$lib/components/ui/InkDivider.svelte';
	import Seal from '$lib/components/ui/Seal.svelte';

	// -- TYPES -- //

	type Step = { icon: typeof BookOpen; title: string; blurb: string };

	// -- CONSTANTS -- //

	// HEADER THEME TOGGLE — CYCLES THE FULL 5-THEME SET (LIGHT GROUP → PROGRESSIVELY DARKER), EACH WITH ITS OWN ICON
	const THEME_CYCLE: Theme[] = ['light', 'sepia', 'dark', 'oled', 'contrast'];
	const THEME_ICON = { light: Sun, sepia: Coffee, dark: Moon, oled: MoonStar, contrast: Contrast } as const;
	// THREE DISTINCT SWATCHES (WHITE / SEPIA / DARK) + A "+" — WE SKIP oled & contrast SINCE THEY'RE ALSO
	// NEAR-BLACK AND WOULD READ AS DUPLICATES, AND THEMES ARE BECOMING FULLY CUSTOMIZABLE (CUSTOM BACKGROUND /
	// TEXT), SO A FIXED COUNT WOULD BE WRONG.
	const THEME_SWATCHES = [
		{ name: 'Light', cls: 'bg-[#fbfaf7] border-black/20' },
		{ name: 'Sepia', cls: 'bg-[#f4ecd8] border-[#cbb98f]' },
		{ name: 'Dark', cls: 'bg-[#13100c] border-white/20' },
	];
	// A SMALL, CONCRETE SAMPLE OF SUPPORTED LANGUAGES (ENDONYMS READ AS A WORLD MAP AT A GLANCE).
	const LANGS = ['English', '中文', '日本語', '한국어', 'Español', 'Français', 'Deutsch', 'Tiếng Việt', 'العربية'];
	// MINI WAVEFORM BARS FOR THE READ-ALOUD TILE — LITERAL HEIGHTS SO NO RUNTIME CLASS CONSTRUCTION.
	const WAVE = ['h-2', 'h-4', 'h-6', 'h-3', 'h-5', 'h-7', 'h-4', 'h-2', 'h-5', 'h-3', 'h-6', 'h-4'];
	// FOOTER COLUMN-HEADER + LINK STYLES — SHARED SO EVERY LINK GETS THE SAME ACCENT HOVER AND THE MARKUP STAYS
	// SHORT (COMPLETE LITERAL STRINGS, APPLIED VIA class={...}).
	const FOOTER_HEAD = 'text-[11px] font-semibold uppercase tracking-[0.14em] opacity-40';
	const FOOTER_LINK =
		'w-fit rounded text-left opacity-60 transition-colors hover:text-[#b23a2e] dark:hover:text-[#e08a63]';

	// THREE-STEP "HOW IT WORKS" STRIP
	const STEPS: Step[] = [
		{
			icon: Link2,
			title: 'Add a source',
			blurb: 'Paste a chapter link or drop in an EPUB or TXT — build your shelf in seconds.',
		},
		{
			icon: Sparkles,
			title: 'We translate it',
			blurb: 'A genre-aware model re-tells it in fluent prose and builds a typed glossary — names, ranks, and realms that never drift.',
		},
		{
			icon: BookOpen,
			title: 'Read your way',
			blurb: 'Bilingual or single-language, your theme and typeface — or listen hands-free.',
		},
	];

	// -- STATES -- //

	// THE STICKY NAV STAYS TRANSPARENT OVER THE HERO, THEN GAINS A BLURRED BACKDROP ONCE THE PAGE SCROLLS.
	let scrolled = false;

	// -- REACTIVE STATES -- //

	// $page.data.user IS THE SSR SEED (NO FLASH ON FIRST PAINT); THE CLIENT auth STORE IS AUTHORITATIVE (LOGIN / LOGOUT IN PLACE).
	$: user = ($currentUser ?? $page.data.user ?? null) as SessionUser | null;
	$: loggedIn = !!user;

	// -- FUNCTIONS -- //

	function onScroll() {
		scrolled = window.scrollY > 8;
	}

	// SMOOTH IN-PAGE JUMP FOR THE NAV ANCHORS (THE DOCUMENT SCROLLER ISN'T scroll-smooth BY DEFAULT).
	function jumpTo(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// CYCLE TO THE NEXT THEME — THE settings STORE SUBSCRIPTION APPLIES IT APP-WIDE AND PERSISTS IT.
	function cycleTheme() {
		const i = THEME_CYCLE.indexOf($settings.theme);
		$settings.theme = THEME_CYCLE[(i + 1) % THEME_CYCLE.length] ?? 'light';
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
	});
	onDestroy(() => {
		if (browser) window.removeEventListener('scroll', onScroll);
	});
</script>

<svelte:head>
	<title>Xianslate — web novels that read like a real translation</title>
	<meta
		name="description"
		content="Xianslate re-tells Chinese, Japanese, and Korean web-novel raws as fluent, consistent prose, with a living glossary that classifies and locks every name, rank, and realm — so you can binge thousands of chapters without waiting on a translator."
	/>
</svelte:head>

<!-- PAGE SHELL — FULL-BLEED SECTIONS, CONTAINED CONTENT. THEME COMES FROM THE LAYOUT ROOT. -->
<div class="flex min-h-screen flex-col">
	<!-- STICKY NAV — TRANSPARENT AT THE TOP, FROSTED + BORDERED ONCE SCROLLED -->
	<header
		class={cn(
			'sticky top-0 z-50 transition-all duration-300',
			scrolled
				? 'border-b border-black/[0.07] bg-black/[0.04] backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.04]'
				: 'border-b border-transparent',
		)}
	>
		<div class="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
			<!-- BRAND -->
			<span class="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
				<Seal size={28} /> Xianslate
			</span>
			<!-- IN-PAGE NAV (DESKTOP) -->
			<nav class="hidden items-center gap-1 text-sm md:flex">
				<button
					use:ripple
					on:click={() => jumpTo('features')}
					class="rounded-md px-3 py-1.5 opacity-70 hover:opacity-100">Features</button
				>
				<button
					use:ripple
					on:click={() => jumpTo('how')}
					class="rounded-md px-3 py-1.5 opacity-70 hover:opacity-100">How it works</button
				>
			</nav>
			<!-- ACCOUNT ENTRY — THEME TOGGLE, THEN AUTH-AWARE ACTIONS -->
			<div class="flex items-center gap-1.5">
				<!-- THEME TOGGLE — CYCLES ALL 5 THEMES; ICON REFLECTS THE CURRENT ONE -->
				<button
					use:ripple
					on:click={cycleTheme}
					aria-label="Switch theme"
					title="Switch theme"
					class="inline-flex h-9 w-9 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
				>
					<svelte:component this={THEME_ICON[$settings.theme]} size={18} />
				</button>
				{#if loggedIn}
					<!-- SIGNED IN — STRAIGHT TO THE LIBRARY + ACCOUNT MENU; NO "Sign in" -->
					<Button href="/app/" variant="primary">Open app</Button>
					<AccountMenu {user} />
				{:else}
					<!-- SIGNED OUT -->
					<Button href="/login/" variant="ghost">Sign in</Button>
					<Button href="/app/" variant="primary">Open app</Button>
				{/if}
			</div>
		</div>
	</header>

	<!-- HERO -->
	<section class="mx-auto w-full max-w-5xl px-5 pt-14 text-center sm:px-8 sm:pt-20">
		<!-- HEADLINE — Literata (THE READER'S OWN SERIF). SOLID ACCENT, NO GRADIENT HAZE. text-balance EVENS BREAKS. -->
		<h1
			class="mx-auto max-w-3xl text-balance font-[Literata,Georgia,serif] text-[2.7rem] font-bold leading-[1.06] tracking-tight sm:text-6xl md:text-[4.25rem]"
		>
			Web novels that read like <span class="text-[#b23a2e] dark:text-[#e08a63]">a real translation</span>
		</h1>
		<p class="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed opacity-65 sm:text-lg">
			Xianslate re-tells Chinese, Japanese, and Korean raws as fluent, consistent prose — every name, rank, and
			realm kept in place by a glossary that learns your story — so you can binge thousands of chapters without
			waiting on a translator.
		</p>
		<!-- CALL TO ACTION — SIGNED IN GOES STRAIGHT TO THE LIBRARY; SIGNED OUT IS INVITED TO SIGN UP -->
		<div class="mt-9 flex flex-wrap items-center justify-center gap-3">
			{#if loggedIn}
				<Button href="/app/" variant="primary" class="px-6 py-3 text-base">
					Open your library <ArrowRight size={18} />
				</Button>
			{:else}
				<Button href="/signup/" variant="primary" class="px-6 py-3 text-base">
					Start reading free <ArrowRight size={18} />
				</Button>
				<Button href="/app/" class="px-5 py-3 text-base">Open the app</Button>
			{/if}
		</div>
		<p class="mt-6 text-xs tracking-wide opacity-50">Free to start · Read on any device · Private to you</p>
	</section>

	<!-- PRODUCT HERO — A LAYERED READER PANE WITH FLOATING ACCENT CARDS (DEPTH, NOT A FLAT MOCKUP) -->
	<div class="mx-auto mt-16 w-full max-w-3xl px-5 sm:mt-20 sm:px-8">
		<div use:reveal class="relative transition duration-700 ease-out">
			<!-- MAIN READER WINDOW -->
			<div
				class="overflow-hidden rounded-2xl border border-black/[0.09] bg-black/[0.02] shadow-2xl shadow-black/10 dark:border-white/[0.09] dark:bg-white/[0.03]"
			>
				<!-- READER TOP BAR — MIRRORS THE REAL READER (BACK · BOOK TITLE · TOOLS · PROFILE) -->
				<div
					class="flex items-center gap-2.5 border-b border-black/[0.06] px-4 py-2.5 dark:border-white/[0.045]"
				>
					<ArrowLeft size={14} class="shrink-0 opacity-50" />
					<span class="min-w-0 flex-1 truncate text-xs font-medium opacity-55"
						>Sword of the Azure Heavens</span
					>
					<Type size={13} class="shrink-0 opacity-45" />
					<Settings size={13} class="shrink-0 opacity-45" />
					<UserRound size={13} class="shrink-0 opacity-45" />
				</div>
				<!-- READING COLUMN — CHAPTER TITLE, META, VIEW-MODE CONTROL, THEN BILINGUAL PROSE (AS IN THE READER) -->
				<div class="p-6">
					<h3 class="font-[Literata,Georgia,serif] text-lg font-bold leading-snug">
						Chapter 5 · The Sword Returns
					</h3>
					<div class="mt-1.5 flex items-center gap-1 text-[10px] opacity-45">
						<Clock size={11} /> 6 min read
					</div>
					<!-- VIEW-MODE SEGMENTED CONTROL — "Bilingual" ACTIVE (CINNABAR), AS IN THE READER'S ACTION BAR -->
					<div
						class="mt-3 inline-flex overflow-hidden rounded-lg border border-black/[0.12] text-[10px] dark:border-white/[0.08]"
					>
						<span class="px-2 py-1 opacity-55">Translation</span>
						<span class="bg-[#b23a2e] px-2 py-1 font-medium text-white">Bilingual</span>
						<span class="px-2 py-1 opacity-55">Stacked</span>
					</div>
					<!-- BILINGUAL PROSE — SOURCE (DIMMED) | TARGET, NO PER-PARAGRAPH LABELS (THE READER HAS NONE) -->
					<div class="mt-4 grid gap-5 text-[15px] leading-loose sm:grid-cols-2 sm:gap-8">
						<p class="opacity-60">
							他抬手一剑，星河为之倒卷，万剑归宗，尽数没入剑鞘。少年立于绝峰之巅，衣袂翻飞，目光淡漠如初雪。
						</p>
						<p class="font-[Literata,Georgia,serif]">
							He raised his hand and loosed a single stroke — the galaxy reversed its course, and the
							Myriad Swords returned to their source, sheathing as one. The youth stood atop the lone
							summit, his gaze as cold and distant as first snow.
						</p>
					</div>
				</div>
			</div>

			<!-- FLOATING CARD: AUTO GLOSSARY (TOP-RIGHT, DESKTOP ONLY) — MIRRORS THE READER'S TERM CARDS:
			     SOURCE → TARGET, A NOTE, AND CATEGORY / GENDER / FIRST-SEEN / STATUS CHIPS. LIFTED WELL ABOVE THE
			     TOP-RIGHT CORNER SO IT PEEKS OVER THE WINDOW CHROME WITHOUT COVERING THE TRANSLATION PROSE BELOW. -->
			<div
				class="absolute -right-6 -top-16 hidden w-64 rotate-2 overflow-hidden rounded-xl border border-black/[0.08] bg-[#fbf6ea]/95 shadow-xl shadow-black/10 backdrop-blur dark:border-white/[0.1] dark:bg-[#211c15]/95 lg:block"
			>
				<!-- CARD HEADER -->
				<div
					class="flex items-center gap-1.5 border-b border-black/[0.06] px-3 py-1.5 text-[11px] font-semibold opacity-60 dark:border-white/[0.06]"
				>
					<BookMarked size={12} class="text-[#a97f28] dark:text-[#d8b15a]" /> Auto glossary
				</div>
				<!-- TERM LIST — READ-ONLY CARDS, AS IN THE GLOSSARY PANEL -->
				<ul class="divide-y divide-black/[0.06] dark:divide-white/[0.045]">
					<!-- TERM 1 — A PINNED TECHNIQUE (AUTO-EXTRACTED) -->
					<li class="px-3 py-1.5">
						<div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
							<Star size={11} class="shrink-0 self-center fill-amber-400 text-amber-500" />
							<span class="font-medium">万剑归宗</span>
							<span class="opacity-30">→</span>
							<span class="text-[#b23a2e] dark:text-[#e08a63]">Myriad Sword Convergence</span>
						</div>
						<p class="mt-0.5 line-clamp-1 text-[11px] leading-relaxed opacity-55">
							A sword art that recalls ten thousand blades to a single sheath.
						</p>
						<!-- META CHIPS: CATEGORY · FIRST-SEEN · STATUS (HEX IS THE Technique CATEGORY ACCENT) -->
						<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
							<span class="rounded-full border border-[#6d6fe0]/40 px-1.5 py-0.5 text-[#6d6fe0]"
								>Technique</span
							>
							<span class="opacity-45">Ch. 5</span>
							<span class="opacity-45">AI</span>
						</div>
					</li>
					<!-- TERM 2 — A CHARACTER, CONFIRMED BY YOU -->
					<li class="px-3 py-1.5">
						<div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
							<span class="font-medium">叶凡</span>
							<span class="opacity-30">→</span>
							<span class="text-[#b23a2e] dark:text-[#e08a63]">Ye Fan</span>
						</div>
						<!-- META CHIPS: CATEGORY · GENDER · FIRST-SEEN · STATUS (HEX IS THE Character CATEGORY ACCENT) -->
						<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
							<span class="rounded-full border border-[#e0567a]/40 px-1.5 py-0.5 text-[#e0567a]"
								>Character</span
							>
							<span class="bg-[#3b6fb0]/12 rounded px-1.5 py-0.5 text-[#3b6fb0] dark:text-[#7aa6e0]"
								>Masculine</span
							>
							<span class="opacity-45">Ch. 1</span>
							<span class="bg-[#5b8a72]/14 rounded px-1.5 py-0.5 text-[#4f7a64] dark:text-[#83b39a]"
								>You</span
							>
						</div>
					</li>
				</ul>
			</div>

			<!-- FLOATING CARD: THEMES (BOTTOM-LEFT, DESKTOP ONLY) -->
			<div
				class="absolute -bottom-6 -left-6 hidden -rotate-2 rounded-xl border border-black/[0.08] bg-[#fbf6ea]/90 p-3 shadow-xl shadow-black/10 backdrop-blur dark:border-white/[0.1] dark:bg-[#211c15]/90 lg:block"
			>
				<span class="mb-2 block text-[11px] font-semibold opacity-60">Make it yours</span>
				<div class="flex items-center gap-1.5">
					{#each THEME_SWATCHES as t (t.name)}
						<span class={cn('h-5 w-5 rounded-full border', t.cls)} title={t.name}></span>
					{/each}
					<!-- "+" → MORE THEMES + FULL CUSTOMIZATION COMING (CUSTOM BACKGROUND / TEXT) -->
					<span
						class="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-black/20 text-[11px] leading-none opacity-50 dark:border-white/25"
						title="More themes and customization">+</span
					>
				</div>
			</div>

			<!-- FLOATING CHIP: READ-ALOUD (TOP-LEFT, DESKTOP ONLY) -->
			<div
				class="absolute -left-4 top-12 hidden items-center gap-1.5 rounded-full border border-black/[0.08] bg-[#fbf6ea]/90 px-3 py-1.5 text-[11px] font-medium shadow-lg shadow-black/10 backdrop-blur dark:border-white/[0.1] dark:bg-[#211c15]/90 xl:flex"
			>
				<Volume2 size={12} class="text-[#b23a2e] dark:text-[#e08a63]" /> Reading aloud
			</div>
		</div>
	</div>

	<!-- BENTO FEATURE GRID — VARIED TILE SIZES, EACH WITH A REAL MINI-VISUAL (NOT A FLAT ICON LIST) -->
	<section id="features" class="mx-auto mt-28 w-full max-w-6xl px-5 sm:mt-32 sm:px-8">
		<div use:reveal class="mb-10 text-center transition duration-700 ease-out">
			<p class="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b23a2e] dark:text-[#e08a63]">
				Why Xianslate
			</p>
			<h2 class="text-balance font-[Literata,Georgia,serif] text-3xl font-bold tracking-tight sm:text-4xl">
				Built for 1,000-chapter binges
			</h2>
			<p class="mx-auto mt-3 max-w-lg text-balance text-sm leading-relaxed opacity-60 sm:text-base">
				Faithful prose, a glossary that keeps every name and term in place, and a reader you'll disappear into
				for hours.
			</p>
		</div>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			<!-- LITERARY (WIDE) -->
			<div
				use:reveal
				class="group flex flex-col justify-between gap-5 rounded-2xl border border-black/[0.08] bg-black/[0.02] p-6 transition duration-700 ease-out hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[0.08] dark:bg-white/[0.02] sm:col-span-2"
			>
				<div>
					<div
						class="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#c0392b]/10 text-[#b23a2e] dark:text-[#e08a63]"
					>
						<Sparkles size={20} />
					</div>
					<h3 class="text-lg font-semibold">Literary, not literal</h3>
					<p class="mt-1.5 max-w-md text-sm leading-relaxed opacity-60">
						A genre-aware model re-tells each chapter the way a translator would — cultivation, wuxia, and
						romance flow naturally. No garbled grammar, no robotic literalism.
					</p>
				</div>
				<!-- MINI BEFORE/AFTER -->
				<div
					class="grid gap-2 rounded-xl border border-black/[0.06] bg-black/[0.02] p-3 text-[13px] dark:border-white/[0.045] dark:bg-white/[0.02] sm:grid-cols-2"
				>
					<p class="opacity-45">他眸光一冷，杀意如潮。</p>
					<p class="font-[Literata,Georgia,serif]">
						His eyes turned cold, killing intent surging like a tide.
					</p>
				</div>
			</div>

			<!-- LANGUAGES -->
			<div
				use:reveal={{ delay: 70 }}
				class="group flex flex-col gap-4 rounded-2xl border border-black/[0.08] bg-black/[0.02] p-6 transition duration-700 ease-out hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[0.08] dark:bg-white/[0.02]"
			>
				<div
					class="bg-[#5b8a72]/14 inline-flex h-10 w-10 items-center justify-center rounded-xl text-[#4f7a64] dark:text-[#83b39a]"
				>
					<Languages size={20} />
				</div>
				<div>
					<h3 class="text-base font-semibold">Your language, or the raws</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">
						Read in the language you know best — or keep a book in its original, distraction-free.
					</p>
				</div>
				<div class="mt-auto flex flex-wrap gap-1.5">
					{#each LANGS as lang}
						<span
							class="rounded-md border border-black/[0.07] px-2 py-0.5 text-xs opacity-70 dark:border-white/[0.08]"
							>{lang}</span
						>
					{/each}
				</div>
			</div>

			<!-- GLOSSARY -->
			<div
				use:reveal
				class="group flex flex-col gap-4 rounded-2xl border border-black/[0.08] bg-black/[0.02] p-6 transition duration-700 ease-out hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[0.08] dark:bg-white/[0.02]"
			>
				<div
					class="bg-[#c9a24b]/16 inline-flex h-10 w-10 items-center justify-center rounded-xl text-[#a97f28] dark:text-[#d8b15a]"
				>
					<BookMarked size={20} />
				</div>
				<div>
					<h3 class="text-base font-semibold">A living glossary</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">
						Characters, locations, techniques, and realms — auto-classified, gender-aware, and pinned where
						it counts — so 叶凡 stays “Ye Fan” across a thousand chapters. Tap to correct any term.
					</p>
				</div>
				<!-- MINI TERM CARDS — MIRROR THE READER'S GLOSSARY: [★ IF PINNED] source → target, THEN CATEGORY · GENDER · STATUS -->
				<div class="mt-auto space-y-1.5">
					<div class="rounded-md bg-black/[0.03] px-2 py-1.5 dark:bg-white/[0.04]">
						<div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
							<span class="font-medium opacity-70">叶凡</span>
							<span class="opacity-30">→</span>
							<span class="font-medium text-[#b23a2e] dark:text-[#e08a63]">Ye Fan</span>
						</div>
						<div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
							<span class="rounded-full border border-[#e0567a]/40 px-1.5 py-0.5 text-[#e0567a]"
								>Character</span
							>
							<span class="bg-[#3b6fb0]/12 rounded px-1.5 py-0.5 text-[#3b6fb0] dark:text-[#7aa6e0]"
								>Masculine</span
							>
							<span class="bg-[#5b8a72]/14 rounded px-1.5 py-0.5 text-[#4f7a64] dark:text-[#83b39a]"
								>You</span
							>
						</div>
					</div>
					<div class="rounded-md bg-black/[0.03] px-2 py-1.5 dark:bg-white/[0.04]">
						<div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
							<Star size={11} class="shrink-0 self-center fill-amber-400 text-amber-500" />
							<span class="font-medium opacity-70">大帝</span>
							<span class="opacity-30">→</span>
							<span class="font-medium text-[#b23a2e] dark:text-[#e08a63]">Great Emperor</span>
						</div>
						<div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
							<span class="rounded-full border border-[#3a8fc9]/40 px-1.5 py-0.5 text-[#3a8fc9]"
								>Title</span
							>
							<span class="opacity-45">AI</span>
						</div>
					</div>
				</div>
			</div>

			<!-- ANY SOURCE -->
			<div
				use:reveal={{ delay: 70 }}
				class="group flex flex-col gap-4 rounded-2xl border border-black/[0.08] bg-black/[0.02] p-6 transition duration-700 ease-out hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[0.08] dark:bg-white/[0.02]"
			>
				<div
					class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#b23a2e]/10 text-[#b23a2e] dark:text-[#e08a63]"
				>
					<Globe size={20} />
				</div>
				<div>
					<h3 class="text-base font-semibold">Bring your own raws</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">
						Paste a chapter URL or import an EPUB or TXT. New sites are learned automatically — no setup.
					</p>
				</div>
				<!-- MINI "ADD SOURCE" MOCKUP — A PASTE-A-URL BAR, THEN THE FILE-IMPORT FALLBACK -->
				<div class="mt-auto space-y-2.5">
					<!-- FAUX URL FIELD WITH A "Add" AFFORDANCE -->
					<div
						class="flex items-center gap-2 rounded-lg border border-black/[0.08] bg-black/[0.02] px-2.5 py-2 dark:border-white/[0.08] dark:bg-white/[0.03]"
					>
						<Link2 size={13} class="shrink-0 opacity-40" />
						<span class="min-w-0 flex-1 truncate text-xs opacity-50">novelsite.com/story/ch-562</span>
						<span class="shrink-0 rounded-md bg-[#b23a2e] px-2 py-1 text-[10px] font-semibold text-white"
							>Add</span
						>
					</div>
					<!-- AUTO-LEARN CONFIRMATION — REINFORCES "NEW SITES ARE LEARNED AUTOMATICALLY" -->
					<div class="flex items-center gap-1.5 text-[11px] text-[#4f7a64] dark:text-[#83b39a]">
						<Check size={12} class="shrink-0" /> New site learned — 562 chapters found
					</div>
					<!-- OR DROP IN A FILE -->
					<div class="flex flex-wrap items-center gap-2 text-xs font-medium">
						<span class="opacity-40">or import</span>
						<span class="rounded-md bg-black/[0.05] px-2 py-1 opacity-70 dark:bg-white/[0.06]">EPUB</span>
						<span class="rounded-md bg-black/[0.05] px-2 py-1 opacity-70 dark:bg-white/[0.06]">TXT</span>
					</div>
				</div>
			</div>

			<!-- LISTEN -->
			<div
				use:reveal={{ delay: 140 }}
				class="group flex flex-col gap-4 rounded-2xl border border-black/[0.08] bg-black/[0.02] p-6 transition duration-700 ease-out hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[0.08] dark:bg-white/[0.02]"
			>
				<div
					class="bg-[#5b8a72]/14 inline-flex h-10 w-10 items-center justify-center rounded-xl text-[#4f7a64] dark:text-[#83b39a]"
				>
					<AudioLines size={20} />
				</div>
				<div>
					<h3 class="text-base font-semibold">Listen on the go</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">
						Have any chapter read aloud, with the current word highlighted as it goes.
					</p>
				</div>
				<!-- MINI AUDIO PLAYER — EXCERPT WITH THE ACTIVE WORD HIGHLIGHTED, THEN A PLAY / WAVEFORM / TIME BAR -->
				<div class="mt-auto space-y-3">
					<p class="text-xs leading-relaxed opacity-60">
						He stood atop the <span class="rounded bg-[#5b8a72]/20 px-1 text-[#4f7a64] dark:text-[#83b39a]"
							>lone</span
						> summit, his gaze as cold and distant as first snow…
					</p>
					<!-- PLAYER BAR — A BORDERED WIDGET SO IT READS AS A REAL CONTROL, NOT A FLOATING WAVEFORM -->
					<div
						class="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-black/[0.02] p-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]"
					>
						<span
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5b8a72]/15 text-[#4f7a64] dark:text-[#83b39a]"
						>
							<Play size={13} class="fill-current" />
						</span>
						<div class="flex h-6 flex-1 items-end gap-1">
							{#each WAVE as h}
								<span class={cn('w-1.5 rounded-full bg-[#5b8a72]/45', h)}></span>
							{/each}
						</div>
						<span class="shrink-0 text-[10px] tabular-nums opacity-50">0:42</span>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- HOW IT WORKS -->
	<section id="how" class="mx-auto mt-28 w-full max-w-5xl px-5 sm:mt-32 sm:px-8">
		<!-- IN-WORLD SECTION HEADING (NOT A GENERIC "HOW IT WORKS" LABEL) -->
		<div class="mb-12 text-center">
			<p class="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b23a2e] dark:text-[#e08a63]">
				The path
			</p>
			<h2 class="font-['Literata'] text-2xl font-bold tracking-tight sm:text-3xl">
				From raw to read, in three steps
			</h2>
		</div>
		<ol class="relative grid gap-8 sm:grid-cols-3">
			<!-- CONNECTOR LINE (DESKTOP) -->
			<span class="absolute left-0 right-0 top-3.5 hidden h-px bg-black/[0.08] dark:bg-white/[0.08] sm:block"
			></span>
			{#each STEPS as step, i}
				<li
					use:reveal={{ delay: i * 90 }}
					class="relative flex flex-col items-center text-center transition duration-700 ease-out sm:items-start sm:text-left"
				>
					<div class="mb-4 flex items-center gap-3">
						<span
							class="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-black/[0.03] text-xs font-bold tabular-nums opacity-80 dark:border-white/[0.12] dark:bg-white/[0.05]"
							>{i + 1}</span
						>
						<svelte:component this={step.icon} size={18} class="text-[#b23a2e] dark:text-[#e08a63]" />
					</div>
					<h3 class="text-base font-semibold">{step.title}</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">{step.blurb}</p>
				</li>
			{/each}
		</ol>
	</section>

	<!-- INK-WASH DIVIDER BEFORE THE CLOSING INVITATION -->
	<div class="mx-auto mt-28 w-full max-w-3xl px-5 sm:mt-32 sm:px-8"><InkDivider /></div>
	<!-- CLOSING CTA — ELEVATED ACCENT PANEL -->
	<section class="mx-auto mt-14 w-full max-w-5xl px-5 sm:px-8">
		<div
			use:reveal
			class="relative overflow-hidden rounded-3xl border border-[#c0392b]/20 bg-[#c0392b]/[0.06] px-6 py-14 text-center transition duration-700 ease-out sm:px-12 sm:py-16"
		>
			<h2 class="text-balance font-[Literata,Georgia,serif] text-3xl font-bold tracking-tight sm:text-4xl">
				Start your private library
			</h2>
			<p class="mx-auto mt-3 max-w-md text-balance text-sm leading-relaxed opacity-65 sm:text-base">
				Bring a chapter, pick your language, and start reading in seconds. It's yours, in sync wherever you
				read.
			</p>
			<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
				{#if loggedIn}
					<Button href="/app/" variant="primary" class="px-6 py-3 text-base"
						>Open your library <ArrowRight size={18} /></Button
					>
				{:else}
					<Button href="/signup/" variant="primary" class="px-6 py-3 text-base"
						>Start reading free <ArrowRight size={18} /></Button
					>
					<Button href="/app/" class="px-5 py-3 text-base">Open the app</Button>
				{/if}
			</div>
			<!-- TINY ASSURANCES -->
			<div class="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs opacity-55">
				<span class="inline-flex items-center gap-1"
					><Check size={13} class="text-[#5b8a72]" /> Free to start</span
				>
				<span class="inline-flex items-center gap-1"
					><Check size={13} class="text-[#5b8a72]" /> Private to your account</span
				>
				<span class="inline-flex items-center gap-1"
					><Check size={13} class="text-[#5b8a72]" /> Read on any device</span
				>
			</div>
		</div>
	</section>

	<!-- FOOTER -->
	<footer class="mx-auto mt-24 w-full max-w-6xl px-5 sm:px-8">
		<!-- TOP: BRAND ON THE LEFT, NAV COLUMNS FILLING THE REMAINING WIDTH -->
		<div
			class="flex flex-col gap-12 border-t border-black/[0.06] pt-12 dark:border-white/[0.06] sm:flex-row sm:gap-20"
		>
			<!-- BRAND -->
			<div class="max-w-xs shrink-0 sm:w-64">
				<span class="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight">
					<!-- BRAND MARK — THE CINNABAR SEAL -->
					<Seal size={32} />
					Xianslate
				</span>
				<p class="mt-4 text-xs leading-relaxed opacity-55">
					A private reader for translated web novels — literary prose, a structured glossary that types and
					tracks every name, and a home for thousand-chapter binges.
				</p>
			</div>
			<!-- LINK COLUMNS — FILL THE REMAINING WIDTH; TWO COLUMNS ON MOBILE, THREE SPREAD ON DESKTOP -->
			<div class="grid flex-1 grid-cols-2 gap-x-8 gap-y-10 text-sm sm:grid-cols-3">
				<nav class="flex flex-col items-start gap-3">
					<span class={FOOTER_HEAD}>Product</span>
					<button use:ripple on:click={() => jumpTo('features')} class={FOOTER_LINK}>Features</button>
					<button use:ripple on:click={() => jumpTo('how')} class={FOOTER_LINK}>How it works</button>
				</nav>
				<nav class="flex flex-col items-start gap-3">
					<span class={FOOTER_HEAD}>Account</span>
					{#if loggedIn}
						<a href="/app/" use:ripple class={FOOTER_LINK}>Open app</a>
						<a href="/app/account/" use:ripple class={FOOTER_LINK}>Account settings</a>
					{:else}
						<a href="/login/" use:ripple class={FOOTER_LINK}>Sign in</a>
						<a href="/signup/" use:ripple class={FOOTER_LINK}>Create account</a>
					{/if}
				</nav>
			</div>
		</div>
		<!-- BOTTOM BAR: COPYRIGHT + TAGLINE (STACKED + CENTERED ON MOBILE, SPLIT ON DESKTOP) -->
		<div
			class="flex flex-col items-center gap-2 border-t border-black/[0.05] py-6 text-xs opacity-50 dark:border-white/[0.045] sm:flex-row sm:justify-between"
		>
			<span>© Xianslate</span>
			<span>Web novels that read like a real translation.</span>
		</div>
	</footer>
</div>
