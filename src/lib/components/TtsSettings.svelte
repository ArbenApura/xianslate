<script lang="ts">
	// READ-ALOUD CUSTOMIZATION DIALOG — VOICE (PER LANGUAGE), RATE / PITCH / VOLUME, HIGHLIGHT + SCROLL
	// BEHAVIOUR. CHANGES APPLY LIVE (THE ENGINE RE-SPEAKS THE CURRENT SENTENCE ON A VOICE/RATE CHANGE).
	import { createEventDispatcher } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Play from 'lucide-svelte/icons/play';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import {
		ttsSettings,
		resetTtsSettings,
		voices,
		ensureVoices,
		wordTimingSupport,
		voiceHasWordTiming,
	} from '$lib/stores/tts';
	import { tts } from '$lib/tts/engine';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import RangeField from '$lib/components/ui/RangeField.svelte';
	import Select from '$lib/components/ui/Select.svelte';

	// -- OPTIONAL PROPS -- //

	export let open = false;
	// THE BCP-47 LANGUAGE TAG CURRENTLY BEING READ (e.g. 'en-US', 'zh-TW') — SURFACES THAT VOICE PICKER
	// FIRST. THE TWO SAVED-VOICE SLOTS COVER en/zh; OTHER LANGUAGES FALL BACK TO AN AUTO-PICKED VOICE.
	export let lang = 'en-US';

	// -- REACTIVE STATES -- //

	// TRUE WHEN READING A CHINESE (HAN) TARGET/SOURCE — ORDERS THE zh VOICE PICKER FIRST.
	$: isZh = lang.toLowerCase().startsWith('zh');

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher();

	const toOptions = (vs: SpeechSynthesisVoice[]) => [
		{ value: '', label: 'Automatic (system default)' },
		...vs.map((v) => ({ value: v.voiceURI, label: `${v.name} · ${v.lang}` })),
	];

	// -- REACTIVE STATES -- //

	$: enVoices = $voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
	$: zhVoices = $voices.filter((v) => v.lang?.toLowerCase().startsWith('zh'));

	// THE VOICE THAT WILL ACTUALLY BE USED FOR THE LANGUAGE CURRENTLY BEING READ, AND WHETHER IT CAN
	// DRIVE WORD-LEVEL HIGHLIGHTING (NETWORK VOICES LIKE GOOGLE'S ONLY FIRE start/end EVENTS).
	$: activeVoice = (() => {
		const uri = isZh ? $ttsSettings.zhVoiceURI : $ttsSettings.enVoiceURI;
		const pool = isZh ? zhVoices : enVoices;
		return (uri ? pool.find((v) => v.voiceURI === uri) : null) ?? pool[0] ?? null;
	})();
	$: wordTimingOk = voiceHasWordTiming(activeVoice, $wordTimingSupport);

	// ORDER THE TWO VOICE PICKERS SO THE LANGUAGE BEING READ SHOWS FIRST.
	$: voiceBlocks = isZh
		? ([
				{ key: 'zh', label: 'Chinese voice', opts: toOptions(zhVoices), empty: zhVoices.length === 0 },
				{ key: 'en', label: 'English voice', opts: toOptions(enVoices), empty: enVoices.length === 0 },
			] as const)
		: ([
				{ key: 'en', label: 'English voice', opts: toOptions(enVoices), empty: enVoices.length === 0 },
				{ key: 'zh', label: 'Chinese voice', opts: toOptions(zhVoices), empty: zhVoices.length === 0 },
			] as const);

	// -- REACTIVE STATEMENTS -- //

	$: if (open) ensureVoices();

	// -- FUNCTIONS -- //

	function preview(which: 'en' | 'zh') {
		if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
		// STOP THE ENGINE FIRST. PREVIEW SPEAKS OUTSIDE THE ENGINE'S QUEUE, SO CANCELLING WITHOUT THIS WOULD
		// KILL AN ACTIVE READ WHILE LEAVING THE ENGINE'S STATE STUCK AT 'playing' (THE gen-GUARD EATS onend).
		tts.stop();
		const sample =
			which === 'en' ? 'The quick brown fox jumps over the lazy dog.' : '春江潮水連海平，海上明月共潮生。';
		const u = new SpeechSynthesisUtterance(sample);
		const s = $ttsSettings;
		u.rate = s.rate;
		u.pitch = s.pitch;
		u.volume = s.volume;
		const uri = which === 'en' ? s.enVoiceURI : s.zhVoiceURI;
		const pool = which === 'en' ? enVoices : zhVoices;
		const v = (uri && pool.find((x) => x.voiceURI === uri)) || pool[0];
		if (v) {
			u.voice = v;
			u.lang = v.lang;
		} else u.lang = which === 'en' ? 'en-US' : 'zh-TW';
		window.speechSynthesis.cancel();
		window.speechSynthesis.speak(u);
	}
</script>

<!-- MODAL WRAPPER -->
<Modal {open} title="Read-aloud settings" size="md" on:close={() => dispatch('close')}>
	<div class="flex flex-col gap-5">
		<!-- VOICE PICKERS -->
		<div class="flex flex-col gap-3">
			{#each voiceBlocks as b (b.key)}
				<div>
					<div class="mb-1 flex items-center justify-between">
						<span class="text-xs font-medium opacity-60">{b.label}</span>
						<button
							use:ripple
							on:click={() => preview(b.key)}
							class="inline-flex items-center gap-1 text-xs opacity-60 hover:opacity-100"
							title="Preview"><Play size={11} /> Preview</button
						>
					</div>
					<Select
						items={b.opts}
						value={(b.key === 'en' ? $ttsSettings.enVoiceURI : $ttsSettings.zhVoiceURI) ?? ''}
						on:change={(e) =>
							b.key === 'en'
								? ($ttsSettings.enVoiceURI = e.detail || null)
								: ($ttsSettings.zhVoiceURI = e.detail || null)}
					/>
					{#if b.empty}
						<p class="mt-1 text-xs opacity-50">
							No {b.key === 'en' ? 'English' : 'Chinese'} voices installed in this browser.
						</p>
					{/if}
				</div>
			{/each}
		</div>

		<!-- SLIDERS — SPEED / PITCH / VOLUME -->
		<div class="flex flex-col gap-3.5">
			<RangeField
				label="Speed"
				min={0.5}
				max={2.5}
				step={0.05}
				bind:value={$ttsSettings.rate}
				display="{$ttsSettings.rate.toFixed(2)}×"
			/>
			<RangeField
				label="Pitch"
				min={0}
				max={2}
				step={0.05}
				bind:value={$ttsSettings.pitch}
				display={$ttsSettings.pitch.toFixed(2)}
			/>
			<RangeField
				label="Volume"
				min={0}
				max={1}
				step={0.05}
				bind:value={$ttsSettings.volume}
				display="{Math.round($ttsSettings.volume * 100)}%"
			/>
		</div>

		<!-- HIGHLIGHT AND SCROLL OPTIONS -->
		<div class="flex flex-col gap-2.5 border-t border-black/[0.06] pt-4 text-sm dark:border-white/[0.045]">
			<span class="text-xs font-medium opacity-60">While reading</span>
			<label class="flex items-center gap-2">
				<input type="checkbox" class="accent-sky-600" bind:checked={$ttsSettings.highlight} />
				Highlight the current sentence
			</label>
			<label class={cn('flex items-center gap-2', (!$ttsSettings.highlight || !wordTimingOk) && 'opacity-40')}>
				<input
					type="checkbox"
					class="accent-sky-600"
					disabled={!$ttsSettings.highlight || !wordTimingOk}
					checked={$ttsSettings.highlightWord && wordTimingOk}
					on:change={(e) => ($ttsSettings.highlightWord = e.currentTarget.checked)}
				/>
				Highlight the current word
			</label>
			{#if $ttsSettings.highlight && !wordTimingOk}
				<!-- WORD TIMING WARNING -->
				<p class="flex items-start gap-1.5 pl-6 text-xs text-amber-600 dark:text-amber-400">
					<TriangleAlert size={13} class="mt-0.5 shrink-0" />
					<span
						>{activeVoice?.name ?? 'This voice'} doesn't report word timing, so only the sentence is highlighted.
						Pick a local/offline voice (e.g. a "Microsoft …" voice) for word-by-word highlighting.</span
					>
				</p>
			{/if}
			<label class="flex items-center gap-2">
				<input type="checkbox" class="accent-sky-600" bind:checked={$ttsSettings.autoScroll} />
				Auto-scroll to keep the spoken line in view
			</label>
		</div>

		<!-- FOOTER HINT -->
		<p class="text-xs opacity-50">
			Voices come from your browser/OS. Install more system voices to expand the list. Tip: click any word while
			reading to jump there.
		</p>
	</div>

	<!-- RESET BUTTON SLOT -->
	<svelte:fragment slot="footer">
		<Button on:click={resetTtsSettings}><RotateCcw size={14} /> Reset</Button>
	</svelte:fragment>
</Modal>
