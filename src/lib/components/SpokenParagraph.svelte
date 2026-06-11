<script lang="ts">
	// A paragraph rendered as individual word/space spans so TTS can tint the current sentence and
	// brighten the current word. Tokens carry the same inline tags renderMarkup would apply, so styling
	// (bold glossary terms, italics, code…) is preserved. When this paragraph isn't the active one the
	// spans render with no highlight — cheap enough to leave in place, and it keeps click-to-seek live.
	//
	// NOTE: the highlight classes are computed inline against reactive props (not via helper functions)
	// so Svelte tracks sentStart/wordStart as dependencies and actually re-renders on each boundary.
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

	const dispatch = createEventDispatcher<{ seek: { index: number; offset: number } }>();

	// Map inline tags to the styling renderMarkup's tags would have produced by default.
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
	// Gate flags — referenced directly in the template so Svelte re-evaluates the spans when they change.
	$: sentOn = active && highlightSentence && sentStart >= 0 && sentEnd > sentStart;
	$: wordOn = active && highlightWord && wordStart >= 0 && wordEnd > wordStart;

	function tagClasses(t: Token): string {
		return t.tags.map((tag) => TAG_CLASS[tag] ?? '').join(' ');
	}

	function onClick(e: MouseEvent) {
		// Don't hijack a text selection.
		if (window.getSelection()?.toString()) return;
		const el = (e.target as HTMLElement)?.closest?.('[data-s]') as HTMLElement | null;
		if (!el) return;
		const offset = Number(el.getAttribute('data-s'));
		if (!Number.isNaN(offset)) dispatch('seek', { index, offset });
	}
</script>

<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
<span class={cn('tts-para', active && 'cursor-pointer')} on:click={onClick}>
	{#each tokens as t (t.start)}
		{#if t.isBreak}
			<br />
		{:else}
			{@const inSent = sentOn && t.start >= sentStart && t.end <= sentEnd}
			{@const isWord = wordOn && t.isWord && t.start < wordEnd && t.end > wordStart}
			<span
				data-s={t.isWord ? t.start : undefined}
				class={cn(
					t.isWord && 'tts-tok',
					tagClasses(t),
					inSent && 'tts-sent',
					isWord && 'tts-word',
				)}>{t.text}</span
			>
		{/if}
	{/each}
</span>

<style>
	/* :global so the dynamically-applied classes are never dropped as "unused" by Svelte's CSS pruning. */
	:global(.tts-tok) {
		border-radius: 3px;
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}
	:global(.tts-sent) {
		background-color: rgba(56, 189, 248, 0.16);
		border-radius: 2px;
	}
	:global(.tts-word) {
		background-color: rgba(56, 189, 248, 0.45);
		box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35);
	}
	:global(.dark .tts-sent) {
		background-color: rgba(56, 189, 248, 0.18);
	}
	:global(.dark .tts-word) {
		background-color: rgba(56, 189, 248, 0.52);
		box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.5);
	}
</style>
