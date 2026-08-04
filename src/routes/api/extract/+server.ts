// IMPORTED TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { assertChapterOwner } from '$lib/server/books';
import { db } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';
import { resolveModel } from '$lib/server/deepseek';
import { addNewTerms, bookPair, extractTerms, getEffectiveGlossary } from '$lib/server/glossary';
import { matchTerms, sourcesPresentIn } from '$lib/server/glossary-match';
import { recordAiUsage } from '$lib/server/site-stats';
import { stripLeadingTitle } from '$lib/chapter-label';

// -- CONSTANTS -- //

const Body = z.object({ chapterId: z.number().int().positive(), model: z.string().optional() });

// -- FUNCTIONS -- //

// FREE LOOKUP (NO MODEL CALL): THE GLOSSARY TERMS THAT ACTUALLY APPEAR IN THIS CHAPTER — THE SAME SET THE
// TRANSLATOR USES. POWERS THE "TERMS IN THIS CHAPTER" DIALOG FOR AN ALREADY-EXTRACTED CHAPTER.
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireUser(locals);
	const chapterId = Number(url.searchParams.get('chapterId'));
	if (!Number.isInteger(chapterId) || chapterId <= 0) throw error(400, 'A numeric chapterId is required.');

	// OWNERSHIP: assertChapterOwner 404s IF THE CHAPTER ISN'T IN THIS USER'S LIBRARY.
	const chapter = await assertChapterOwner(user.id, chapterId);

	// INCLUDE THE TITLE SO TERMS THAT APPEAR ONLY THERE ARE COUNTED AS "IN THIS CHAPTER" TOO
	const body = stripLeadingTitle(chapter.contentSource, chapter.titleSource);
	const terms = await matchTerms(chapter.bookId, `${chapter.titleSource}\n\n${body}`);

	// "NEW TO THIS CHAPTER" = A TERM THAT FIRST APPEARS HERE, IN NO EARLIER CHAPTER (BY seq). GATHER THE SOURCE
	// TEXT OF EVERY EARLIER CHAPTER AND SUBTRACT THE TERMS ALREADY PRESENT THERE — APPEARANCE-BASED, SO IT'S
	// DETERMINISTIC AND INDEPENDENT OF WHEN EXTRACTION HAPPENED TO RUN (THE OLD createdAt/extractedAt HEURISTIC).
	const earlier = await db
		.select({ titleSource: chapters.titleSource, contentSource: chapters.contentSource })
		.from(chapters)
		.where(and(eq(chapters.bookId, chapter.bookId), lt(chapters.seq, chapter.seq)));
	const earlierText = earlier.map((c) => `${c.titleSource}\n\n${c.contentSource}`).join('\n\n');
	const seenEarlier = await sourcesPresentIn(
		chapter.bookId,
		earlierText,
		terms.map((t) => t.source),
	);
	const newSources = terms.filter((t) => !seenEarlier.has(t.source)).map((t) => t.source);

	return json({ terms, extractedAt: chapter.extractedAt, newSources });
};

// STREAMS THE EXTRACTION AS SERVER-SENT EVENTS SO THE READER CAN SHOW LIVE PROGRESS (chunk X/Y · N terms):
//   {type:'progress', done, total, terms}  ·  {type:'done', extracted, added, extractedAt}  ·  {type:'error', message}
// SIDE EFFECTS (ai_usage LEDGER, additive addNewTerms, extractedAt) STILL RUN TO COMPLETION EVEN IF THE CLIENT
// DISCONNECTS MID-SCAN — THE work IS DRIVEN BY THE STREAM's start(), NOT THE CLIENT CONNECTION.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A numeric chapterId is required.');
	// OWNERSHIP IS CHECKED BEFORE THE STREAM OPENS, SO A 404 IS A NORMAL (NON-SSE) RESPONSE.
	const chapter = await assertChapterOwner(user.id, parsed.data.chapterId);
	const model = resolveModel(parsed.data.model);

	const stream = new ReadableStream<Uint8Array>({
		async start(ctrl) {
			const enc = new TextEncoder();
			let closed = false;
			const send = (evt: unknown) => {
				if (!closed) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(evt)}\n\n`));
			};
			// HEARTBEAT — KEEPS PROXIES FROM TIMING OUT THE IDLE CONNECTION DURING A LONG SCAN.
			const ping = setInterval(() => {
				try {
					if (!closed) ctrl.enqueue(enc.encode(': ping\n\n'));
				} catch {
					/* STREAM ALREADY CLOSED */
				}
			}, 15_000);
			try {
				// MATCH THE TRANSLATION PIPELINE: STRIP THE REDUNDANT LEADING TITLE LINE SO EXTRACTION SEES THE
				// SAME BODY THE TRANSLATOR DOES, BUT PREPEND THE TITLE SO TITLE-ONLY NAMES ARE STILL CAPTURED.
				const body = stripLeadingTitle(chapter.contentSource, chapter.titleSource);
				const pair = await bookPair(chapter.bookId);
				// FEED THE EXISTING GLOSSARY AS CONTEXT SO NEW TERMS STAY CONSISTENT WITH ESTABLISHED ONES, AND
				// STREAM PER-CHUNK SCAN PROGRESS TO THE READER.
				const { terms, usage } = await extractTerms(
					`${chapter.titleSource}\n\n${body}`,
					pair,
					await getEffectiveGlossary(chapter.bookId),
					undefined,
					(done, total, found) => send({ type: 'progress', done, total, terms: found }),
					model,
				);
				// THE MANUAL "Extract terms" ACTION BILLS A FULL CHAPTER READ TOO — LEDGER IT (kind='extract').
				await recordAiUsage('extract', usage, chapter.id);
				// ADDITIVE ONLY — SKIP TERMS ALREADY IN THE GLOSSARY (BOOK OR GLOBAL); NEVER OVERWRITE THEM. THE
				// CHAPTER id STAMPS first_chapter_id (FIRST APPEARANCE) ON THE FRESH TERMS.
				const { added } = await addNewTerms(chapter.bookId, terms, chapter.id);
				// MARK THE CHAPTER EXTRACTED SO THE TRANSLATE PIPELINE'S AUTO-EXTRACT (GATED ON extractedAt) DOESN'T
				// RE-RUN AND RE-BILL THE SAME EXTRACTION LATER.
				const extractedAt = Date.now();
				await db.update(chapters).set({ extractedAt }).where(eq(chapters.id, chapter.id));
				send({ type: 'done', extracted: terms.length, added, extractedAt });
			} catch (e) {
				send({ type: 'error', message: e instanceof Error ? e.message : 'Term extraction failed.' });
			} finally {
				clearInterval(ping);
				closed = true;
				try {
					ctrl.close();
				} catch {
					/* ALREADY CLOSED BY A CLIENT DISCONNECT */
				}
			}
		},
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
		},
	});
};
