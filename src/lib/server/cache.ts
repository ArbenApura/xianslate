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
	// EACH PROMPT-AFFECTING PIECE IS APPENDED ONLY WHEN PRESENT, SO A PLAIN TERM KEEPS ITS ORIGINAL
	// FINGERPRINT (NO MASS CACHE BUST) — A TERM THAT GAINS context / a pin / aliases BUSTS ONLY ITS OWN
	// CHAPTERS ON THE NEXT FORCED/NEW RUN, SINCE ALL THREE NOW FEED THE TRANSLATION PROMPT AND CAN CHANGE
	// THE OUTPUT. category / status / first_chapter ARE METADATA (NOT IN THE PROMPT) AND ARE EXCLUDED.
	const norm = terms
		.map((t) => {
			const ctx = t.context?.trim() ? `@${t.context.trim()}` : '';
			const pin = t.pinned ? '!' : '';
			const alias = t.aliases?.length ? `~${[...t.aliases].sort().join(',')}` : '';
			return `${t.source}=${t.target}#${t.gender}${ctx}${pin}${alias}`;
		})
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
