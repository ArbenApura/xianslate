<script lang="ts">
	// IMPORTED ENVS
	import { browser } from '$app/environment';
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	import { reveal } from '$lib/actions/reveal';
	import { ripple } from '$lib/actions/ripple';
	import { onDestroy, onMount } from 'svelte';
	// IMPORTED DEP-COMPONENTS
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import AudioLines from 'lucide-svelte/icons/audio-lines';
	import BookMarked from 'lucide-svelte/icons/book-marked';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Check from 'lucide-svelte/icons/check';
	import Globe from 'lucide-svelte/icons/globe';
	import Languages from 'lucide-svelte/icons/languages';
	import Link2 from 'lucide-svelte/icons/link-2';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Volume2 from 'lucide-svelte/icons/volume-2';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';

	// -- TYPES -- //

	type Step = { icon: typeof BookOpen; title: string; blurb: string };

	// -- CONSTANTS -- //

	// TWO REPRESENTATIVE SWATCHES (ONE LIGHT, ONE DARK) + A "+" — SHOWING ALL THEMES READS AS DUPLICATES
	// (dark / oled / contrast ARE ALL NEAR-BLACK), AND THEMES ARE BECOMING FULLY CUSTOMIZABLE (CUSTOM
	// BACKGROUND / TEXT), SO A FIXED COUNT WOULD BE WRONG.
	const THEME_SWATCHES = [
		{ name: 'Sepia', cls: 'bg-[#f4ecd8] border-[#cbb98f]' },
		{ name: 'Dark', cls: 'bg-[#0e131c] border-white/20' },
	];
	// A SMALL, CONCRETE SAMPLE OF SUPPORTED LANGUAGES (ENDONYMS READ AS A WORLD MAP AT A GLANCE).
	const LANGS = ['English', '中文', '日本語', '한국어', 'Español', 'Français', 'Deutsch', 'Tiếng Việt', 'العربية'];
	// MINI WAVEFORM BARS FOR THE READ-ALOUD TILE — LITERAL HEIGHTS SO NO RUNTIME CLASS CONSTRUCTION.
	const WAVE = ['h-2', 'h-4', 'h-6', 'h-3', 'h-5', 'h-7', 'h-4', 'h-2', 'h-5', 'h-3', 'h-6', 'h-4'];

	// THREE-STEP "HOW IT WORKS" STRIP
	const STEPS: Step[] = [
		{
			icon: Link2,
			title: 'Add a source',
			blurb: 'Paste a chapter URL, or import an EPUB or TXT file into your library.',
		},
		{
			icon: Sparkles,
			title: 'We translate it',
			blurb: 'A genre-aware model re-tells it in fluent prose and keeps names consistent via an auto glossary.',
		},
		{
			icon: BookOpen,
			title: 'Read your way',
			blurb: 'Pick a theme and typeface, go bilingual or single-language, or listen aloud.',
		},
	];

	// -- STATES -- //

	// THE STICKY NAV STAYS TRANSPARENT OVER THE HERO, THEN GAINS A BLURRED BACKDROP ONCE THE PAGE SCROLLS.
	let scrolled = false;

	// -- FUNCTIONS -- //

	function onScroll() {
		scrolled = window.scrollY > 8;
	}

	// SMOOTH IN-PAGE JUMP FOR THE NAV ANCHORS (THE DOCUMENT SCROLLER ISN'T scroll-smooth BY DEFAULT).
	function jumpTo(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
	<title>Xianslate — read web novels in any language</title>
	<meta
		name="description"
		content="Xianslate translates Chinese, Japanese, and Korean web novels into fluent, consistent prose, with a beautiful reader built for long binge sessions."
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
				<img src="/logo.svg" alt="" class="h-7 w-7 rounded-[7px]" /> Xianslate
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
			<!-- ACCOUNT ENTRY -->
			<div class="flex items-center gap-1.5">
				<Button href="/login/" variant="ghost">Sign in</Button>
				<Button href="/app/" variant="primary">Open app</Button>
			</div>
		</div>
	</header>

	<!-- HERO -->
	<section class="mx-auto w-full max-w-5xl px-5 pt-14 text-center sm:px-8 sm:pt-20">
		<!-- EYEBROW WITH A LIVE DOT -->
		<span
			class="mb-6 inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-black/[0.02] px-3.5 py-1.5 text-xs font-medium opacity-80 dark:border-white/[0.08] dark:bg-white/[0.03]"
		>
			<span class="relative flex h-1.5 w-1.5">
				<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500 opacity-75"></span>
				<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500"></span>
			</span>
			AI literary translation for web novels
		</span>
		<!-- HEADLINE — Literata (THE READER'S OWN SERIF). SOLID ACCENT, NO GRADIENT HAZE. text-balance EVENS BREAKS. -->
		<h1
			class="mx-auto max-w-3xl text-balance font-[Literata,Georgia,serif] text-[2.7rem] font-bold leading-[1.06] tracking-tight sm:text-6xl md:text-[4.25rem]"
		>
			Read web novels in <span class="text-sky-600 dark:text-sky-400">any language</span>
		</h1>
		<p class="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed opacity-65 sm:text-lg">
			Xianslate re-tells Chinese, Japanese, and Korean web novels as fluent, consistent prose — wrapped in a
			reader built for long binge sessions.
		</p>
		<!-- CALL TO ACTION -->
		<div class="mt-9 flex flex-wrap items-center justify-center gap-3">
			<Button href="/app/" variant="primary" class="px-6 py-3 text-base">
				Open the library <ArrowRight size={18} />
			</Button>
			<Button href="/signup/" class="px-5 py-3 text-base">Create a free account</Button>
		</div>
		<p class="mt-6 text-xs tracking-wide opacity-50">Free to start · No credit card · 30+ languages</p>
	</section>

	<!-- PRODUCT HERO — A LAYERED READER PANE WITH FLOATING ACCENT CARDS (DEPTH, NOT A FLAT MOCKUP) -->
	<div class="mx-auto mt-16 w-full max-w-3xl px-5 sm:mt-20 sm:px-8">
		<div use:reveal class="relative transition duration-700 ease-out">
			<!-- MAIN READER WINDOW -->
			<div
				class="overflow-hidden rounded-2xl border border-black/[0.09] bg-black/[0.02] shadow-2xl shadow-black/10 dark:border-white/[0.09] dark:bg-white/[0.03]"
			>
				<!-- WINDOW CHROME -->
				<div class="flex items-center gap-2 border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.045]">
					<span class="flex gap-1.5">
						<span class="h-2.5 w-2.5 rounded-full bg-black/15 dark:bg-white/15"></span>
						<span class="h-2.5 w-2.5 rounded-full bg-black/15 dark:bg-white/15"></span>
						<span class="h-2.5 w-2.5 rounded-full bg-black/15 dark:bg-white/15"></span>
					</span>
					<span class="mx-auto inline-flex items-center gap-1.5 text-xs font-medium opacity-55">
						<BookOpen size={13} class="text-sky-600 dark:text-sky-400" /> Chapter 5 · The Sword Returns
					</span>
				</div>
				<!-- BILINGUAL BODY -->
				<div class="grid gap-5 p-6 sm:grid-cols-2 sm:gap-8">
					<div>
						<span class="mb-2 block text-[10px] font-semibold uppercase tracking-widest opacity-40"
							>Original · 中文</span
						>
						<p class="text-[15px] leading-loose opacity-55">
							他抬手一剑，星河为之倒卷，万剑归宗，尽数没入剑鞘。少年立于绝峰之巅，衣袂翻飞，目光淡漠如初雪。
						</p>
					</div>
					<div>
						<span
							class="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-sky-600/70 dark:text-sky-400/70"
							>Translation · English</span
						>
						<p class="font-[Literata,Georgia,serif] text-[15px] leading-loose">
							He raised his hand and loosed a single stroke — the galaxy reversed its course, and the
							Myriad Swords returned to their source, sheathing as one. The youth stood atop the lone
							summit, his gaze as cold and distant as first snow.
						</p>
					</div>
				</div>
			</div>

			<!-- FLOATING CARD: GLOSSARY (TOP-RIGHT, DESKTOP ONLY) -->
			<div
				class="absolute -right-6 -top-6 hidden w-56 rotate-2 rounded-xl border border-black/[0.08] bg-white/80 p-3 shadow-xl shadow-black/10 backdrop-blur dark:border-white/[0.1] dark:bg-[#161d29]/90 lg:block"
			>
				<span class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold opacity-60"
					><BookMarked size={12} class="text-violet-500" /> Auto glossary</span
				>
				<div class="space-y-1.5 text-[11px]">
					<p class="flex items-center justify-between gap-2">
						<span class="opacity-60">万剑归宗</span><span class="font-medium text-sky-600 dark:text-sky-300"
							>Myriad Sword Convergence</span
						>
					</p>
					<p class="flex items-center justify-between gap-2">
						<span class="opacity-60">剑鞘</span><span class="font-medium text-sky-600 dark:text-sky-300"
							>scabbard</span
						>
					</p>
				</div>
			</div>

			<!-- FLOATING CARD: THEMES (BOTTOM-LEFT, DESKTOP ONLY) -->
			<div
				class="absolute -bottom-6 -left-6 hidden -rotate-2 rounded-xl border border-black/[0.08] bg-white/80 p-3 shadow-xl shadow-black/10 backdrop-blur dark:border-white/[0.1] dark:bg-[#161d29]/90 lg:block"
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
				class="absolute -left-4 top-12 hidden items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[11px] font-medium shadow-lg shadow-black/10 backdrop-blur dark:border-white/[0.1] dark:bg-[#161d29]/90 xl:flex"
			>
				<Volume2 size={12} class="text-sky-600 dark:text-sky-400" /> Reading aloud
			</div>
		</div>
	</div>

	<!-- BENTO FEATURE GRID — VARIED TILE SIZES, EACH WITH A REAL MINI-VISUAL (NOT A FLAT ICON LIST) -->
	<section id="features" class="mx-auto mt-28 w-full max-w-6xl px-5 sm:mt-32 sm:px-8">
		<div use:reveal class="mb-10 text-center transition duration-700 ease-out">
			<h2 class="text-balance font-[Literata,Georgia,serif] text-3xl font-bold tracking-tight sm:text-4xl">
				Everything a serious reader wants
			</h2>
			<p class="mx-auto mt-3 max-w-lg text-balance text-sm leading-relaxed opacity-60 sm:text-base">
				Faithful prose, consistent names, and a reader you'll happily disappear into for hours.
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
						class="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400"
					>
						<Sparkles size={20} />
					</div>
					<h3 class="text-lg font-semibold">Literary, not literal</h3>
					<p class="mt-1.5 max-w-md text-sm leading-relaxed opacity-60">
						A genre-aware translator re-tells each chapter the way a native novelist would — cultivation,
						wuxia, and romance read naturally, never as a stiff machine gloss.
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
					class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
				>
					<Languages size={20} />
				</div>
				<div>
					<h3 class="text-base font-semibold">30+ languages</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">
						Read in the language you know best — or keep a book in its original.
					</p>
				</div>
				<div class="flex flex-wrap gap-1.5">
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
					class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"
				>
					<BookMarked size={20} />
				</div>
				<div>
					<h3 class="text-base font-semibold">Consistent names & terms</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">
						Characters, realms, and techniques stay identical across every chapter.
					</p>
				</div>
				<div class="space-y-1.5 text-xs">
					<p
						class="flex items-center justify-between gap-2 rounded-md bg-black/[0.03] px-2 py-1 dark:bg-white/[0.04]"
					>
						<span class="opacity-60">叶凡</span><span class="font-medium text-sky-600 dark:text-sky-300"
							>Ye Fan</span
						>
					</p>
					<p
						class="flex items-center justify-between gap-2 rounded-md bg-black/[0.03] px-2 py-1 dark:bg-white/[0.04]"
					>
						<span class="opacity-60">大帝</span><span class="font-medium text-sky-600 dark:text-sky-300"
							>Great Emperor</span
						>
					</p>
				</div>
			</div>

			<!-- ANY SOURCE -->
			<div
				use:reveal={{ delay: 70 }}
				class="group flex flex-col gap-4 rounded-2xl border border-black/[0.08] bg-black/[0.02] p-6 transition duration-700 ease-out hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[0.08] dark:bg-white/[0.02]"
			>
				<div
					class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400"
				>
					<Globe size={20} />
				</div>
				<div>
					<h3 class="text-base font-semibold">Bring any source</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">
						Paste a chapter URL or import a file — new sites are learned automatically.
					</p>
				</div>
				<div class="flex flex-wrap gap-2 text-xs font-medium">
					<span class="rounded-md bg-sky-500/10 px-2 py-1 text-sky-700 dark:text-sky-300">Chapter URL</span>
					<span class="rounded-md bg-black/[0.05] px-2 py-1 opacity-70 dark:bg-white/[0.06]">EPUB</span>
					<span class="rounded-md bg-black/[0.05] px-2 py-1 opacity-70 dark:bg-white/[0.06]">TXT</span>
				</div>
			</div>

			<!-- LISTEN -->
			<div
				use:reveal={{ delay: 140 }}
				class="group flex flex-col gap-4 rounded-2xl border border-black/[0.08] bg-black/[0.02] p-6 transition duration-700 ease-out hover:-translate-y-0.5 hover:shadow-lg dark:border-white/[0.08] dark:bg-white/[0.02]"
			>
				<div
					class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
				>
					<AudioLines size={20} />
				</div>
				<div>
					<h3 class="text-base font-semibold">Listen along</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">
						Text-to-speech reads aloud with word-by-word highlighting.
					</p>
				</div>
				<!-- MINI WAVEFORM -->
				<div class="flex h-8 items-end gap-1">
					{#each WAVE as h}
						<span class={cn('w-1.5 rounded-full bg-cyan-500/40', h)}></span>
					{/each}
				</div>
			</div>
		</div>
	</section>

	<!-- HOW IT WORKS -->
	<section id="how" class="mx-auto mt-28 w-full max-w-5xl px-5 sm:mt-32 sm:px-8">
		<h2 class="mb-10 text-center text-xs font-semibold uppercase tracking-widest opacity-50">How it works</h2>
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
						<svelte:component this={step.icon} size={18} class="text-sky-600 dark:text-sky-400" />
					</div>
					<h3 class="text-base font-semibold">{step.title}</h3>
					<p class="mt-1.5 text-sm leading-relaxed opacity-60">{step.blurb}</p>
				</li>
			{/each}
		</ol>
	</section>

	<!-- CLOSING CTA — ELEVATED ACCENT PANEL -->
	<section class="mx-auto mt-28 w-full max-w-5xl px-5 sm:mt-32 sm:px-8">
		<div
			use:reveal
			class="relative overflow-hidden rounded-3xl border border-sky-500/20 bg-sky-500/[0.06] px-6 py-14 text-center transition duration-700 ease-out sm:px-12 sm:py-16"
		>
			<h2 class="text-balance font-[Literata,Georgia,serif] text-3xl font-bold tracking-tight sm:text-4xl">
				Start your private library
			</h2>
			<p class="mx-auto mt-3 max-w-md text-balance text-sm leading-relaxed opacity-65 sm:text-base">
				Bring a chapter, pick your language, and start reading in seconds. It's yours, in sync wherever you
				read.
			</p>
			<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
				<Button href="/app/" variant="primary" class="px-6 py-3 text-base"
					>Open the library <ArrowRight size={18} /></Button
				>
				<Button href="/signup/" class="px-5 py-3 text-base">Create a free account</Button>
			</div>
			<!-- TINY ASSURANCES -->
			<div class="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs opacity-55">
				<span class="inline-flex items-center gap-1"
					><Check size={13} class="text-emerald-500" /> Free to start</span
				>
				<span class="inline-flex items-center gap-1"
					><Check size={13} class="text-emerald-500" /> Private to your account</span
				>
				<span class="inline-flex items-center gap-1"
					><Check size={13} class="text-emerald-500" /> Read on any device</span
				>
			</div>
		</div>
	</section>

	<!-- FOOTER -->
	<footer class="mx-auto mt-24 w-full max-w-6xl px-5 sm:px-8">
		<div
			class="flex flex-col gap-8 border-t border-black/[0.07] py-10 dark:border-white/[0.06] sm:flex-row sm:items-start sm:justify-between"
		>
			<!-- BRAND -->
			<div class="max-w-xs">
				<span class="inline-flex items-center gap-2 text-base font-bold tracking-tight">
					<img src="/logo.svg" alt="" class="h-6 w-6 rounded-md" /> Xianslate
				</span>
				<p class="mt-3 text-xs leading-relaxed opacity-55">
					Your private, multilingual web-novel reader — literary translation, a consistent glossary, and a
					reader built for the long haul.
				</p>
			</div>
			<!-- LINK COLUMNS -->
			<div class="flex gap-14 text-sm">
				<div class="flex flex-col gap-2.5">
					<span class="text-xs font-semibold uppercase tracking-wider opacity-40">Product</span>
					<button
						use:ripple
						on:click={() => jumpTo('features')}
						class="rounded text-left opacity-70 hover:opacity-100">Features</button
					>
					<button
						use:ripple
						on:click={() => jumpTo('how')}
						class="rounded text-left opacity-70 hover:opacity-100">How it works</button
					>
				</div>
				<div class="flex flex-col gap-2.5">
					<span class="text-xs font-semibold uppercase tracking-wider opacity-40">Account</span>
					<a href="/login/" use:ripple class="rounded opacity-70 hover:opacity-100">Sign in</a>
					<a href="/signup/" use:ripple class="rounded opacity-70 hover:opacity-100">Create account</a>
				</div>
			</div>
		</div>
		<p class="border-t border-black/[0.05] py-5 text-center text-xs opacity-45 dark:border-white/[0.045]">
			© Xianslate — read web novels in any language.
		</p>
	</footer>
</div>
