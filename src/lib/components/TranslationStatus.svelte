<script lang="ts" context="module">
	export type Phase =
		| 'idle'
		| 'preparing'
		| 'extracting'
		| 'translating'
		| 'streaming'
		| 'cached'
		| 'done'
		| 'error';
</script>

<script lang="ts">
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import Check from 'lucide-svelte/icons/check';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import ScanText from 'lucide-svelte/icons/scan-text';
	import Languages from 'lucide-svelte/icons/languages';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Tags from 'lucide-svelte/icons/tags';
	import Zap from 'lucide-svelte/icons/zap';

	// -- REQUIRED PROPS -- //

	export let phase: Phase;

	// -- OPTIONAL PROPS -- //

	export let matched = 0;
	export let variant: 'card' | 'chip' = 'card';
	// SHOW THE AUTO-EXTRACT STEP, AND HOW MANY NEW TERMS IT SAVED (null = NOT DONE YET)
	export let showExtract = false;
	export let extracted: number | null = null;

	// -- TYPES -- //

	type StepState = 'pending' | 'active' | 'done';
	type Step = { key: string; icon: typeof Check; label: string; state: StepState };

	// -- CONSTANTS -- //

	// MONOTONIC PIPELINE RANK — USED TO DERIVE EACH STEP'S pending/active/done STATE
	const RANK: Record<Phase, number> = {
		idle: 0,
		preparing: 1,
		extracting: 2,
		translating: 3,
		streaming: 4,
		cached: 4,
		done: 5,
		error: 5,
	};

	const DOT = {
		pending: 'border-black/15 text-black/30 dark:border-white/15 dark:text-white/30',
		active: 'border-sky-500 text-sky-500',
		done: 'border-emerald-500 text-emerald-500',
	} as const;

	// -- REACTIVE STATES -- //

	$: r = RANK[phase] ?? 0;

	$: extractStep = {
		key: 'extract',
		icon: Sparkles,
		label:
			phase === 'extracting'
				? 'Extracting & saving glossary terms…'
				: extracted != null && extracted > 0
					? `Saved ${extracted} new term${extracted === 1 ? '' : 's'}`
					: r > RANK.extracting
						? 'Glossary up to date'
						: 'Extract glossary terms',
		state: (phase === 'extracting' ? 'active' : r > RANK.extracting ? 'done' : 'pending') as StepState,
	};

	$: matchStep = {
		key: 'match',
		icon: showExtract ? Tags : ScanText,
		label:
			r >= RANK.translating
				? matched > 0
					? `Matched ${matched} glossary term${matched === 1 ? '' : 's'}`
					: 'No glossary terms in this chapter'
				: 'Matching glossary terms',
		state: (r >= RANK.translating ? 'done' : phase === 'preparing' && !showExtract ? 'active' : 'pending') as StepState,
	};

	$: translateStep = {
		key: 'translate',
		icon: Languages,
		label: phase === 'streaming' ? 'Translating — streaming…' : 'Translating with DeepSeek',
		state: (phase === 'streaming' || phase === 'translating' ? 'active' : phase === 'done' ? 'done' : 'pending') as StepState,
	};

	$: steps = (showExtract ? [extractStep, matchStep, translateStep] : [matchStep, translateStep]) satisfies Step[];
</script>

<!-- CHIP VARIANT: COMPACT LIVE INDICATOR (USED WHILE TEXT IS ALREADY STREAMING IN) -->
{#if variant === 'chip'}
	<span
		class={cn(
			'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
			phase === 'cached'
				? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
				: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300',
		)}
	>
		<!-- CACHE HIT STATE -->
		{#if phase === 'cached'}
			<Zap size={13} /> From cache · free
		<!-- ACTIVE TRANSLATION STATE -->
		{:else}
			<span class="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-sky-500"></span>
			Translating{#if matched > 0}<span class="opacity-70"> · {matched} terms</span>{/if}
		{/if}
	</span>
<!-- CACHE HIT CARD: INSTANT CACHE HIT — ALREADY TRANSLATED, NO DEEPSEEK CALL -->
{:else if phase === 'cached'}
	<div
		class="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
	>
		<Zap size={16} /> Already translated — loaded instantly, no cost.
	</div>
<!-- STEP CARD: PIPELINE PROGRESS (USED BEFORE ANY TEXT HAS ARRIVED) -->
{:else}
	<div class="rounded-xl border border-black/[0.06] bg-current/[0.02] p-4 dark:border-white/[0.05]">
		<ul class="space-y-3">
			{#each steps as step (step.key)}
				<li class="flex items-center gap-3">
					<span
						class={cn(
							'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors',
							DOT[step.state],
						)}
					>
						<!-- ACTIVE STEP: SPINNING LOADER -->
						{#if step.state === 'active'}
							<Loader2 size={14} class="animate-spin" />
						<!-- DONE STEP: CHECKMARK -->
						{:else if step.state === 'done'}
							<Check size={14} />
						<!-- PENDING STEP: STEP ICON -->
						{:else}
							<svelte:component this={step.icon} size={14} />
						{/if}
					</span>
					<span class={cn('text-sm transition-opacity', step.state === 'pending' ? 'opacity-40' : 'opacity-90')}
						>{step.label}</span
					>
				</li>
			{/each}
		</ul>
	</div>
{/if}
