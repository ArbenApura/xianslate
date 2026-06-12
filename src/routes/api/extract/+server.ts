// IMPORTED TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
// IMPORTED MODULES
import { db } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';
import { resolveModel } from '$lib/server/deepseek';
import { addNewTerms, bookPair, extractTerms, getEffectiveGlossary } from '$lib/server/glossary';
import { matchTerms } from '$lib/server/glossary-match';
import { recordAiUsage } from '$lib/server/site-stats';
import { stripLeadingTitle } from '$lib/chapter-label';

// -- CONSTANTS -- //

const Body = z.object({ chapterId: z.number().int().positive(), model: z.string().optional() });

// -- FUNCTIONS -- //

// FREE LOOKUP (NO MODEL CALL): THE GLOSSARY TERMS THAT ACTUALLY APPEAR IN THIS CHAPTER — THE SAME SET THE
// TRANSLATOR USES. POWERS THE "TERMS IN THIS CHAPTER" DIALOG FOR AN ALREADY-EXTRACTED CHAPTER.
export const GET: RequestHandler = async ({ url }) => {
	const chapterId = Number(url.searchParams.get('chapterId'));
	if (!Number.isInteger(chapterId) || chapterId <= 0) throw error(400, 'A numeric chapterId is required.');

	const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
	if (!chapter) throw error(404, 'Chapter not found.');

	// INCLUDE THE TITLE SO TERMS THAT APPEAR ONLY THERE ARE COUNTED AS "IN THIS CHAPTER" TOO
	const body = stripLeadingTitle(chapter.contentSource, chapter.titleSource);
	const terms = await matchTerms(chapter.bookId, `${chapter.titleSource}\n\n${body}`);
	return json({ terms, extractedAt: chapter.extractedAt });
};

export const POST: RequestHandler = async ({ request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A numeric chapterId is required.');

	const [chapter] = await db.select().from(chapters).where(eq(chapters.id, parsed.data.chapterId)).limit(1);
	if (!chapter) throw error(404, 'Chapter not found.');

	try {
		// MATCH THE TRANSLATION PIPELINE: STRIP THE REDUNDANT LEADING TITLE LINE SO EXTRACTION SEES THE
		// SAME BODY THE TRANSLATOR DOES, BUT PREPEND THE TITLE SO TITLE-ONLY NAMES ARE STILL CAPTURED.
		const body = stripLeadingTitle(chapter.contentSource, chapter.titleSource);
		const pair = await bookPair(chapter.bookId);
		// FEED THE EXISTING GLOSSARY AS CONTEXT SO NEW TERMS STAY CONSISTENT WITH ESTABLISHED ONES.
		const { terms, usage } = await extractTerms(
			`${chapter.titleSource}\n\n${body}`,
			pair,
			await getEffectiveGlossary(chapter.bookId),
			undefined,
			undefined,
			resolveModel(parsed.data.model),
		);
		// THE MANUAL "Extract terms" ACTION BILLS A FULL CHAPTER READ TOO — LEDGER IT (kind='extract').
		await recordAiUsage('extract', usage, chapter.id);
		// ADDITIVE ONLY — SKIP TERMS ALREADY IN THE GLOSSARY (BOOK OR GLOBAL); NEVER OVERWRITE THEM.
		const { added, skipped } = await addNewTerms(chapter.bookId, terms);
		// MARK THE CHAPTER EXTRACTED SO THE TRANSLATE PIPELINE'S AUTO-EXTRACT (GATED ON extractedAt) DOESN'T
		// RE-RUN AND RE-BILL THE SAME EXTRACTION LATER.
		await db.update(chapters).set({ extractedAt: Date.now() }).where(eq(chapters.id, chapter.id));
		return json({ added, skipped, updated: 0, extracted: terms.length, terms });
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'Term extraction failed.');
	}
};
