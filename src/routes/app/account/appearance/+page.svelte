<script lang="ts">
	// IMPORTED TYPES
	import type { Theme } from '$lib/stores/settings';
	// IMPORTED MODULES
	import { languageName } from '$lib/languages';
	import { settings, TRANSLATION_MODELS } from '$lib/stores/settings';
	import { ripple } from '$lib/actions/ripple';
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import Languages from 'lucide-svelte/icons/languages';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	// IMPORTED COMPONENTS
	import LanguagePicker from '$lib/components/ui/LanguagePicker.svelte';

	// -- CONSTANTS -- //

	// THE FIVE APP THEMES + A REPRESENTATIVE SWATCH (COMPLETE LITERAL bg-[#HEX]/bg-black CLASSES — MIRRORS
	// THE THEME_BG MAP IN $lib/stores/settings; KEPT LITERAL SO cn()/TAILWIND CAN SEE THEM).
	const THEMES: { id: Theme; label: string; swatch: string }[] = [
		{ id: 'light', label: 'Light', swatch: 'bg-[#fbfaf7]' },
		{ id: 'sepia', label: 'Sepia', swatch: 'bg-[#f4ecd8]' },
		{ id: 'dark', label: 'Dark', swatch: 'bg-[#0e131c]' },
		{ id: 'oled', label: 'OLED', swatch: 'bg-black' },
		{ id: 'contrast', label: 'Contrast', swatch: 'bg-black' },
	];
	const CARD = 'rounded-2xl border border-black/10 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]';
	// SLATE MUTED-TEXT TOKEN — MATCHES THE ADMIN CONSOLE SO THE TWO SURFACES READ AS ONE APP.
	const MUTED = 'text-slate-500 dark:text-slate-400';

	// -- CONSTANTS -- //

	// THE FIVE APP THEMES + A REPRESENTATIVE SWATCH (COMPLETE LITERAL bg-[#HEX]/bg-black CLASSES — MIRRORS
	// THE THEME_BG MAP IN $lib/stores/settings; KEPT LITERAL SO cn()/TAILWIND CAN SEE THEM).

	function setTheme(t: Theme) {
		settings.update((s) => ({ ...s, theme: t }));
	}

	function setDefaultLang(code: string) {
		settings.update((s) => ({ ...s, newBookTargetLang: code }));
	}

	function setModel(id: string) {
		settings.update((s) => ({ ...s, model: id }));
	}
</script>

<!-- APPEARANCE & READING PREFERENCES -->
<section class={CARD}>
	<!-- THEME -->
	<span class={cn('mb-2 block text-xs font-medium', MUTED)}>Theme</span>
	<div class="flex flex-wrap gap-2">
		{#each THEMES as t (t.id)}
			<button
				use:ripple
				on:click={() => setTheme(t.id)}
				class={cn(
					'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
					$settings.theme === t.id
						? 'border-[#c0392b] ring-1 ring-[#c0392b]'
						: 'border-black/10 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20',
				)}
			>
				<span class={cn('h-4 w-4 rounded-full border border-black/10 dark:border-white/20', t.swatch)}></span>
				{t.label}
			</button>
		{/each}
	</div>

	<!-- DEFAULT TRANSLATION LANGUAGE -->
	<div class="mt-5">
		<span class={cn('mb-2 flex items-center gap-1.5 text-xs font-medium', MUTED)}
			><Languages size={13} /> Default translation language</span
		>
		<LanguagePicker
			value={$settings.newBookTargetLang}
			allowNone={false}
			on:change={(e) => setDefaultLang(e.detail)}
		/>
		<p class="mt-1.5 text-xs opacity-50">
			New books translate into {languageName($settings.newBookTargetLang)} unless you pick otherwise.
		</p>
	</div>

	<!-- TRANSLATION MODEL -->
	<div class="mt-5">
		<span class={cn('mb-2 flex items-center gap-1.5 text-xs font-medium', MUTED)}
			><Sparkles size={13} /> Translation model</span
		>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{#each TRANSLATION_MODELS as m (m.id)}
				<button
					use:ripple
					on:click={() => setModel(m.id)}
					class={cn(
						'flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
						$settings.model === m.id
							? 'border-[#c0392b] ring-1 ring-[#c0392b]'
							: 'border-black/10 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20',
					)}
				>
					<span class="text-sm font-medium">{m.label}</span>
					<span class={cn('text-xs', MUTED)}>{m.blurb}</span>
				</button>
			{/each}
		</div>
	</div>
</section>
