<script lang="ts">
	// FLOATING PLAYBACK BAR — APPEARS WHILE READING ALOUD. TRANSPORT CONTROLS + A QUICK SPEED STEPPER +
	// A SHORTCUT INTO THE FULL READ-ALOUD SETTINGS DIALOG.
	// IMPORTED DEP-MODULES
	import { createEventDispatcher } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	// IMPORTED MODULES
	import { settings, THEME_POPOVER, THEME_PANEL_BORDER } from '$lib/stores/settings';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	import { tts } from '$lib/tts/engine';
	import { ttsSettings } from '$lib/stores/tts';
	// IMPORTED DEP-COMPONENTS
	import Pause from 'lucide-svelte/icons/pause';
	import Play from 'lucide-svelte/icons/play';
	import Square from 'lucide-svelte/icons/square';
	import SkipBack from 'lucide-svelte/icons/skip-back';
	import SkipForward from 'lucide-svelte/icons/skip-forward';
	import Minus from 'lucide-svelte/icons/minus';
	import Plus from 'lucide-svelte/icons/plus';
	import Settings2 from 'lucide-svelte/icons/settings-2';

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher<{ settings: void }>();
	const state = tts.state;

	// -- REACTIVE STATES -- //

	// THEME-AWARE OPAQUE PILL SURFACE + BORDER (WAS A HARDCODED white / slate-800 PLANE)
	$: popover = THEME_POPOVER[$settings.theme];
	$: popoverBorder = THEME_PANEL_BORDER[$settings.theme];

	// -- FUNCTIONS -- //

	function bump(delta: number) {
		const next = Math.round(Math.min(2.5, Math.max(0.5, $ttsSettings.rate + delta)) * 100) / 100;
		$ttsSettings.rate = next;
	}
</script>

<!-- TTS BAR OVERLAY — FIXED BOTTOM, VISIBLE WHEN TTS IS ACTIVE -->
{#if $state.status !== 'idle'}
	<div
		transition:fly={{ y: 20, duration: 200, easing: cubicOut }}
		class={cn(
			'fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-40 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1 rounded-full border px-2 py-1.5 shadow-xl backdrop-blur',
			popover,
			popoverBorder,
		)}
		role="toolbar"
		aria-label="Read-aloud controls"
	>
		<!-- PARAGRAPH POSITION INDICATOR — HIDDEN ON MOBILE -->
		<span class="hidden px-2 text-xs tabular-nums opacity-50 sm:inline">
			¶ {Math.max(1, $state.paraIndex + 1)}/{$state.total}
		</span>

		<!-- TRANSPORT CONTROLS — PREV / PLAY-PAUSE / NEXT / STOP -->
		<button
			use:ripple
			on:click={() => tts.prev()}
			class="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Previous sentence"
			aria-label="Previous sentence"><SkipBack size={16} /></button
		>
		<button
			use:ripple
			on:click={() => ($state.status === 'playing' ? tts.pause() : tts.resume())}
			class="rounded-full bg-sky-600 p-2.5 text-white transition-colors hover:bg-sky-500"
			title={$state.status === 'playing' ? 'Pause' : 'Resume'}
			aria-label={$state.status === 'playing' ? 'Pause' : 'Resume'}
		>
			{#if $state.status === 'playing'}<Pause size={16} />{:else}<Play size={16} />{/if}
		</button>
		<button
			use:ripple
			on:click={() => tts.next()}
			class="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Next sentence"
			aria-label="Next sentence"><SkipForward size={16} /></button
		>
		<button
			use:ripple
			on:click={() => tts.stop()}
			class="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Stop"
			aria-label="Stop"><Square size={15} /></button
		>

		<!-- SEPARATOR -->
		<div class="mx-1 h-6 w-px bg-black/10 dark:bg-white/10"></div>

		<!-- SPEED STEPPER -->
		<button
			use:ripple
			on:click={() => bump(-0.1)}
			class="rounded-full p-1.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Slower"
			aria-label="Slower"><Minus size={14} /></button
		>
		<span class="w-10 text-center text-xs tabular-nums opacity-70">{$ttsSettings.rate.toFixed(2)}×</span>
		<button
			use:ripple
			on:click={() => bump(0.1)}
			class="rounded-full p-1.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Faster"
			aria-label="Faster"><Plus size={14} /></button
		>

		<!-- SEPARATOR -->
		<div class="mx-1 h-6 w-px bg-black/10 dark:bg-white/10"></div>

		<!-- SETTINGS SHORTCUT -->
		<button
			use:ripple
			on:click={() => dispatch('settings')}
			class="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
			title="Read-aloud settings"
			aria-label="Read-aloud settings"><Settings2 size={16} /></button
		>
	</div>
{/if}
