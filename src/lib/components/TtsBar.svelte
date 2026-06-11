<script lang="ts">
	// FLOATING PLAYBACK BAR — appears while reading aloud. Transport controls + a quick speed stepper +
	// a shortcut into the full read-aloud settings dialog.
	import { createEventDispatcher } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Pause from 'lucide-svelte/icons/pause';
	import Play from 'lucide-svelte/icons/play';
	import Square from 'lucide-svelte/icons/square';
	import SkipBack from 'lucide-svelte/icons/skip-back';
	import SkipForward from 'lucide-svelte/icons/skip-forward';
	import Minus from 'lucide-svelte/icons/minus';
	import Plus from 'lucide-svelte/icons/plus';
	import Settings2 from 'lucide-svelte/icons/settings-2';
	import { tts } from '$lib/tts/engine';
	import { ttsSettings } from '$lib/stores/tts';

	const dispatch = createEventDispatcher<{ settings: void }>();
	const state = tts.state;

	function bump(delta: number) {
		const next = Math.round(Math.min(2.5, Math.max(0.5, $ttsSettings.rate + delta)) * 100) / 100;
		$ttsSettings.rate = next;
	}
</script>

{#if $state.status !== 'idle'}
	<div
		transition:fly={{ y: 20, duration: 200, easing: cubicOut }}
		class="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-40 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-black/10 bg-white/90 px-2 py-1.5 shadow-xl backdrop-blur dark:border-white/10 dark:bg-slate-800/90"
		role="toolbar"
		aria-label="Read-aloud controls"
	>
		<!-- POSITION -->
		<span class="hidden px-2 text-xs tabular-nums opacity-50 sm:inline">
			¶ {Math.max(1, $state.paraIndex + 1)}/{$state.total}
		</span>

		<button
			on:click={() => tts.prev()}
			class="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Previous sentence"
			aria-label="Previous sentence"><SkipBack size={16} /></button
		>
		<button
			on:click={() => ($state.status === 'playing' ? tts.pause() : tts.resume())}
			class="rounded-full bg-sky-600 p-2.5 text-white transition-colors hover:bg-sky-500"
			title={$state.status === 'playing' ? 'Pause' : 'Resume'}
			aria-label={$state.status === 'playing' ? 'Pause' : 'Resume'}
		>
			{#if $state.status === 'playing'}<Pause size={16} />{:else}<Play size={16} />{/if}
		</button>
		<button
			on:click={() => tts.next()}
			class="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Next sentence"
			aria-label="Next sentence"><SkipForward size={16} /></button
		>
		<button
			on:click={() => tts.stop()}
			class="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Stop"
			aria-label="Stop"><Square size={15} /></button
		>

		<div class="mx-1 h-6 w-px bg-black/10 dark:bg-white/10"></div>

		<!-- SPEED STEPPER -->
		<button
			on:click={() => bump(-0.1)}
			class="rounded-full p-1.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Slower"
			aria-label="Slower"><Minus size={14} /></button
		>
		<span class="w-10 text-center text-xs tabular-nums opacity-70">{$ttsSettings.rate.toFixed(2)}×</span>
		<button
			on:click={() => bump(0.1)}
			class="rounded-full p-1.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Faster"
			aria-label="Faster"><Plus size={14} /></button
		>

		<div class="mx-1 h-6 w-px bg-black/10 dark:bg-white/10"></div>

		<button
			on:click={() => dispatch('settings')}
			class="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Read-aloud settings"
			aria-label="Read-aloud settings"><Settings2 size={16} /></button
		>
	</div>
{/if}
