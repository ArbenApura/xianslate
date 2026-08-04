// IMPORTED DEP-TYPES
import type { LangPair, TranslationUsage } from '$lib/types';
// IMPORTED MODULES
import { isMonolingual } from '$lib/languages';
import { stripLeadingTitle } from '$lib/chapter-label';
// IMPORTED DEP-MODULES
import { eq } from 'drizzle-orm';
import { db } from './db';
import { chapters } from './db/schema';
import { getCached, saveTranslation, translationCacheKey } from './cache';
import { MODEL } from './deepseek';
import { addNewTerms, bookPair, extractTerms, getEffectiveGlossary } from './glossary';
import { matchTerms } from './glossary-match';
import { recordAiUsage } from './site-stats';
import {
	addUsage,
	containsSourceResidue,
	PROMPT_VERSION,
	realignParagraphs,
	repairSourceResidue,
	translateChapterStreaming,
	translateTitle,
} from './translate';

// -- TYPES -- //

export type TranslationEvent =
	| { type: 'prepare'; paragraphs: number; chars: number } // CHAPTER SCOPE — SHOWN BEFORE ANY WORK STARTS
	// PIPELINE PROGRESS: 'waiting' = QUEUED BEHIND ANOTHER CHAPTER'S EXTRACTION; 'extracting' = TERM SCAN;
	// 'finalizing' = POST-STREAM ALIGNMENT.
	| { type: 'stage'; stage: 'waiting' | 'extracting' | 'finalizing' }
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
	// THE OWNER (Phase 4) — USED TO CHARGE QI AT THE done{cached:false} COMMIT (credit-system_20260615).
	userId: string;
	status: 'running' | 'done' | 'error';
	// THE DEEPSEEK MODEL THIS JOB TRANSLATES/EXTRACTS WITH (FROM THE GLOBAL MODEL PICKER) — ALSO FOLDED INTO
	// THE TRANSLATION CACHE KEY, SO A FLASH AND A PRO TRANSLATION OF THE SAME CHAPTER NEVER COLLIDE.
	model: string;
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

// PER-BOOK EXTRACTION QUEUE TAILS: GLOSSARY EXTRACTION READS-THEN-WRITES THE SHARED PER-BOOK GLOSSARY, SO
// TWO CHAPTERS EXTRACTING AT ONCE WOULD DUPLICATE / CONFLICT TERMS. EACH BOOK'S CHAPTERS CHAIN THEIR
// EXTRACTIONS THROUGH THIS TAIL (withExtractionLock) SO THEY RUN ONE AT A TIME, IN ARRIVAL ORDER.
const extractionTails = new Map<string, Promise<unknown>>();

// SAFETY CAP ON HOW LONG A CHAPTER WAITS FOR THE PRIOR EXTRACTION. NORMAL EXTRACTION TAKES A FEW SECONDS;
// THIS ONLY TRIPS IF THE PRIOR ONE STALLS (E.G. A HUNG MODEL CALL). PROCEEDING THEN RISKS A LITTLE TERM
// OVERLAP (addNewTerms IS ADDITIVE / FIRST-WRITER-WINS — NOT FATAL) BUT STOPS ONE STALL FROM PARKING THE
// WHOLE BOOK'S CHAPTERS AS ZOMBIE 'running' JOBS.
const EXTRACTION_WAIT_CAP_MS = 90_000;

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

// RUN `task` ONLY AFTER ANY IN-FLIGHT EXTRACTION FOR THE SAME BOOK HAS SETTLED — A PER-BOOK SERIAL QUEUE.
// `onQueued` FIRES ONCE IF WE ACTUALLY HAD TO WAIT BEHIND ANOTHER CHAPTER (DRIVES THE 'waiting' UI). THIS
// IS WHAT MAKES "WAIT FOR THE PREVIOUS CHAPTER'S EXTRACTION" REAL-TIME: THE DETACHED JOB JUST WAITS HERE
// AND PROCEEDS THE MOMENT THE PRIOR ONE FINISHES, STREAMING TO WHOEVER IS (RE)CONNECTED — NO REFRESH.
async function withExtractionLock<T>(bookId: string, onQueued: () => void, task: () => Promise<T>): Promise<T> {
	const prev = extractionTails.get(bookId);
	if (prev) onQueued();
	const run = (async () => {
		// WAIT OUT THE PRIOR EXTRACTION, IGNORING ITS OUTCOME — A FAILED ONE MUST NOT BLOCK OURS — BUT NEVER
		// LONGER THAN THE CAP, SO A STALLED EXTRACTION CAN'T FREEZE EVERY LATER CHAPTER OF THE BOOK.
		if (prev) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const capped = new Promise<void>((resolve) => (timer = setTimeout(resolve, EXTRACTION_WAIT_CAP_MS)));
			await Promise.race([prev.catch(() => {}), capped]);
			clearTimeout(timer);
		}
		return task();
	})();
	// PUBLISH OURSELVES AS THE TAIL SO THE NEXT CHAPTER QUEUES BEHIND US.
	extractionTails.set(bookId, run);
	try {
		return await run;
	} finally {
		// CLEAR THE TAIL ONLY IF NOBODY CHAINED AFTER US (OTHERWISE THEY NOW OWN IT).
		if (extractionTails.get(bookId) === run) extractionTails.delete(bookId);
	}
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

		// READ-IN-ORIGINAL BOOK (targetLang='none'): NEVER TRANSLATE OR BILL. SERVE THE SOURCE TITLE/BODY AS A
		// FREE "RESULT" SO ANY STRAY TRANSLATE REQUEST IS A HARMLESS NO-OP. THE READER RENDERS THE SOURCE
		// DIRECTLY AND NEVER STARTS THIS JOB FOR SUCH BOOKS — THIS IS A SERVER-SIDE BACKSTOP.
		if (isMonolingual(pair.targetLang)) {
			emit(job, { type: 'meta', matched: 0, cached: true });
			emit(job, { type: 'title', text: chapter.titleSource });
			emit(job, { type: 'delta', text: body });
			emit(job, { type: 'done', cached: true, matched: 0, usage: ZERO_USAGE });
			job.status = 'done';
			return;
		}

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
					job.model,
				);
				if (rep.repaired) {
					const clean = rep.paras.join('\n\n');
					try {
						await db.update(chapters).set({ contentTarget: clean }).where(eq(chapters.id, chapter.id));
					} catch (e) {
						console.error(`[translate] failed to persist leak repair for chapter ${chapter.id}:`, e);
					}
					emit(job, { type: 'delta', text: clean });
					await recordAiUsage('repair', rep.usage, chapter.id);
					emit(job, { type: 'done', cached: false, matched: terms.length, usage: rep.usage });
					job.status = 'done';
					return;
				}
			}

			// SELF-HEAL: A LEGACY TRANSLATION MAY HAVE DRIFTED OUT OF PARAGRAPH ALIGNMENT (THE MODEL MERGED OR
			// SPLIT PARAGRAPHS), SHIFTING THE TARGET OUT OF SYNC WITH THE SOURCE FROM SOME PARAGRAPH ONWARD. IF
			// THE STORED PARAGRAPH COUNT NO LONGER MATCHES THE SOURCE, REALIGN 1:1 NOW, PERSIST, AND SERVE IT.
			const storedParas = chapter.contentTarget
				.split(/\n{2,}/)
				.map((p) => p.trim())
				.filter((p) => p.length > 0);
			const srcParaCount = body.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
			if (srcParaCount > 0 && storedParas.length !== srcParaCount) {
				const re = await realignParagraphs(body, storedParas, terms, pair, job.controller.signal, job.model);
				if (re.realigned) {
					const aligned = re.paras.join('\n\n');
					try {
						await db.update(chapters).set({ contentTarget: aligned }).where(eq(chapters.id, chapter.id));
					} catch (e) {
						console.error(`[translate] failed to persist alignment repair for chapter ${chapter.id}:`, e);
					}
					await recordAiUsage('repair', re.usage, chapter.id);
					emit(job, { type: 'delta', text: aligned });
					emit(job, { type: 'done', cached: false, matched: terms.length, usage: re.usage });
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
		// EXTRACTION READS THE WHOLE CHAPTER THROUGH THE MODEL — A REAL EXPENSE. TRACK IT (ZERO IF SKIPPED/FAILED).
		let extractUsage = ZERO_USAGE;
		if (autoExtract && !chapter.extractedAt) {
			// SERIALIZE PER BOOK: WAIT FOR ANY EARLIER CHAPTER'S EXTRACTION TO PERSIST ITS TERMS BEFORE READING
			// THE GLOSSARY, SO TWO CHAPTERS NEVER READ-THEN-WRITE IT AT ONCE (WHICH DUPLICATES / CONFLICTS TERMS).
			// THE 'waiting' STAGE LETS THE READER SAY "WAITING FOR THE PREVIOUS CHAPTER…" IN REAL TIME — NO REFRESH.
			await withExtractionLock(
				chapter.bookId,
				() => emit(job, { type: 'stage', stage: 'waiting' }),
				async () => {
					emit(job, { type: 'stage', stage: 'extracting' });
					try {
						// FEED THE EXISTING GLOSSARY AS CONTEXT SO NEW TERMS STAY CONSISTENT WITH ESTABLISHED ONES.
						// INCLUDE THE TITLE SO NAMES THAT APPEAR ONLY IN THE CHAPTER TITLE ARE CAPTURED TOO.
						const { terms: drafts, usage: exUsage } = await extractTerms(
							`${chapter.titleSource}\n\n${body}`,
							pair,
							await getEffectiveGlossary(chapter.bookId),
							job.controller.signal,
							// STREAM PER-CHUNK SCAN PROGRESS TO THE READER ("scanned 2/5 · 14 terms").
							(done, total, terms) => emit(job, { type: 'extract_progress', done, total, terms }),
							job.model,
						);
						// LEDGER THE EXTRACTION SPEND AND FOLD IT INTO THIS CHAPTER'S REPORTED COST.
						extractUsage = exUsage;
						await recordAiUsage('extract', exUsage, chapter.id);
						// ADDITIVE ONLY — NEVER OVERWRITE A TERM ALREADY IN THE GLOSSARY (KEEPS NAMES CONSISTENT). THE
						// CHAPTER id STAMPS first_chapter_id (FIRST APPEARANCE) ON THE FRESH TERMS.
						const res = await addNewTerms(chapter.bookId, drafts, chapter.id);
						const extractedAt = Date.now();
						await db.update(chapters).set({ extractedAt }).where(eq(chapters.id, chapter.id));
						emit(job, { type: 'extracted', extracted: drafts.length, added: res.added, extractedAt });
					} catch {
						emit(job, { type: 'extracted', extracted: 0, added: 0 });
					}
				},
			);
		}

		// STAGE 2 — MATCH GLOSSARY TERMS PRESENT IN THE CHAPTER (PICKS UP ANY JUST-EXTRACTED TERMS)
		const terms = await matchTerms(chapter.bookId, body);
		const cacheKey = translationCacheKey(body, terms, job.model, PROMPT_VERSION, pair);
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
				const r = await translateTitle(chapter.titleSource, titleTerms, pair, job.controller.signal, job.model);
				titleTarget = r.text || chapter.titleSource;
				titleUsage = r.usage;
				await recordAiUsage('title', r.usage, chapter.id);
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
					addUsage(titleUsage, extractUsage),
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
			job.model,
			// POST-STREAM ALIGNMENT/REPAIR STARTED — TELL THE READER SO THE FROZEN LIVE COUNT READS AS "ALIGNING…".
			() => emit(job, { type: 'stage', stage: 'finalizing' }),
		);
		// PERSISTENCE IS ISOLATED FROM THE TRANSLATION RESULT: THE STREAM SUCCEEDED AND THE USER ALREADY SAW
		// (AND PAID FOR) THE FULL TEXT, SO A DB WRITE FAILURE MUST STILL EMIT `done` — NOT `error` (WHICH
		// WOULD MAKE THE NEXT READ RE-BILL THE WHOLE CHAPTER). LOG THE PERSISTENCE FAILURE SEPARATELY.
		try {
			await saveTranslation(chapter.id, cacheKey, text, usage);
		} catch (saveErr) {
			console.error(`[translate] failed to persist chapter ${chapter.id}:`, saveErr);
		}
		emit(job, {
			type: 'done',
			cached: false,
			matched: terms.length,
			usage: addUsage(addUsage(usage, titleUsage), extractUsage),
		});
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
export function ensureTranslationJob(
	chapterId: number,
	force = false,
	autoExtract = false,
	model: string = MODEL,
	userId: string = '',
): Job {
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
		userId,
		status: 'running',
		model,
		events: [],
		listeners: new Set(),
		controller: new AbortController(),
	};
	jobs.set(chapterId, job);
	// DETACHED — RUNS TO COMPLETION REGARDLESS OF ANY CLIENT CONNECTION
	void run(job, force, autoExtract);
	return job;
}
