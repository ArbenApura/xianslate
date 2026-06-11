// IMPORTED TYPES
import type { TranslationUsage } from '$lib/types';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import OpenAI from 'openai';
import PQueue from 'p-queue';

// -- CONSTANTS -- //

const apiKey = env.DEEPSEEK_API_KEY ?? '';

const baseURL = env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';

export const MODEL = env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

// DEEPSEEK IS OPENAI-COMPATIBLE — POINT THE SDK AT ITS BASE URL
export const deepseek = new OpenAI({ apiKey, baseURL });

// deepseek-v4-* IS A HYBRID REASONING MODEL: BY DEFAULT IT EMITS `reasoning_content` AND SPENDS
// COMPLETION TOKENS "THINKING" BEFORE ANY REAL `content`. THAT IS ACTIVELY HARMFUL TO THIS APP:
//  - IT STALLS THE TRANSLATION STREAM (THE READER SEES NOTHING WHILE THE MODEL THINKS — LOOKS "STUCK").
//  - REASONING TOKENS ARE BILLED AS OUTPUT, SILENTLY INFLATING COST.
//  - WITH A BOUNDED max_tokens (TERM EXTRACTION) THE THINKING CAN EAT THE WHOLE BUDGET AND RETURN AN
//    EMPTY BODY — OBSERVED: EXTRACTION RETURNING {"terms":[]} FOR A PASSAGE FULL OF PROPER NOUNS.
// WE TRANSLATE/EXTRACT DETERMINISTICALLY AND DON'T USE THE CHAIN-OF-THOUGHT, SO DISABLE THINKING BY
// DEFAULT. SET DEEPSEEK_REASONING=enabled TO OPT BACK IN (e.g. TO A/B HIGHER-EFFORT TRANSLATION).
const REASONING_ON = (env.DEEPSEEK_REASONING ?? 'disabled').toLowerCase() === 'enabled';

// GLOBAL CONCURRENCY CAP ON OUTBOUND DEEPSEEK CALLS. WITHOUT THIS, PARALLEL CHAPTER JOBS (THE CURRENT
// READ + BACKGROUND PREFETCH WARM-UPS) FAN OUT UNTHROTTLED AND CAN TRIP RATE LIMITS / SPIKE COST.
const CONCURRENCY = Math.max(1, Number(env.DEEPSEEK_CONCURRENCY ?? '4') || 4);

const queue = new PQueue({ concurrency: CONCURRENCY });

// DEEPSEEK PRICING (USD PER 1M TOKENS) — APPROXIMATE; OVERRIDE VIA ENV IF NEEDED.
// CACHE HITS ARE ~10x CHEAPER THAN MISSES.
const PRICE_INPUT_MISS = Number(env.DEEPSEEK_PRICE_INPUT ?? '0.27') / 1_000_000;

const PRICE_INPUT_HIT = Number(env.DEEPSEEK_PRICE_CACHED ?? '0.027') / 1_000_000;

const PRICE_OUTPUT = Number(env.DEEPSEEK_PRICE_OUTPUT ?? '1.10') / 1_000_000;

// -- FUNCTIONS -- //

export function hasApiKey(): boolean {
	return apiKey.length > 0;
}

// EXTRA REQUEST-BODY FIELDS APPENDED TO EVERY DEEPSEEK CHAT CALL. SPREAD THIS INTO THE create()
// PARAMS LITERAL (NOT AS A PLAIN OBJECT) SO THE `thinking` KEY RIDES ALONG TO THE API WITHOUT
// TRIPPING TypeScript'S EXCESS-PROPERTY CHECK AND WITHOUT DISTURBING THE STREAM/NON-STREAM OVERLOAD.
export function thinkingParam(): Record<string, unknown> {
	return REASONING_ON ? {} : { thinking: { type: 'disabled' } };
}

// RUN AN LLM CALL THROUGH THE SHARED CONCURRENCY QUEUE (HOLDS A SLOT FOR THE FULL DURATION OF fn).
export function queued<T>(fn: () => Promise<T>): Promise<T> {
	return queue.add(fn, { throwOnTimeout: true }) as Promise<T>;
}

// TRANSIENT FAILURES (RATE LIMITS, 5xx, CONNECTION RESETS, TIMEOUTS) SHOULD NOT KILL A WHOLE CHAPTER
// TRANSLATION — RETRY THEM WITH EXPONENTIAL BACKOFF. NON-RETRYABLE ERRORS (e.g. 400/401) THROW AT ONCE.
function isRetryable(e: unknown): boolean {
	const status = (e as { status?: number })?.status;
	if (typeof status === 'number') return status === 408 || status === 409 || status === 429 || status >= 500;
	// NO HTTP STATUS → NETWORK/CONNECTION ERROR → RETRY
	return true;
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
	let lastErr: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (e) {
			lastErr = e;
			if (attempt === retries || !isRetryable(e)) break;
			const delay = Math.min(10_000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	throw lastErr;
}

// COMPUTE APPROXIMATE COST FROM A USAGE OBJECT (HANDLES DEEPSEEK CACHE FIELDS)
export function computeUsage(usage: OpenAI.Completions.CompletionUsage | undefined): TranslationUsage {
	const promptTokens = usage?.prompt_tokens ?? 0;
	const completionTokens = usage?.completion_tokens ?? 0;
	// DEEPSEEK REPORTS prompt_cache_hit_tokens / prompt_cache_miss_tokens
	const u = usage as unknown as {
		prompt_cache_hit_tokens?: number;
		prompt_cache_miss_tokens?: number;
		prompt_tokens_details?: { cached_tokens?: number };
	};
	const cachedTokens = u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0;
	const missTokens = u?.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cachedTokens);
	const costUsd = missTokens * PRICE_INPUT_MISS + cachedTokens * PRICE_INPUT_HIT + completionTokens * PRICE_OUTPUT;
	return { model: MODEL, promptTokens, cachedTokens, completionTokens, costUsd };
}
