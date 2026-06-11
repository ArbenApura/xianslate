<script lang="ts">
	// IMPORTED DEP-MODULES
	import { createEventDispatcher } from 'svelte';
	// IMPORTED MODULES
	import { CJK_FONTS, LATIN_FONTS } from '$lib/fonts';
	import { resetSettings, settings, type LayoutMode, type Theme } from '$lib/stores/settings';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import Check from 'lucide-svelte/icons/check';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	// IMPORTED COMPONENTS
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import RangeField from '$lib/components/ui/RangeField.svelte';
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
		{ key: 'en', label: 'English' },
		{ key: 'sidebyside', label: 'Bilingual' },
		{ key: 'interleaved', label: 'Stacked' },
		{ key: 'zh', label: '中文' },
	];
	const latinOptions = LATIN_FONTS.map((f) => ({ value: f.key, label: f.label }));
	const cjkOptions = CJK_FONTS.map((f) => ({ value: f.key, label: f.label }));
</script>

<Modal {open} title="Reading settings" size="md" on:close={() => dispatch('close')}>
	<div class="flex flex-col gap-5">
		<!-- LAYOUT -->
		<div>
			<span class="mb-1.5 block text-xs font-medium opacity-60">Layout</span>
			<div class="grid grid-cols-4 gap-1.5">
				{#each LAYOUTS as l (l.key)}
					<button
						on:click={() => ($settings.layout = l.key)}
						class={cn(
							'rounded-lg border px-2 py-1.5 text-sm transition-colors',
							$settings.layout === l.key
								? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-300'
								: 'hover:bg-current/5 border-black/10 dark:border-white/[0.06]',
						)}>{l.label}</button
					>
				{/each}
			</div>
		</div>

		<!-- THEME -->
		<div>
			<span class="mb-1.5 block text-xs font-medium opacity-60">Theme</span>
			<div class="flex flex-wrap gap-2.5">
				{#each THEMES as t (t.key)}
					<button
						on:click={() => ($settings.theme = t.key)}
						title={t.label}
						aria-label={t.label}
						class={cn(
							'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-105',
							t.swatch,
							$settings.theme === t.key
								? 'ring-2 ring-sky-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900'
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

		<!-- FONTS -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<div>
				<span class="mb-1 block text-xs font-medium opacity-60">English font</span>
				<Select
					items={latinOptions}
					value={$settings.latinFont}
					on:change={(e) => ($settings.latinFont = e.detail)}
				/>
			</div>
			<div>
				<span class="mb-1 block text-xs font-medium opacity-60">Chinese font</span>
				<Select
					items={cjkOptions}
					value={$settings.cjkFont}
					on:change={(e) => ($settings.cjkFont = e.detail)}
				/>
			</div>
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
					class="accent-sky-600"
					checked={$settings.align === 'justify'}
					on:change={(e) => ($settings.align = e.currentTarget.checked ? 'justify' : 'left')}
				/>
				Justify
			</label>
			<label class="flex items-center gap-2">
				<input type="checkbox" class="accent-sky-600" bind:checked={$settings.indent} />
				Indent paragraphs
			</label>
		</div>

		<!-- TRANSLATION PIPELINE -->
		<div class="border-t border-black/[0.06] pt-4 dark:border-white/[0.045]">
			<span class="mb-1.5 block text-xs font-medium opacity-60">Translation</span>
			<label class="flex items-start gap-2 text-sm">
				<input type="checkbox" class="mt-0.5 accent-sky-600" bind:checked={$settings.autoExtract} />
				<span>
					Auto-extract glossary terms before translating
					<span class="mt-0.5 block text-xs opacity-50">
						Runs once per new chapter (extract → save → match → translate) for more consistent names/terms.
						Adds one DeepSeek call the first time a chapter is translated.
					</span>
				</span>
			</label>

			<!-- PREFETCH -->
			<div class="mt-4">
				<span class="mb-1.5 block text-xs opacity-60">Prefetch upcoming chapters</span>
				<div
					class="inline-flex overflow-hidden rounded-lg border border-black/[0.12] text-xs dark:border-white/[0.08]"
				>
					{#each [0, 1, 2, 3] as n (n)}
						<button
							on:click={() => ($settings.prefetch = n)}
							class={cn(
								'px-3 py-1.5 transition-colors',
								$settings.prefetch === n ? 'bg-sky-600 text-white' : 'opacity-70 hover:opacity-100',
							)}>{n === 0 ? 'Off' : n}</button
						>
					{/each}
				</div>
				<p class="mt-1 text-xs opacity-50">Downloads the next chapter(s) while you read, so “Next” is instant.</p>
			</div>
			<label class="mt-2 flex items-start gap-2 text-sm" class:opacity-40={$settings.prefetch === 0}>
				<input
					type="checkbox"
					class="mt-0.5 accent-sky-600"
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
