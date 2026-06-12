// IMPORTED TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, isMonolingual } from '$lib/languages';
import { resolveModel } from '$lib/server/deepseek';
import { bookPair } from '$lib/server/glossary';
import { matchTerms } from '$lib/server/glossary-match';
import { recordAiUsage } from '$lib/server/site-stats';
import { translateTerm, translateTitle } from '$lib/server/translate';

// -- CONSTANTS -- //

const Body = z.object({
	text: z.string().trim().min(1),
	// 'title' = A CHAPTER TITLE (GLOSSARY-AWARE); 'term' = A SINGLE GLOSSARY ENTRY
	kind: z.enum(['title', 'term']).default('title'),
	// SCOPES GLOSSARY MATCHING FOR 'title' SO NAMES IN THE TITLE STAY CONSISTENT WITH THE BOOK
	bookId: z.string().optional(),
	// THE GLOBAL MODEL PICK (flash/pro) — VALIDATED SERVER-SIDE.
	model: z.string().optional(),
});

// -- FUNCTIONS -- //

// ONE-OFF SHORT-STRING TRANSLATION (TITLE OR GLOSSARY TERM) — USED BY THE INLINE "Translate" HELPERS.
export const POST: RequestHandler = async ({ request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Text is required.');
	const { text, kind, bookId } = parsed.data;
	const model = resolveModel(parsed.data.model);

	try {
		// THE DIRECTION: A BOOK-SCOPED CALL USES THE BOOK'S PAIR; OTHERWISE THE APP DEFAULT (zh-Hant → en).
		const pair = bookId
			? await bookPair(bookId)
			: { sourceLang: DEFAULT_SOURCE_LANG, targetLang: DEFAULT_TARGET_LANG };
		// READ-IN-ORIGINAL BOOK: NO TRANSLATION — ECHO THE SOURCE TEXT BACK SO NO MODEL CALL IS MADE INTO THE
		// FALLBACK LANGUAGE (DEFENSE IN DEPTH BEHIND THE UI, WHICH HIDES THE TRANSLATE HELPERS FOR THESE BOOKS).
		if (isMonolingual(pair.targetLang)) return json({ text });
		// GLOSSARY-AWARE: TERMS ALREADY IN THE DB THAT APPEAR INSIDE THE TEXT (FREE, LOCAL AHO-CORASICK)
		const terms = bookId ? await matchTerms(bookId, text) : [];
		if (kind === 'term') {
			// IF THIS EXACT TERM IS ALREADY IN THE GLOSSARY, REUSE ITS TRANSLATION — NO MODEL CALL, STAYS CONSISTENT
			const exact = terms.find((t) => t.source === text);
			if (exact) return json({ text: exact.target });
			const r = await translateTerm(text, pair, terms, undefined, model);
			// LEDGER THE ONE-OFF TERM TRANSLATION SPEND (kind='term').
			await recordAiUsage('term', r.usage);
			return json({ text: r.text });
		}
		// TITLE: FEED ANY GLOSSARY TERMS THAT APPEAR IN THE TITLE SO NAMES RENDER CONSISTENTLY
		const r = await translateTitle(text, terms, pair, undefined, model);
		// LEDGER THE ONE-OFF TITLE TRANSLATION SPEND (kind='title').
		await recordAiUsage('title', r.usage);
		return json({ text: r.text });
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'Translation failed.');
	}
};
