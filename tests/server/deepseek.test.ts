// DEEPSEEK USAGE-COMPUTATION TESTS — THE TOKEN/COST MATH THAT FEEDS EVERY LEDGER.
import { describe, expect, it } from 'vitest';
import { computeUsage } from '$lib/server/deepseek';

describe('computeUsage', () => {
	it('defaults everything to zero for an undefined usage payload', () => {
		const u = computeUsage(undefined, 'm');
		expect(u).toMatchObject({ promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0, model: 'm' });
	});

	it('counts plain prompt/completion tokens', () => {
		const u = computeUsage(
			{ prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 } as never,
			'm',
		);
		expect(u.promptTokens).toBe(1000);
		expect(u.cachedTokens).toBe(0);
		expect(u.completionTokens).toBe(300);
		expect(u.costUsd).toBeGreaterThan(0); // MISS RATE × 1000 + OUTPUT × 300
	});

	it('reads prompt_cache_hit_tokens as the cached portion', () => {
		const u = computeUsage(
			{
				prompt_tokens: 1000,
				completion_tokens: 100,
				total_tokens: 1100,
				prompt_cache_hit_tokens: 600,
				prompt_cache_miss_tokens: 400,
			} as never,
			'm',
		);
		expect(u.promptTokens).toBe(1000);
		expect(u.cachedTokens).toBe(600);
		expect(u.completionTokens).toBe(100);
	});

	it('falls back to prompt_tokens_details.cached_tokens and derives miss as prompt - cached', () => {
		const u = computeUsage(
			{
				prompt_tokens: 500,
				completion_tokens: 50,
				total_tokens: 550,
				prompt_tokens_details: { cached_tokens: 200 },
			} as never,
			'm',
		);
		expect(u.cachedTokens).toBe(200);
	});

	it('a cache-only run is strictly cheaper than a cold run at the same token count', () => {
		const cold = computeUsage(
			{ prompt_tokens: 1000, completion_tokens: 0, total_tokens: 1000, prompt_cache_hit_tokens: 0 } as never,
			'm',
		);
		const hit = computeUsage(
			{ prompt_tokens: 1000, completion_tokens: 0, total_tokens: 1000, prompt_cache_hit_tokens: 1000 } as never,
			'm',
		);
		// HIT RATE < MISS RATE (inputHit < inputMiss) — THE WHOLE POINT OF THE CACHE
		expect(hit.costUsd).toBeLessThan(cold.costUsd);
		expect(hit.costUsd).toBeGreaterThan(0);
	});

	it('cost grows monotonically with tokens (same mix)', () => {
		const small = computeUsage({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } as never, 'm');
		const big = computeUsage({ prompt_tokens: 10_000, completion_tokens: 1000, total_tokens: 11_000 } as never, 'm');
		expect(big.costUsd).toBeGreaterThan(small.costUsd);
	});
});
