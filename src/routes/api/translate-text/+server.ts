// IMPORTED TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, isMonolingual } from '$lib/languages';
import { requireUser } from '$lib/server/auth/user';
import { assertBookOwner, assertChapterOwner } from '$lib/server/books';
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
	// ATTRIBUTE THIS ONE-OFF SPEND TO A CHAPTER WHEN THE CALL ORIGINATES FROM A CHAPTER READING CONTEXT (THE
	// READER'S GLOSSARY PANEL) — SO THE TERM/TITLE COST SHOWS ON THAT CHAPTER'S STATS, NOT JUST THE ADMIN TOTAL.
	chapterId: z.number().int().positive().optional(),
	// FORCE A FRESH MODEL TRANSLATION EVEN WHEN THE EXACT TERM IS ALREADY IN THE GLOSSARY — THE EDITOR'S
	// "Translate" RE-GENERATES A SUGGESTION FOR AN EXISTING TERM (WITHOUT THIS IT WOULD JUST ECHO THE CURRENT
	// target AND LOOK BROKEN). THE READER'S HELPERS LEAVE THIS UNSET SO THEY REUSE THE STORED RENDERING (FREE).
	fresh: z.boolean().optional(),
	// THE GLOBAL MODEL PICK (flash/pro) — VALIDATED SERVER-SIDE.
	model: z.string().optional(),
});

// -- FUNCTIONS -- //

// ONE-OFF SHORT-STRING TRANSLATION (TITLE OR GLOSSARY TERM) — USED BY THE INLINE "Translate" HELPERS.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Text is required.');
	const { text, kind, bookId, chapterId, fresh } = parsed.data;
	const model = resolveModel(parsed.data.model);
	// OWNERSHIP: A bookId-SCOPED CALL (GLOSSARY-AWARE) MUST REFERENCE THE CALLER'S OWN BOOK.
	if (bookId) await assertBookOwner(user.id, bookId);
	// OWNERSHIP: A chapter-ATTRIBUTED CALL MUST REFERENCE THE CALLER'S OWN CHAPTER — STOPS A GUESSED id FROM
	// CHARGING ANOTHER USER'S CHAPTER STATS, AND GUARANTEES THE ai_usage CHAPTER FK ACTUALLY EXISTS.
	if (chapterId) await assertChapterOwner(user.id, chapterId);

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
			// REUSE AN EXACT GLOSSARY MATCH (NO MODEL CALL, STAYS CONSISTENT) — UNLESS fresh, WHERE THE CALLER
			// (THE EDITOR'S "Translate") EXPLICITLY WANTS A NEWLY-GENERATED SUGGESTION FOR AN EXISTING TERM.
			const exact = terms.find((t) => t.source === text);
			if (exact && !fresh) return json({ text: exact.target });
			// FOR A fresh RE-TRANSLATE, DROP THE TERM ITSELF FROM THE GLOSSARY CONTEXT SO THE MODEL DOESN'T JUST
			// ECHO ITS CURRENT RENDERING — THE OTHER TERMS STILL GUIDE NAMING CONSISTENCY.
			const ctx = fresh ? terms.filter((t) => t.source !== text) : terms;
			const r = await translateTerm(text, pair, ctx, undefined, model);
			// LEDGER THE ONE-OFF TERM TRANSLATION SPEND (kind='term'), ATTRIBUTED TO THE CHAPTER WHEN ONE IS GIVEN.
			await recordAiUsage('term', r.usage, chapterId);
			return json({ text: r.text });
		}
		// TITLE: FEED ANY GLOSSARY TERMS THAT APPEAR IN THE TITLE SO NAMES RENDER CONSISTENTLY
		const r = await translateTitle(text, terms, pair, undefined, model);
		// LEDGER THE ONE-OFF TITLE TRANSLATION SPEND (kind='title'), ATTRIBUTED TO THE CHAPTER WHEN ONE IS GIVEN.
		await recordAiUsage('title', r.usage, chapterId);
		return json({ text: r.text });
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'Translation failed.');
	}
};
