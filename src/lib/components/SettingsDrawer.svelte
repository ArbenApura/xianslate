<script lang="ts">
	// IMPORTED DEP-MODULES
	import { createEventDispatcher } from 'svelte';
	// IMPORTED MODULES
	import { CJK_FONTS, LATIN_FONTS } from '$lib/fonts';
	import { resetSettings, settings, TRANSLATION_MODELS, type LayoutMode, type Theme } from '$lib/stores/settings';
	import { isMobile } from '$lib/stores/viewport';
	import { cn } from '$lib/utils/cn';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import Check from 'lucide-svelte/icons/check';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';
	import LanguagePicker from '$lib/components/ui/LanguagePicker.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import RangeField from '$lib/components/ui/RangeField.svelte';
	import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
	import Select from '$lib/components/ui/Select.svelte';

	// -- OPTIONAL PROPS -- //

	export let open = false;

	// -- CONSTANTS -- //

	const dispatch = createEventDispatcher();
	const THEMES: { key: Theme; label: string; swatch: string }[] = [
		{ key: 'light', label: 'Light', swatch: 'bg-white border-slate-300' },
		{ key: 'sepia', label: 'Sepia', swatch: 'bg-[#f4ecd8] border-[#d8c9a8]' },
		{ key: 'dark', label: 'Dark', swatch: 'bg-[#0e131c] border-slate-600' },
		{ key: 'oled', label: 'OLED', swatch: 'bg-black border-slate-700' },
		{ key: 'contrast', label: 'Contrast', swatch: 'bg-black border-white' },
	];
	const LAYOUTS: { key: LayoutMode; label: string }[] = [
		{ key: 'target', label: 'Translation' },
		{ key: 'sidebyside', label: 'Bilingual' },
		{ key: 'interleaved', label: 'Stacked' },
		{ key: 'source', label: 'Original' },
	];
	const latinOptions = LATIN_FONTS.map((f) => ({ value: f.key, label: f.label }));
	const cjkOptions = CJK_FONTS.map((f) => ({ value: f.key, label: f.label }));

	// -- REACTIVE STATES -- //

	// HIDE BILINGUAL ON MOBILE — TWO COLUMNS DON'T FIT A PHONE; STACKED IS THE EQUIVALENT THERE
	$: visibleLayouts = $isMobile ? LAYOUTS.filter((l) => l.key !== 'sidebyside') : LAYOUTS;

	// -- FUNCTIONS -- //

	// SegmentedControl DISPATCHES A STRING — NARROW IT BACK TO THE LayoutMode UNION (NO `as` IN MARKUP).
	function setLayout(value: string) {
		$settings.layout = value as LayoutMode;
	}
</script>

<Modal {open} title="Reading settings" size="md" on:close={() => dispatch('close')}>
	<div class="flex flex-col gap-5">
		<!-- LAYOUT -->
		<div>
			<span class="mb-1.5 block text-xs font-medium opacity-60">Layout</span>
			<SegmentedControl
				options={visibleLayouts.map((l) => ({ value: l.key, label: l.label }))}
				value={$settings.layout}
				on:change={(e) => setLayout(e.detail)}
			/>
		</div>

		<!-- THEME SWATCHES -->
		<div>
			<span class="mb-1.5 block text-xs font-medium opacity-60">Theme</span>
			<div class="flex flex-wrap gap-2.5">
				{#each THEMES as t (t.key)}
					<button
						use:ripple
						on:click={() => ($settings.theme = t.key)}
						title={t.label}
						aria-label={t.label}
						class={cn(
							'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-105',
							t.swatch,
							$settings.theme === t.key
								? 'ring-2 ring-[#c0392b] ring-offset-2 ring-offset-white dark:ring-offset-slate-900'
								: '',
						)}
					>
						{#if $settings.theme === t.key}<Check
								size={15}
								class={t.key === 'light' || t.key === 'sepia' ? 'text-slate-700' : 'text-white'}
							/>{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- FONTS — ONE STACK FOR LATIN-SCRIPT TEXT, ONE FOR CJK; THE READER PICKS PER LANGUAGE -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<div>
				<span class="mb-1 block text-xs font-medium opacity-60">Latin font</span>
				<Select
					items={latinOptions}
					value={$settings.latinFont}
					on:change={(e) => ($settings.latinFont = e.detail)}
				/>
			</div>
			<div>
				<span class="mb-1 block text-xs font-medium opacity-60">CJK font</span>
				<Select
					items={cjkOptions}
					value={$settings.cjkFont}
					on:change={(e) => ($settings.cjkFont = e.detail)}
				/>
			</div>
		</div>

		<!-- DEFAULT TARGET LANGUAGE FOR NEW BOOKS (PER-BOOK OVERRIDE IN THE ADD-BOOK DIALOG). THE SOURCE IS
		     ALWAYS AUTO-DETECTED FROM THE CONTENT, SO THERE'S NO SOURCE PICKER. -->
		<div>
			<span class="mb-1.5 block text-xs font-medium opacity-60">Default target language</span>
			<LanguagePicker
				value={$settings.newBookTargetLang}
				on:change={(e) => ($settings.newBookTargetLang = e.detail)}
			/>
			<p class="mt-1 text-xs opacity-50">
				Applied to books you fetch or import next; the original language is detected automatically.
			</p>
		</div>

		<!-- SLIDERS -->
		<div class="flex flex-col gap-3.5">
			<RangeField
				label="Font size"
				min={13}
				max={30}
				step={1}
				bind:value={$settings.fontSizePx}
				display="{$settings.fontSizePx}px"
			/>
			<RangeField
				label="Line height"
				min={1.2}
				max={2.6}
				step={0.05}
				bind:value={$settings.lineHeight}
				display={$settings.lineHeight.toFixed(2)}
			/>
			<RangeField
				label="Letter spacing"
				min={-0.02}
				max={0.1}
				step={0.005}
				bind:value={$settings.letterSpacingEm}
				display="{$settings.letterSpacingEm.toFixed(3)}em"
			/>
			<RangeField
				label="Paragraph spacing"
				min={0}
				max={2.5}
				step={0.1}
				bind:value={$settings.paragraphSpacingEm}
				display="{$settings.paragraphSpacingEm.toFixed(1)}em"
			/>
			<RangeField
				label="Text width"
				min={40}
				max={120}
				step={1}
				bind:value={$settings.measureCh}
				display="{$settings.measureCh}ch"
			/>
		</div>

		<!-- TOGGLES -->
		<div class="flex items-center gap-5 text-sm">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="accent-[#b23a2e]"
					checked={$settings.align === 'justify'}
					on:change={(e) => ($settings.align = e.currentTarget.checked ? 'justify' : 'left')}
				/>
				Justify
			</label>
			<label class="flex items-center gap-2">
				<input type="checkbox" class="accent-[#b23a2e]" bind:checked={$settings.indent} />
				Indent paragraphs
			</label>
		</div>

		<!-- GLOSSARY TERM HIGHLIGHTING -->
		<label class="flex items-start gap-2 text-sm">
			<input type="checkbox" class="mt-0.5 accent-[#b23a2e]" bind:checked={$settings.boldTerms} />
			<span>
				Bold glossary terms
				<span class="mt-0.5 block text-xs opacity-50">
					Highlights matched glossary terms in the text. Tap one to see its translation and notes.
				</span>
			</span>
		</label>

		<!-- TRANSLATION PIPELINE -->
		<div class="border-t border-black/[0.06] pt-4 dark:border-white/[0.045]">
			<span class="mb-1.5 block text-xs font-medium opacity-60">Translation</span>

			<!-- GLOBAL MODEL PICKER — APPLIES TO EVERY TRANSLATE/EXTRACT CALL. SWITCHING IS SAFE: EACH MODEL
			     HAS ITS OWN TRANSLATION CACHE, SO IT NEVER REUSES THE OTHER MODEL'S OUTPUT. -->
			<span class="mb-1.5 block text-xs opacity-60">Model</span>
			<div class="grid grid-cols-2 gap-2">
				{#each TRANSLATION_MODELS as m (m.id)}
					<button
						use:ripple
						on:click={() => ($settings.model = m.id)}
						class={cn(
							'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
							$settings.model === m.id
								? 'border-[#c0392b] bg-[#c0392b]/10'
								: 'hover:bg-current/5 border-black/10 dark:border-white/[0.06]',
						)}
					>
						<span class="flex items-center gap-1.5 text-sm font-medium">
							{m.label}
							{#if $settings.model === m.id}<Check size={13} class="text-[#c0392b]" />{/if}
						</span>
						<span class="text-[11px] leading-tight opacity-50">{m.blurb}</span>
					</button>
				{/each}
			</div>

			<label class="mt-4 flex items-start gap-2 text-sm">
				<input type="checkbox" class="mt-0.5 accent-[#b23a2e]" bind:checked={$settings.autoExtract} />
				<span>
					Auto-extract glossary terms before translating
					<span class="mt-0.5 block text-xs opacity-50">
						Runs once per new chapter (extract → save → match → translate) for more consistent names/terms.
						Adds one DeepSeek call the first time a chapter is translated.
					</span>
				</span>
			</label>

			<!-- PREFETCH CONTROLS -->
			<div class="mt-4">
				<span class="mb-1.5 block text-xs opacity-60">Prefetch upcoming chapters</span>
				<SegmentedControl
					options={[
						{ value: '0', label: 'Off' },
						{ value: '1', label: '1' },
						{ value: '2', label: '2' },
						{ value: '3', label: '3' },
					]}
					value={String($settings.prefetch)}
					on:change={(e) => ($settings.prefetch = Number(e.detail))}
				/>
				<p class="mt-1 text-xs opacity-50">
					Downloads the next chapter(s) while you read, so "Next" is instant.
				</p>
			</div>
			<label class="mt-2 flex items-start gap-2 text-sm" class:opacity-40={$settings.prefetch === 0}>
				<input
					type="checkbox"
					class="mt-0.5 accent-[#b23a2e]"
					disabled={$settings.prefetch === 0}
					bind:checked={$settings.prefetchTranslate}
				/>
				<span>
					Also pre-translate them
					<span class="mt-0.5 block text-xs opacity-50">
						Warms each prefetched chapter's translation so it opens instantly — front-loads DeepSeek cost.
					</span>
				</span>
			</label>
		</div>
	</div>

	<svelte:fragment slot="footer">
		<Button on:click={resetSettings}><RotateCcw size={14} /> Reset to defaults</Button>
	</svelte:fragment>
</Modal>
