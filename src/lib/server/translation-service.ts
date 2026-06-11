// IMPORTED DEP-TYPES
import type { LangPair, TranslationUsage } from '$lib/types';
// IMPORTED MODULES
import { stripLeadingTitle } from '$lib/chapter-label';
// IMPORTED DEP-MODULES
import { eq } from 'drizzle-orm';
import { db } from './db';
import { chapters } from './db/schema';
import { getCached, saveTranslation, translationCacheKey } from './cache';
import { MODEL } from './deepseek';
import { addNewTerms, bookPair, extractTerms, getEffectiveGlossary } from './glossary';
import { matchTerms } from './glossary-match';
import {
	addUsage,
	containsSourceResidue,
	PROMPT_VERSION,
	repairSourceResidue,
	translateChapterStreaming,
	translateTitle,
} from './translate';

// -- TYPES -- //

export type TranslationEvent =
	| { type: 'prepare'; paragraphs: number; chars: number } // CHAPTER SCOPE — SHOWN BEFORE ANY WORK STARTS
	| { type: 'stage'; stage: 'extracting' } // PIPELINE PROGRESS BEFORE THE MATCHED-TERM META ARRIVES
	| { type: 'extract_progress'; done: number; total: number; terms: number } // PER-CHUNK TERM-SCAN PROGRESS
	// extractedAt IS PRESENT ONLY WHEN EXTRACTION SUCCEEDED + PERSISTED — LETS THE READER FLIP ITS
	// "Extract terms" CONTROL TO "View terms" WITHOUT A RELOAD.
	| { type: 'extracted'; extracted: number; added: number; extractedAt?: number }
	| { type: 'meta'; matched: number; cached: boolean }
	| { type: 'title'; text: string }
	| { type: 'delta'; text: string }
	| { type: 'replace'; text: string } // FULL-TEXT CORRECTION (E.G. AFTER A CHINESE-LEAK REPAIR PASS)
	| { type: 'done'; cached: boolean; matched: number; usage: TranslationUsage }
	| { type: 'error'; message: string };

type Listener = (evt: TranslationEvent) => void;

interface Job {
	chapterId: number;
	status: 'running' | 'done' | 'error';
	events: TranslationEvent[]; // BUFFERED FOR REPLAY TO (RE)CONNECTING CLIENTS
	listeners: Set<Listener>;
	controller: AbortController; // ABORTS THE IN-FLIGHT LLM CALLS WHEN A force RE-RUN SUPERSEDES THIS JOB
}

// -- CONSTANTS -- //

const ZERO_USAGE: TranslationUsage = {
	model: MODEL,
	promptTokens: 0,
	cachedTokens: 0,
	completionTokens: 0,
	costUsd: 0,
};

// MODULE-LEVEL REGISTRY: ONE DETACHED JOB PER CHAPTER. SURVIVES CLIENT DISCONNECTS;
// COMPLETION IS PERSISTED TO THE DB, SO CLOSING THE BROWSER DOES NOT LOSE PROGRESS.
const jobs = new Map<number, Job>();

// -- FUNCTIONS -- //

function emit(job: Job, evt: TranslationEvent) {
	job.events.push(evt);
	for (const l of job.listeners) {
		try {
			l(evt);
		} catch {
			// A DEAD LISTENER MUST NOT KILL THE JOB
		}
	}
}

/** chapterIds WITH A TRANSLATION JOB CURRENTLY RUNNING — DRIVES THE LIVE 'TRANSLATING' LIST BADGES. */
export function runningChapterIds(): number[] {
	const ids: number[] = [];
	for (const [id, job] of jobs) if (job.status === 'running') ids.push(id);
	return ids;
}

/** SUBSCRIBE TO A JOB — REPLAYS BUFFERED EVENTS, THEN STREAMS NEW ONES. RETURNS AN UNSUBSCRIBE FN. */
export function subscribe(job: Job, listener: Listener): () => void {
	for (const e of job.events) listener(e);
	job.listeners.add(listener);
	return () => job.listeners.delete(listener);
}

async function run(job: Job, force: boolean, autoExtract: boolean) {
	try {
		const [chapter] = await db.select().from(chapters).where(eq(chapters.id, job.chapterId)).limit(1);
		if (!chapter) {
			emit(job, { type: 'error', message: 'Chapter not found.' });
			job.status = 'error';
			return;
		}

		// THE BOOK'S TRANSLATION DIRECTION — DRIVES PROMPTS, RESIDUE DETECTION, AND THE CACHE KEY.
		const pair: LangPair = await bookPair(chapter.bookId);

		// CUT A REDUNDANT LEADING TITLE LINE THAT SCRAPERS REPEAT AT THE TOP OF THE BODY, SO THE
		// TRANSLATION STARTS AT THE ACTUAL PROSE (THE READER STRIPS THE SAME LINE FROM THE SOURCE).
		const body = stripLeadingTitle(chapter.contentSource, chapter.titleSource);

		// FAST PATH: ALREADY TRANSLATED → SERVE THE STORED TARGET TEXT. NEVER RE-BILL OR RE-EXTRACT ON A
		// RE-READ/RE-NAVIGATION, REGARDLESS OF ANY GLOSSARY DRIFT SINCE IT WAS TRANSLATED. RE-TRANSLATE
		// (force) IS THE ONLY WAY TO REDO IT. matchTerms IS LOCAL/FREE, SO THE METER STAYS ACCURATE.
		if (chapter.contentTarget && !force) {
			const terms = await matchTerms(chapter.bookId, body);
			emit(job, { type: 'meta', matched: terms.length, cached: true });
			emit(job, { type: 'title', text: chapter.titleTarget ?? chapter.titleSource });

			// SELF-HEAL: AN OLDER TRANSLATION MAY HAVE LEAKED UNTRANSLATED SOURCE SCRIPT. IF THE STORED
			// TARGET STILL CONTAINS SOURCE-SCRIPT RESIDUE, REPAIR JUST THOSE PARAGRAPHS NOW, PERSIST THE
			// CLEANED TEXT, AND SERVE THAT — SO LEGACY LEAKED CHAPTERS FIX THEMSELVES ON THE NEXT READ.
			if (containsSourceResidue(chapter.contentTarget, pair.sourceLang)) {
				const rep = await repairSourceResidue(
					chapter.contentTarget.split(/\n{2,}/),
					terms,
					pair,
					job.controller.signal,
				);
				if (rep.repaired) {
					const clean = rep.paras.join('\n\n');
					try {
						await db.update(chapters).set({ contentTarget: clean }).where(eq(chapters.id, chapter.id));
					} catch (e) {
						console.error(`[translate] failed to persist leak repair for chapter ${chapter.id}:`, e);
					}
					emit(job, { type: 'delta', text: clean });
					emit(job, { type: 'done', cached: false, matched: terms.length, usage: rep.usage });
					job.status = 'done';
					return;
				}
			}

			emit(job, { type: 'delta', text: chapter.contentTarget });
			emit(job, { type: 'done', cached: true, matched: terms.length, usage: ZERO_USAGE });
			job.status = 'done';
			return;
		}

		// ANNOUNCE THE CHAPTER SCOPE UP FRONT — PARAGRAPH + CHARACTER COUNTS DRIVE THE DETAILED PROGRESS UI
		// SO THE READER SEES "48 paragraphs · ~9k chars" BEFORE ANY MODEL CALL STARTS.
		const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
		emit(job, { type: 'prepare', paragraphs, chars: body.length });

		// PIPELINE STAGE 1 — AUTO-EXTRACT + SAVE GLOSSARY TERMS, ONCE PER CHAPTER (extractedAt GATES IT).
		// NON-FATAL: AN EXTRACTION FAILURE MUST NOT BLOCK THE TRANSLATION.
		if (autoExtract && !chapter.extractedAt) {
			emit(job, { type: 'stage', stage: 'extracting' });
			try {
				// FEED THE EXISTING GLOSSARY AS CONTEXT SO NEW TERMS STAY CONSISTENT WITH ESTABLISHED ONES.
				// INCLUDE THE TITLE SO NAMES THAT APPEAR ONLY IN THE CHAPTER TITLE ARE CAPTURED TOO.
				const drafts = await extractTerms(
					`${chapter.titleSource}\n\n${body}`,
					pair,
					await getEffectiveGlossary(chapter.bookId),
					job.controller.signal,
					// STREAM PER-CHUNK SCAN PROGRESS TO THE READER ("scanned 2/5 · 14 terms").
					(done, total, terms) => emit(job, { type: 'extract_progress', done, total, terms }),
				);
				// ADDITIVE ONLY — NEVER OVERWRITE A TERM ALREADY IN THE GLOSSARY (KEEPS NAMES CONSISTENT).
				const res = await addNewTerms(chapter.bookId, drafts);
				const extractedAt = Date.now();
				await db.update(chapters).set({ extractedAt }).where(eq(chapters.id, chapter.id));
				emit(job, { type: 'extracted', extracted: drafts.length, added: res.added, extractedAt });
			} catch {
				emit(job, { type: 'extracted', extracted: 0, added: 0 });
			}
		}

		// STAGE 2 — MATCH GLOSSARY TERMS PRESENT IN THE CHAPTER (PICKS UP ANY JUST-EXTRACTED TERMS)
		const terms = await matchTerms(chapter.bookId, body);
		const cacheKey = translationCacheKey(body, terms, MODEL, PROMPT_VERSION, pair);
		const cached = force ? null : await getCached(cacheKey);
		emit(job, { type: 'meta', matched: terms.length, cached: !!cached });

		// TITLE — REUSE STORED titleTarget UNLESS FORCED. THE TITLE CALL IS BILLED TOO, SO ITS USAGE IS
		// FOLDED INTO THE done EVENT BELOW (PREVIOUSLY DISCARDED, UNDERCOUNTING THE COST METER).
		let titleTarget = chapter.titleTarget;
		let titleUsage = ZERO_USAGE;
		if (!titleTarget || force) {
			try {
				// MATCH THE TITLE SEPARATELY SO NAMES THAT APPEAR ONLY IN THE TITLE ARE STILL GLOSSARY-AWARE
				// (THE BODY-MATCHED `terms` ABOVE CAN MISS THEM) — SAME BEHAVIOR AS THE MANUAL TITLE TRANSLATE.
				const titleTerms = await matchTerms(chapter.bookId, chapter.titleSource);
				const r = await translateTitle(chapter.titleSource, titleTerms, pair, job.controller.signal);
				titleTarget = r.text || chapter.titleSource;
				titleUsage = r.usage;
				await db.update(chapters).set({ titleTarget }).where(eq(chapters.id, chapter.id));
			} catch {
				titleTarget = chapter.titleSource;
			}
		}
		emit(job, { type: 'title', text: titleTarget });

		if (cached) {
			// BACKFILL chapter.contentTarget SO EVERY SUBSEQUENT READ HITS THE FREE FAST PATH ABOVE
			await db
				.update(chapters)
				.set({ contentTarget: cached.contentTarget, translatedAt: Date.now() })
				.where(eq(chapters.id, chapter.id));
			emit(job, { type: 'delta', text: cached.contentTarget });
			// THE BODY WAS FREE (CACHE HIT) BUT A FORCED RUN MAY HAVE RE-TRANSLATED THE TITLE — FOLD ITS
			// REAL COST IN SO THE METER ISN'T UNDER-REPORTED (PREVIOUSLY titleUsage WAS DISCARDED HERE).
			emit(job, {
				type: 'done',
				cached: true,
				matched: terms.length,
				usage: addUsage(
					{
						model: cached.model,
						promptTokens: cached.promptTokens ?? 0,
						cachedTokens: cached.cachedTokens ?? 0,
						completionTokens: cached.completionTokens ?? 0,
						costUsd: 0,
					},
					titleUsage,
				),
			});
			job.status = 'done';
			return;
		}

		// STAGE 3 — TRANSLATE (THE MAIN BILLED STEP). STORE THE BODY-ONLY USAGE ON THE CACHE ROW (THE
		// cacheKey IS BODY-DERIVED), BUT REPORT BODY + TITLE TOGETHER SO THE LIVE METER IS ACCURATE.
		const { text, usage } = await translateChapterStreaming(
			body,
			terms,
			pair,
			(d) => emit(job, { type: 'delta', text: d }),
			job.controller.signal,
			(full) => emit(job, { type: 'replace', text: full }),
		);
		// PERSISTENCE IS ISOLATED FROM THE TRANSLATION RESULT: THE STREAM SUCCEEDED AND THE USER ALREADY SAW
		// (AND PAID FOR) THE FULL TEXT, SO A DB WRITE FAILURE MUST STILL EMIT `done` — NOT `error` (WHICH
		// WOULD MAKE THE NEXT READ RE-BILL THE WHOLE CHAPTER). LOG THE PERSISTENCE FAILURE SEPARATELY.
		try {
			await saveTranslation(chapter.id, cacheKey, text, usage);
		} catch (saveErr) {
			console.error(`[translate] failed to persist chapter ${chapter.id}:`, saveErr);
		}
		emit(job, { type: 'done', cached: false, matched: terms.length, usage: addUsage(usage, titleUsage) });
		job.status = 'done';
	} catch (e) {
		emit(job, { type: 'error', message: e instanceof Error ? e.message : 'Translation failed.' });
		job.status = 'error';
	} finally {
		// KEEP A FINISHED JOB BRIEFLY SO RECONNECTING CLIENTS CAN REPLAY, THEN DROP IT
		// (RE-REQUESTS AFTER THIS HIT THE PERSISTED DB MEMO INSTANTLY).
		if (job.status !== 'running') {
			setTimeout(() => {
				if (jobs.get(job.chapterId) === job) jobs.delete(job.chapterId);
			}, 30_000);
		}
	}
}

/** START OR ATTACH TO THE TRANSLATION JOB FOR A CHAPTER (IDEMPOTENT) */
export function ensureTranslationJob(chapterId: number, force = false, autoExtract = false): Job {
	const existing = jobs.get(chapterId);
	if (existing && existing.status === 'running') {
		// A NON-FORCED REQUEST ATTACHES TO THE IN-FLIGHT JOB (NO DOUBLE WORK). A force REQUEST SUPERSEDES
		// IT: ABORT THE STALE RUN'S LLM CALLS SO force ACTUALLY RE-TRANSLATES INSTEAD OF SILENTLY REUSING
		// THE OLD RESULT (AND SO TWO JOBS DON'T BILL + RACE ON THE SAME CHAPTER).
		if (!force) return existing;
		existing.controller.abort();
	} else if (existing && !force) {
		// A FINISHED JOB IS REUSED UNLESS A FRESH (force) RUN IS REQUESTED
		return existing;
	}

	const job: Job = {
		chapterId,
		status: 'running',
		events: [],
		listeners: new Set(),
		controller: new AbortController(),
	};
	jobs.set(chapterId, job);
	// DETACHED — RUNS TO COMPLETION REGARDLESS OF ANY CLIENT CONNECTION
	void run(job, force, autoExtract);
	return job;
}
