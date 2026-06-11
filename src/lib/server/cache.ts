// IMPORTED DEP-MODULES
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
// IMPORTED TYPES
import type { Translation } from './db/schema';
import type { LangPair, TermDraft, TranslationUsage } from '$lib/types';
// IMPORTED MODULES
import { db } from './db';
import { chapters, translations } from './db/schema';

// -- FUNCTIONS -- //

/** STABLE FINGERPRINT OF THE MATCHED GLOSSARY (ORDER-INDEPENDENT) */
export function glossaryFingerprint(terms: TermDraft[]): string {
	// CONTEXT IS APPENDED ONLY WHEN PRESENT, SO TERMS WITHOUT A NOTE KEEP THEIR ORIGINAL FINGERPRINT
	// (NO MASS CACHE BUST) — A TERM THAT GAINS CONTEXT DOES BUST ITS CHAPTERS, SINCE CONTEXT NOW FEEDS
	// THE TRANSLATION PROMPT AND CAN CHANGE THE OUTPUT.
	const norm = terms
		.map((t) => `${t.source}=${t.target}#${t.gender}${t.context?.trim() ? `@${t.context.trim()}` : ''}`)
		.sort()
		.join('\n');
	return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

/** MEMO KEY — A CHAPTER IS ONLY RE-BILLED IF TEXT, GLOSSARY, MODEL, PROMPT, OR LANGUAGE PAIR CHANGES */
export function translationCacheKey(
	contentSource: string,
	terms: TermDraft[],
	model: string,
	promptVersion: string,
	pair: LangPair,
): string {
	const contentHash = createHash('sha256').update(contentSource).digest('hex');
	const dir = `${pair.sourceLang}>${pair.targetLang}`;
	const payload = `${promptVersion} ${dir} ${model} ${glossaryFingerprint(terms)} ${contentHash}`;
	return createHash('sha256').update(payload).digest('hex');
}

export async function getCached(cacheKey: string): Promise<Translation | null> {
	const [row] = await db.select().from(translations).where(eq(translations.cacheKey, cacheKey)).limit(1);
	return row ?? null;
}

/** PERSIST A TRANSLATION + MIRROR IT ONTO THE CHAPTER ROW */
export async function saveTranslation(
	chapterId: number,
	cacheKey: string,
	contentTarget: string,
	usage: TranslationUsage,
): Promise<void> {
	await db
		.insert(translations)
		.values({
			chapterId,
			cacheKey,
			contentTarget,
			model: usage.model,
			promptTokens: usage.promptTokens,
			cachedTokens: usage.cachedTokens,
			completionTokens: usage.completionTokens,
			costUsd: usage.costUsd,
		})
		.onConflictDoUpdate({
			target: translations.cacheKey,
			// REFRESH EVERY USAGE FIELD ON A FORCED RE-TRANSLATE THAT REUSES THE SAME cacheKey,
			// SO STORED TOKEN/COST/MODEL STATS NEVER GO STALE.
			set: {
				contentTarget,
				model: usage.model,
				promptTokens: usage.promptTokens,
				cachedTokens: usage.cachedTokens,
				completionTokens: usage.completionTokens,
				costUsd: usage.costUsd,
			},
		});
	await db.update(chapters).set({ contentTarget, translatedAt: Date.now() }).where(eq(chapters.id, chapterId));
}
