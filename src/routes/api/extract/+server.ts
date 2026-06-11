import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';
import { addNewTerms, extractTerms, getEffectiveGlossary } from '$lib/server/glossary';
import { stripLeadingTitle } from '$lib/chapter-label';
import type { RequestHandler } from './$types';

const Body = z.object({ chapterId: z.number().int().positive() });

export const POST: RequestHandler = async ({ request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A numeric chapterId is required.');

	const [chapter] = await db.select().from(chapters).where(eq(chapters.id, parsed.data.chapterId)).limit(1);
	if (!chapter) throw error(404, 'Chapter not found.');

	try {
		// MATCH THE TRANSLATION PIPELINE: STRIP THE REDUNDANT LEADING TITLE LINE SO EXTRACTION SEES THE
		// SAME BODY THE TRANSLATOR DOES (CONSISTENT TERM SET, NO TITLE-ONLY NOISE TERMS).
		const body = stripLeadingTitle(chapter.contentZh, chapter.titleZh);
		// FEED THE EXISTING GLOSSARY AS CONTEXT SO NEW TERMS STAY CONSISTENT WITH ESTABLISHED ONES.
		const terms = await extractTerms(body, await getEffectiveGlossary(chapter.bookId));
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
