<script lang="ts">
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import AudioLines from 'lucide-svelte/icons/audio-lines';
	import BookMarked from 'lucide-svelte/icons/book-marked';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Clock from 'lucide-svelte/icons/clock';
	import Globe from 'lucide-svelte/icons/globe';
	import Languages from 'lucide-svelte/icons/languages';
	import Link2 from 'lucide-svelte/icons/link-2';
	import Palette from 'lucide-svelte/icons/palette';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';

	// -- TYPES -- //

	type Feature = { icon: typeof BookOpen; title: string; blurb: string; tile: string };
	type Step = { icon: typeof BookOpen; title: string; blurb: string };

	// -- CONSTANTS -- //

	// FEATURE HIGHLIGHTS — tile IS A COMPLETE-LITERAL ACCENT CLASS (/10 TINT + dark: TEXT, READS ON EVERY THEME).
	const FEATURES: Feature[] = [
		{
			icon: Sparkles,
			title: 'Literary, not literal',
			blurb: 'A genre-aware translator re-tells each chapter the way a native novelist would — cultivation, wuxia, and romance read naturally, never as a stiff machine gloss.',
			tile: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
		},
		{
			icon: BookMarked,
			title: 'Consistent names & terms',
			blurb: 'Characters, realms, sects, and techniques are auto-extracted into a glossary and kept identical across every chapter you read.',
			tile: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
		},
		{
			icon: Languages,
			title: '30+ languages',
			blurb: 'Translate Chinese, Japanese, Korean and more into the language you read best — or keep a book in its original for distraction-free reading.',
			tile: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
		},
		{
			icon: Globe,
			title: 'Bring any source',
			blurb: 'Paste a web-novel chapter URL or import an EPUB or TXT file. New sites are learned automatically, with no setup required.',
			tile: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
		},
		{
			icon: Palette,
			title: 'Built for long reads',
			blurb: 'Five themes, adjustable fonts and spacing, side-by-side or interleaved layouts, and your place saved automatically as you scroll.',
			tile: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
		},
		{
			icon: AudioLines,
			title: 'Listen along',
			blurb: 'Built-in text-to-speech reads chapters aloud with word-by-word highlighting, so you can follow along hands-free.',
			tile: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
		},
	];

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

	// PLAIN, VERIFIABLE PRODUCT FACTS — RENDERED AS ONE QUIET LINE (NO PILL CLUTTER)
	const FACTS = '30+ languages · 5 reading themes · EPUB · TXT · URL · Read-aloud';
</script>

<svelte:head>
	<title>Xianslate — read web novels in any language</title>
	<meta
		name="description"
		content="Xianslate translates Chinese, Japanese, and Korean web novels into fluent, consistent prose, with a beautiful reader built for binge sessions."
	/>
</svelte:head>

<!-- LANDING SHELL — INHERITS THE THEMED BACKGROUND/FOREGROUND FROM THE LAYOUT ROOT -->
<div class="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 sm:px-8">
	<!-- TOP BAR: BRAND + APP ENTRY -->
	<header class="flex items-center justify-between py-5">
		<span class="inline-flex items-center gap-2 text-lg font-bold">
			<!-- BRAND MARK (static/logo.svg) — THE TILE IS THEME-INDEPENDENT; THE WORDMARK INHERITS THEME TEXT -->
			<img src="/logo.svg" alt="" class="h-7 w-7 rounded-[7px]" /> Xianslate
		</span>
		<div class="flex items-center gap-1.5">
			<Button href="/login/" variant="ghost">Sign in</Button>
			<Button href="/app/" variant="primary">Open app</Button>
		</div>
	</header>

	<!-- HERO — EDITORIAL: SERIF HEADLINE (THE READER'S OWN TYPEFACE), ONE SOLID ACCENT, NO BACKGROUND HAZE.
	     TOP-ALIGNED (NOT FORCED FULL-HEIGHT) SO THE PAGE READS AS A COMPOSED STORY, NOT A CENTERED VOID. -->
	<section class="flex flex-col items-center pt-10 text-center sm:pt-16">
		<!-- EYEBROW -->
		<span
			class="mb-6 inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] px-3 py-1 text-xs font-medium opacity-70 dark:border-white/[0.08]"
		>
			<Sparkles size={13} class="text-sky-600 dark:text-sky-400" /> AI literary translation for web novels
		</span>
		<!-- HEADLINE — Literata (THE DEFAULT READING SERIF) SO THE LANDING FEELS LIKE THE PRODUCT. text-balance
		     EVENS THE LINE BREAKS. THE ACCENT IS A SOLID BRAND BLUE, NOT A GRADIENT THAT FIGHTS THE WARM THEMES. -->
		<h1
			class="max-w-3xl text-balance font-[Literata,Georgia,serif] text-[2.6rem] font-bold leading-[1.08] tracking-tight sm:text-6xl"
		>
			Read web novels in <span class="text-sky-600 dark:text-sky-400">any language</span>
		</h1>
		<p class="mt-5 max-w-xl text-balance text-base leading-relaxed opacity-65 sm:text-lg">
			Xianslate turns Chinese, Japanese, and Korean web novels into fluent, consistent prose — wrapped in a reader
			built for long binge sessions.
		</p>
		<!-- PRIMARY + SECONDARY CALL TO ACTION -->
		<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
			<Button href="/app/" variant="primary" class="px-6 py-3 text-base">
				Open the library <ArrowRight size={18} />
			</Button>
			<Button href="/signup/" class="px-5 py-3 text-base">Create a free account</Button>
		</div>
		<!-- QUIET TRUST LINE -->
		<p class="mt-6 text-xs tracking-wide opacity-50">{FACTS}</p>
	</section>

	<!-- READER PREVIEW — SHOW, DON'T TELL: A REAL BILINGUAL EXCERPT STYLED LIKE THE READER, SO THE FIRST THING
	     A VISITOR SEES IS THE ACTUAL OUTPUT (LITERARY TRANSLATION + GLOSSARY), NOT A STOCK GRADIENT. -->
	<div class="mx-auto mt-12 w-full max-w-2xl sm:mt-16">
		<div
			class="overflow-hidden rounded-2xl border border-black/[0.08] bg-black/[0.02] shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]"
		>
			<!-- FAUX READER HEADER -->
			<div
				class="flex items-center justify-between gap-2 border-b border-black/[0.06] px-5 py-3 dark:border-white/[0.045]"
			>
				<span class="inline-flex items-center gap-2 text-sm font-medium opacity-75">
					<BookOpen size={15} class="text-sky-600 dark:text-sky-400" /> Chapter 5 · The Sword Returns
				</span>
				<span class="hidden items-center gap-1 text-xs opacity-45 sm:inline-flex">
					<Clock size={12} /> 4 min read
				</span>
			</div>
			<!-- BILINGUAL BODY: STACKED ON MOBILE, SOURCE | TRANSLATION ON DESKTOP -->
			<div class="grid gap-5 p-5 sm:grid-cols-2 sm:gap-8">
				<!-- ORIGINAL (SOURCE) — DIMMED; SYSTEM CJK FONT RENDERS THE HANZI -->
				<div>
					<span class="mb-2 block text-[10px] font-semibold uppercase tracking-widest opacity-40"
						>Original · 中文</span
					>
					<p class="text-[15px] leading-loose opacity-55">
						他抬手一剑，星河为之倒卷，万剑归宗，尽数没入剑鞘。少年立于绝峰之巅，衣袂翻飞，目光淡漠如初雪。
					</p>
				</div>
				<!-- TRANSLATION — IN THE READING SERIF, FULL CONTRAST -->
				<div>
					<span
						class="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-sky-600/70 dark:text-sky-400/70"
						>Translation · English</span
					>
					<p class="font-[Literata,Georgia,serif] text-[15px] leading-loose">
						He raised his hand and loosed a single stroke — the galaxy reversed its course, and the Myriad
						Swords returned to their source, sheathing as one. The youth stood atop the lone summit, robes
						snapping in the wind, his gaze as cold and distant as first snow.
					</p>
				</div>
			</div>
			<!-- GLOSSARY ROW — THE TERMS THE TRANSLATOR KEEPS CONSISTENT CHAPTER TO CHAPTER -->
			<div
				class="flex flex-wrap items-center gap-2 border-t border-black/[0.06] px-5 py-3 text-xs dark:border-white/[0.045]"
			>
				<span class="opacity-40">Glossary</span>
				<span class="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300"
					>万剑归宗 → Myriad Sword Convergence</span
				>
				<span class="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-700 dark:text-violet-300"
					>剑鞘 → scabbard</span
				>
			</div>
		</div>
	</div>

	<!-- HOW IT WORKS: STACKED ON MOBILE, THREE ACROSS ON TABLET+ -->
	<section class="mt-20 border-t border-black/[0.06] pt-14 dark:border-white/[0.045]">
		<h2 class="mb-8 text-center text-xs font-semibold uppercase tracking-widest opacity-50">How it works</h2>
		<ol class="grid gap-6 sm:grid-cols-3">
			{#each STEPS as step, i}
				<li class="flex flex-col items-center text-center sm:items-start sm:text-left">
					<!-- STEP NUMBER + ICON -->
					<div class="mb-3 flex items-center gap-2.5">
						<span
							class="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-xs font-bold tabular-nums opacity-70 dark:border-white/[0.12]"
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

	<!-- FEATURE GRID: ONE COLUMN ON MOBILE, TWO ON TABLET, THREE ON DESKTOP -->
	<section
		class="mt-14 grid gap-4 border-t border-black/[0.06] pt-14 dark:border-white/[0.045] sm:grid-cols-2 lg:grid-cols-3"
	>
		{#each FEATURES as f}
			<!-- FEATURE CARD (NON-INTERACTIVE) — SUBTLE LIFT ON HOVER -->
			<div
				class="group rounded-2xl border border-black/[0.08] bg-black/[0.02] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-black/[0.12] hover:shadow-lg dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:border-white/[0.14]"
			>
				<div class={cn('mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl', f.tile)}>
					<svelte:component this={f.icon} size={20} />
				</div>
				<h3 class="text-base font-semibold">{f.title}</h3>
				<p class="mt-1.5 text-sm leading-relaxed opacity-60">{f.blurb}</p>
			</div>
		{/each}
	</section>

	<!-- CLOSING CALL TO ACTION -->
	<section class="mt-14 border-t border-black/[0.06] py-16 text-center dark:border-white/[0.045]">
		<h2 class="text-balance font-[Literata,Georgia,serif] text-2xl font-bold tracking-tight sm:text-3xl">
			Start your private library
		</h2>
		<p class="mx-auto mt-3 max-w-md text-balance text-sm leading-relaxed opacity-60">
			Bring a chapter, pick your language, and start reading in seconds. It's yours, kept in sync wherever you
			read.
		</p>
		<div class="mt-7 flex flex-wrap items-center justify-center gap-3">
			<Button href="/app/" variant="primary" class="px-6 py-3 text-base"
				>Open the library <ArrowRight size={18} /></Button
			>
			<Button href="/signup/" class="px-5 py-3 text-base">Create a free account</Button>
		</div>
	</section>

	<!-- FOOTER -->
	<footer
		class="mt-auto flex flex-col items-center justify-between gap-3 border-t border-black/[0.06] py-6 text-xs opacity-60 dark:border-white/[0.045] sm:flex-row"
	>
		<span>Xianslate — your private multilingual web-novel reader</span>
		<nav class="flex items-center gap-1">
			<a href="/login/" use:ripple class="rounded-md px-2 py-1 hover:opacity-100">Sign in</a>
			<a href="/signup/" use:ripple class="rounded-md px-2 py-1 hover:opacity-100">Create account</a>
		</nav>
	</footer>
</div>
