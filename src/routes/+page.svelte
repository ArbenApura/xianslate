<script lang="ts">
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import AudioLines from 'lucide-svelte/icons/audio-lines';
	import BookMarked from 'lucide-svelte/icons/book-marked';
	import BookOpen from 'lucide-svelte/icons/book-open';
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

	// LANDING FEATURE HIGHLIGHTS — ONE CARD EACH. tile IS A COMPLETE-LITERAL ACCENT CLASS (KEEPS cn()/TAILWIND
	// HAPPY) AND USES /10 TINTS + dark: TEXT SO EACH ICON CHIP READS ON EVERY THEME.
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

	// QUICK FACTS — PLAIN, VERIFIABLE PRODUCT CLAIMS (NO INVENTED SOCIAL PROOF)
	const FACTS = ['30+ languages', '5 reading themes', 'EPUB · TXT · URL', 'Read-aloud', 'Auto glossary'];
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
			<!-- BRAND MARK (static/logo.svg) — THE GRADIENT TILE IS THEME-INDEPENDENT; THE WORDMARK INHERITS THEME TEXT -->
			<img src="/logo.svg" alt="" class="h-7 w-7 rounded-[7px]" /> Xianslate
		</span>
		<div class="flex items-center gap-1.5">
			<Button href="/login/" variant="ghost">Sign in</Button>
			<Button href="/app/" variant="primary">Open app</Button>
		</div>
	</header>

	<!-- HERO — relative + isolate + overflow-hidden GIVES THE AMBIENT GLOW ITS OWN CLIPPED STACKING CONTEXT -->
	<section
		class="relative isolate flex flex-1 flex-col items-center justify-center overflow-hidden py-16 text-center sm:py-24"
	>
		<!-- AMBIENT GLOW (DECORATIVE) — TRANSLUCENT ACCENT BLOBS READ OVER ANY THEME BACKGROUND -->
		<div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
			<div
				class="absolute -top-20 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-sky-500/20 to-indigo-500/20 blur-3xl"
			></div>
			<div
				class="absolute right-2 top-44 h-56 w-56 rounded-full bg-gradient-to-br from-violet-500/15 to-fuchsia-500/10 blur-3xl"
			></div>
			<div
				class="absolute -left-10 top-56 h-56 w-56 rounded-full bg-gradient-to-br from-emerald-500/10 to-teal-500/10 blur-3xl"
			></div>
		</div>
		<!-- EYEBROW BADGE -->
		<span
			class="mb-5 inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.02] px-3 py-1 text-xs font-medium opacity-80 backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.03]"
		>
			<Sparkles size={13} class="text-sky-600 dark:text-sky-400" /> AI-powered literary translation
		</span>
		<!-- HEADLINE — THE ACCENT WORD USES A TAILWIND GRADIENT, CLIPPED TO THE TEXT -->
		<h1 class="max-w-3xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
			Read web novels in
			<span class="bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">any language</span>
		</h1>
		<p class="mt-5 max-w-xl text-base leading-relaxed opacity-70 sm:text-lg">
			Xianslate turns Chinese, Japanese, and Korean web novels into fluent, consistent prose — wrapped in a reader
			built for long binge sessions.
		</p>
		<!-- PRIMARY + SECONDARY CALL TO ACTION -->
		<div class="mt-9 flex flex-wrap items-center justify-center gap-3">
			<Button href="/app/" variant="primary" class="px-6 py-3 text-base">
				Open the library <ArrowRight size={18} />
			</Button>
			<Button href="/signup/" class="px-5 py-3 text-base">Create a free account</Button>
		</div>
		<!-- QUICK FACTS STRIP -->
		<ul class="mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-xs">
			{#each FACTS as fact}
				<li class="rounded-full border border-black/[0.06] px-3 py-1 opacity-60 dark:border-white/[0.06]">
					{fact}
				</li>
			{/each}
		</ul>
	</section>

	<!-- HOW IT WORKS: STACKED ON MOBILE, THREE ACROSS ON TABLET+ -->
	<section class="border-t border-black/[0.06] py-14 dark:border-white/[0.045]">
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
		class="grid gap-4 border-t border-black/[0.06] py-14 dark:border-white/[0.045] sm:grid-cols-2 lg:grid-cols-3"
	>
		{#each FEATURES as f}
			<!-- FEATURE CARD (NON-INTERACTIVE) — SUBTLE LIFT + RING ON HOVER -->
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
	<section class="border-t border-black/[0.06] py-16 text-center dark:border-white/[0.045]">
		<h2 class="text-2xl font-bold tracking-tight sm:text-3xl">Start your private library</h2>
		<p class="mx-auto mt-3 max-w-md text-sm leading-relaxed opacity-60">
			Bring a chapter, pick your language, and start reading in seconds. It's yours, kept in sync wherever you
			read.
		</p>
		<div class="mt-7 flex flex-wrap items-center justify-center gap-3">
			<Button href="/app/" variant="primary" class="px-6 py-3 text-base"
				>Open the library <ArrowRight size={18} /></Button
			>
			<Button href="/app/glossary/" class="px-5 py-3 text-base">Global glossary</Button>
		</div>
	</section>

	<!-- FOOTER -->
	<footer
		class="flex flex-col items-center justify-between gap-3 border-t border-black/[0.06] py-6 text-xs opacity-60 dark:border-white/[0.045] sm:flex-row"
	>
		<span>Xianslate — your private multilingual web-novel reader</span>
		<nav class="flex items-center gap-1">
			<a href="/app/" use:ripple class="rounded-md px-2 py-1 hover:opacity-100">Library</a>
			<a href="/app/glossary/" use:ripple class="rounded-md px-2 py-1 hover:opacity-100">Glossary</a>
			<a href="/login/" use:ripple class="rounded-md px-2 py-1 hover:opacity-100">Sign in</a>
		</nav>
	</footer>
</div>
