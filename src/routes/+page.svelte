<script lang="ts">
	// IMPORTED DEP-COMPONENTS
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import AudioLines from 'lucide-svelte/icons/audio-lines';
	import BookMarked from 'lucide-svelte/icons/book-marked';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Globe from 'lucide-svelte/icons/globe';
	import Languages from 'lucide-svelte/icons/languages';
	import Palette from 'lucide-svelte/icons/palette';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';

	// -- TYPES -- //

	type Feature = { icon: typeof BookOpen; title: string; blurb: string };

	// -- CONSTANTS -- //

	// LANDING FEATURE HIGHLIGHTS — ONE CARD EACH
	const FEATURES: Feature[] = [
		{
			icon: Sparkles,
			title: 'Literary, not literal',
			blurb: 'A genre-aware translator re-tells each chapter the way a native novelist would — cultivation, wuxia, and romance read naturally, never as a stiff machine gloss.',
		},
		{
			icon: BookMarked,
			title: 'Consistent names & terms',
			blurb: 'Characters, realms, sects, and techniques are auto-extracted into a glossary and kept identical across every chapter you read.',
		},
		{
			icon: Languages,
			title: '30+ languages',
			blurb: 'Translate Chinese, Japanese, Korean and more into the language you read best — or keep a book in its original for distraction-free reading.',
		},
		{
			icon: Globe,
			title: 'Bring any source',
			blurb: 'Paste a web-novel chapter URL or import an EPUB or TXT file. New sites are learned automatically, with no setup required.',
		},
		{
			icon: Palette,
			title: 'Built for long reads',
			blurb: 'Five themes, adjustable fonts and spacing, side-by-side or interleaved layouts, and your place saved automatically as you scroll.',
		},
		{
			icon: AudioLines,
			title: 'Listen along',
			blurb: 'Built-in text-to-speech reads chapters aloud with word-by-word highlighting, so you can follow along hands-free.',
		},
	];
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
			<BookOpen size={22} class="text-sky-600 dark:text-sky-400" /> Xianslate
		</span>
		<Button href="/app/" variant="ghost">Open app</Button>
	</header>

	<!-- HERO -->
	<section class="flex flex-1 flex-col items-center justify-center py-16 text-center sm:py-24">
		<!-- EYEBROW BADGE -->
		<span
			class="mb-5 inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] px-3 py-1 text-xs font-medium opacity-70 dark:border-white/[0.08]"
		>
			<Sparkles size={13} class="text-sky-600 dark:text-sky-400" /> AI-powered literary translation
		</span>
		<!-- HEADLINE — THE ACCENT WORD USES A TAILWIND GRADIENT, CLIPPED TO THE TEXT -->
		<h1 class="max-w-3xl text-4xl font-black leading-[1.1] tracking-tight sm:text-6xl">
			Read web novels in
			<span class="bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">any language</span>
		</h1>
		<p class="mt-5 max-w-xl text-base leading-relaxed opacity-60 sm:text-lg">
			Xianslate turns Chinese, Japanese, and Korean web novels into fluent, consistent prose — wrapped in a reader
			built for long binge sessions.
		</p>
		<!-- PRIMARY + SECONDARY CALL TO ACTION -->
		<div class="mt-9 flex flex-wrap items-center justify-center gap-3">
			<Button href="/app/" variant="primary" class="px-6 py-3 text-base">
				Open the library <ArrowRight size={18} />
			</Button>
			<Button href="/app/glossary/" class="px-5 py-3 text-base">Global glossary</Button>
		</div>
	</section>

	<!-- FEATURE GRID: ONE COLUMN ON MOBILE, TWO ON TABLET, THREE ON DESKTOP -->
	<section class="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
		{#each FEATURES as f}
			<!-- FEATURE CARD (NON-INTERACTIVE) -->
			<div
				class="rounded-2xl border border-black/[0.08] bg-black/[0.02] p-5 dark:border-white/[0.08] dark:bg-white/[0.02]"
			>
				<div
					class="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400"
				>
					<svelte:component this={f.icon} size={20} />
				</div>
				<h3 class="text-base font-semibold">{f.title}</h3>
				<p class="mt-1.5 text-sm leading-relaxed opacity-60">{f.blurb}</p>
			</div>
		{/each}
	</section>

	<!-- FOOTER -->
	<footer class="border-t border-black/[0.06] py-6 text-center text-xs opacity-50 dark:border-white/[0.045]">
		Xianslate — your private multilingual web-novel reader
	</footer>
</div>
