<script lang="ts">
	// A PARAGRAPH RENDERED AS INDIVIDUAL WORD/SPACE SPANS SO TTS CAN TINT THE CURRENT SENTENCE AND
	// BRIGHTEN THE CURRENT WORD. TOKENS CARRY THE SAME INLINE TAGS renderMarkup WOULD APPLY, SO STYLING
	// (BOLD GLOSSARY TERMS, ITALICS, code…) IS PRESERVED. WHEN THIS PARAGRAPH ISN'T THE ACTIVE ONE THE
	// SPANS RENDER WITH NO HIGHLIGHT — CHEAP ENOUGH TO LEAVE IN PLACE, AND IT KEEPS CLICK-TO-SEEK LIVE.
	//
	// NOTE: THE HIGHLIGHT CLASSES ARE COMPUTED INLINE AGAINST REACTIVE PROPS (NOT VIA HELPER FUNCTIONS)
	// SO Svelte TRACKS sentStart/wordStart AS DEPENDENCIES AND ACTUALLY RE-RENDERS ON EACH BOUNDARY.
	import { createEventDispatcher } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import { parseRuns, tokenize, type Token } from '$lib/tts/text';
	import { renderMarkup } from '$lib/markup';

	// -- REQUIRED PROPS -- //

	export let text: string;
	export let index: number;

	// -- OPTIONAL PROPS -- //

	export let active = false;
	export let sentStart = -1;
	export let sentEnd = -1;
	export let wordStart = -1;
	export let wordEnd = -1;
	export let highlightSentence = true;
	export let highlightWord = true;

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher<{ seek: { index: number; offset: number } }>();

	// MAP INLINE TAGS TO THE STYLING renderMarkup'S TAGS WOULD HAVE PRODUCED BY DEFAULT
	const TAG_CLASS: Record<string, string> = {
		b: 'font-bold',
		strong: 'font-bold',
		i: 'italic',
		em: 'italic',
		u: 'underline',
		s: 'line-through',
		del: 'line-through',
		mark: 'rounded bg-yellow-300/40 px-0.5',
		code: 'rounded bg-black/5 px-1 font-mono text-[0.92em] dark:bg-white/10',
		sub: 'align-sub text-[0.8em]',
		sup: 'align-super text-[0.8em]',
	};

	// -- REACTIVE STATES -- //

	$: tokens = tokenize(parseRuns(renderMarkup(text)));
	// GATE FLAGS — REFERENCED DIRECTLY IN THE TEMPLATE SO Svelte RE-EVALUATES THE SPANS WHEN THEY CHANGE
	$: sentOn = active && highlightSentence && sentStart >= 0 && sentEnd > sentStart;
	$: wordOn = active && highlightWord && wordStart >= 0 && wordEnd > wordStart;

	// -- FUNCTIONS -- //

	function tagClasses(t: Token): string {
		return t.tags.map((tag) => TAG_CLASS[tag] ?? '').join(' ');
	}

	function onClick(e: MouseEvent) {
		// DON'T HIJACK A TEXT SELECTION
		if (window.getSelection()?.toString()) return;
		const el = (e.target as HTMLElement)?.closest?.('[data-s]') as HTMLElement | null;
		if (!el) return;
		const offset = Number(el.getAttribute('data-s'));
		if (!Number.isNaN(offset)) dispatch('seek', { index, offset });
	}
</script>

<!-- PARAGRAPH SPAN — WRAPS ALL TOKEN SPANS; ACTIVATES CLICK-TO-SEEK WHEN ACTIVE -->
<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
<span class={cn('tts-para', active && 'cursor-pointer')} on:click={onClick}>
	<!-- TOKEN SPANS — EACH WORD/SPACE SPAN WITH OPTIONAL SENTENCE AND WORD HIGHLIGHT CLASSES -->
	{#each tokens as t (t.start)}
		{#if t.isBreak}
			<br />
		{:else}
			{@const inSent = sentOn && t.start >= sentStart && t.end <= sentEnd}
			{@const isWord = wordOn && t.isWord && t.start < wordEnd && t.end > wordStart}
			<span
				data-s={t.isWord ? t.start : undefined}
				class={cn(
					t.isWord &&
						'rounded-[3px] transition-[background-color,color] duration-100 ease-in',
					tagClasses(t),
					inSent &&
						'rounded-[2px] bg-[rgba(56,189,248,0.16)] dark:bg-[rgba(56,189,248,0.18)]',
					isWord &&
						// tts-word IS A JS QUERY HOOK — querySelector('.tts-word') SCROLLS TO THE ACTIVE WORD (NOT STYLING)
						'tts-word bg-[rgba(56,189,248,0.45)] shadow-[0_0_0_1px_rgba(56,189,248,0.35)] dark:bg-[rgba(56,189,248,0.52)] dark:shadow-[0_0_0_1px_rgba(56,189,248,0.5)]',
				)}>{t.text}</span
			>
		{/if}
	{/each}
</span>
