<script lang="ts" context="module">
	export type Phase = 'idle' | 'preparing' | 'extracting' | 'translating' | 'streaming' | 'cached' | 'done' | 'error';
</script>

<script lang="ts">
	// IMPORTED MODULES
	import { cn } from '$lib/utils/cn';
	// IMPORTED DEP-COMPONENTS
	import BookOpen from 'lucide-svelte/icons/book-open';
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
	// CHAPTER SCOPE — DRIVES THE DETAILED COUNTS / PROGRESS BAR
	export let paragraphs = 0;
	export let chars = 0;
	// TRANSLATION PROGRESS — COMPLETED PARAGRAPHS OF `paragraphs`
	export let translatedParas = 0;
	// TERM-SCAN PROGRESS (chunk done / total, terms found so far)
	export let extractDone = 0;
	export let extractTotal = 0;
	export let extractFound = 0;

	// -- TYPES -- //

	type StepState = 'pending' | 'active' | 'done';
	type Step = { key: string; icon: typeof Check; label: string; state: StepState; sub?: string; progress?: number };

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

	// -- FUNCTIONS -- //

	function fmtChars(n: number): string {
		return n >= 1000 ? `~${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k chars` : `${n} chars`;
	}

	// -- REACTIVE STATES -- //

	$: r = RANK[phase] ?? 0;
	$: pct = paragraphs > 0 ? Math.min(100, Math.round((translatedParas / paragraphs) * 100)) : 0;
	$: scope = paragraphs > 0 ? `${paragraphs} paragraph${paragraphs === 1 ? '' : 's'} · ${fmtChars(chars)}` : '';

	// STEP 0 — CONFIRM THE CHAPTER IS LOADED AND SHOW ITS SCOPE. GIVES THE PIPELINE A VISIBLE FIRST STAGE
	// THAT COMPLETES, INSTEAD OF JUMPING STRAIGHT INTO THE LONG SCAN.
	$: prepareStep = {
		key: 'prepare',
		icon: BookOpen,
		label: paragraphs > 0 ? `Chapter loaded · ${scope}` : 'Loading chapter…',
		state: (r > RANK.preparing ? 'done' : 'active') as StepState,
	} as Step;

	$: extractStep = {
		key: 'extract',
		icon: Sparkles,
		label:
			phase === 'extracting'
				? // ONLY SHOW A PART COUNTER WHEN THE CHAPTER ACTUALLY SPLIT INTO MULTIPLE CHUNKS — "part 1/1"
					// (THE COMMON SHORT-CHAPTER CASE) IS NOISE; THE "N terms found" SUB-LINE CARRIES THE PROGRESS.
					extractTotal > 1
					? `Scanning for glossary terms · part ${Math.min(extractDone + 1, extractTotal)}/${extractTotal}`
					: 'Scanning for glossary terms…'
				: extracted != null && extracted > 0
					? `Saved ${extracted} new term${extracted === 1 ? '' : 's'}`
					: r > RANK.extracting
						? 'Glossary up to date'
						: 'Extract glossary terms',
		// ALWAYS SHOW A LIVE SUB-LINE WHILE SCANNING SO IT NEVER LOOKS FROZEN — THE COUNT TICKS UP AS THE
		// MODEL STREAMS TERMS IN.
		sub:
			phase === 'extracting'
				? extractFound > 0
					? `${extractFound} term${extractFound === 1 ? '' : 's'} found so far`
					: 'Reading the chapter for names & terms…'
				: undefined,
		state: (phase === 'extracting' ? 'active' : r > RANK.extracting ? 'done' : 'pending') as StepState,
	} as Step;

	$: matchStep = {
		key: 'match',
		icon: showExtract ? Tags : ScanText,
		label:
			r >= RANK.translating
				? matched > 0
					? `Matched ${matched} glossary term${matched === 1 ? '' : 's'}`
					: 'No glossary terms in this chapter'
				: 'Matching glossary terms',
		state: (r >= RANK.translating
			? 'done'
			: phase === 'preparing' && !showExtract
				? 'active'
				: 'pending') as StepState,
	} as Step;

	$: translateStep = {
		key: 'translate',
		icon: Languages,
		label:
			phase === 'streaming' && paragraphs > 0
				? `Translating · ${Math.min(translatedParas, paragraphs)}/${paragraphs} paragraphs`
				: phase === 'streaming'
					? 'Translating — streaming…'
					: 'Translating with DeepSeek',
		sub: phase === 'streaming' && paragraphs > 0 ? `${pct}% complete` : undefined,
		progress: phase === 'streaming' && paragraphs > 0 ? pct : undefined,
		state: (phase === 'streaming' || phase === 'translating'
			? 'active'
			: phase === 'done'
				? 'done'
				: 'pending') as StepState,
	} as Step;

	$: steps = (
		showExtract ? [prepareStep, extractStep, matchStep, translateStep] : [prepareStep, matchStep, translateStep]
	) as Step[];
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
			{#if paragraphs > 0}Translating · {Math.min(
					translatedParas,
					paragraphs,
				)}/{paragraphs}{:else}Translating{/if}
			{#if matched > 0}<span class="opacity-70"> · {matched} terms</span>{/if}
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
	<div class="bg-current/[0.02] rounded-xl border border-black/[0.06] p-4 dark:border-white/[0.05]">
		<ul class="space-y-3">
			{#each steps as step (step.key)}
				<li class="flex items-start gap-3">
					<span
						class={cn(
							'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors',
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
					<div class="min-w-0 flex-1">
						<div
							class={cn(
								'text-sm transition-opacity',
								step.state === 'pending' ? 'opacity-40' : 'opacity-90',
							)}
						>
							{step.label}
						</div>
						<!-- SUB-DETAIL (TERMS FOUND, % COMPLETE) -->
						{#if step.sub}
							<div class="mt-0.5 text-xs opacity-50">{step.sub}</div>
						{/if}
						<!-- TRANSLATION PROGRESS BAR -->
						{#if step.progress != null}
							<div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
								<!-- RUNTIME-DYNAMIC WIDTH FROM LIVE PROGRESS — CANNOT BE A STATIC TAILWIND CLASS -->
								<div
									class="h-full rounded-full bg-sky-500 transition-all duration-300"
									style="width: {step.progress}%"
								></div>
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</div>
{/if}
