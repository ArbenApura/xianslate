// AI-LEARNED, SELF-HEALING PARSER ORCHESTRATION FOR SCRAPED CHAPTER PAGES.
//
// THE PURE PARSING + MAPPING LOGIC LIVES IN site-parser.ts (FRAMEWORK-FREE, TESTABLE). THIS MODULE ADDS
// THE STATEFUL PARTS: A PER-HOST SelectorMap CACHE, DB PERSISTENCE, THE DEEPSEEK CALL, AND THE SELF-HEAL.
//
//   THE MODEL MAPS *SELECTORS* ONCE PER HOST — NOT CONTENT PER PAGE.
//
// FLOW PER FETCH:
//   1. LOAD THE HOST'S SelectorMap (MEMORY CACHE → DB ROW).
//   2. APPLY IT DETERMINISTICALLY (ZERO LLM COST). IF IT EXTRACTS A REAL CHAPTER, DONE.
//   3. IF NOT (NEW HOST, OR THE SITE REDESIGNED) → ASK DEEPSEEK TO MAP IT FROM A PAGE DIGEST, VALIDATE
//      THE NEW MAP AGAINST THIS PAGE (RETRYING ONCE WITH FEEDBACK), PERSIST IT, AND RE-APPLY.
//
// COST CONTROLS: ONE (OR AT MOST TWO) AI CALLS PER NEW/BROKEN HOST — NEVER PER CHAPTER; SINGLE-FLIGHT SO
// A BURST OF PREFETCHES TRIGGERS ONE RE-LEARN; A COOLDOWN SO AN UNPARSEABLE PAGE CAN'T RE-BILL THE MODEL.

// IMPORTED TYPES
import type { ParsedChapter } from '$lib/types';
import type { SelectorMap } from './site-parser';
// IMPORTED DEP-TYPES
import type { HTMLElement } from 'node-html-parser';
// IMPORTED DEP-MODULES
import { eq, sql } from 'drizzle-orm';
import { parse } from 'node-html-parser';
// IMPORTED MODULES
import { db } from './db';
import { siteAdapters } from './db/schema';
import { computeUsage, deepseek, MODEL, hasApiKey, queued, thinkingParam, withRetry } from './deepseek';
import { FetchError } from './fetch-error';
import {
	applyAdapter,
	buildImageDigest,
	buildSkeleton,
	coerceCover,
	coerceMap,
	COVER_SYSTEM,
	extractProse,
	fallbackNav,
	findBestContentHtml,
	MAP_SYSTEM,
	MIN_BODY_CHARS,
	sanitizeMap,
} from './site-parser';
import { recordMapUsage } from './site-stats';

// -- CONSTANTS -- //

// DON'T RE-LEARN THE SAME HOST MORE THAN ONCE PER THIS WINDOW.
const HEAL_COOLDOWN_MS = 10 * 60 * 1000;

// -- STATES -- //

// HOST → SelectorMap. READ-THROUGH CACHE OVER THE DB; BUSTED ON A SUCCESSFUL HEAL.
const cache = new Map<string, SelectorMap>();

// HOST → ZYTE httpResponseBody COST OVERRIDE (site_adapters.fetch_cost_http), USD PER SUCCESSFUL REQUEST. IN-MEMORY
// MIRROR OF THE PERSISTED PER-HOST COST SO hostFetchCost IS FREE AFTER THE FIRST LOOKUP. null MEANS "NO OVERRIDE"
// → THE CALLER FALLS BACK TO THE GLOBAL ENV ESTIMATE (ZYTE_COST_PER_REQUEST).
const fetchCost = new Map<string, number | null>();

// HOSTS WHOSE fetch_cost_http WE'VE ALREADY RESOLVED FROM THE DB THIS PROCESS (OVERRIDE *OR* NONE), SO A HOST WITH
// NO OVERRIDE ISN'T RE-QUERIED ON EVERY FETCH.
const costChecked = new Set<string>();

// HOST → IN-FLIGHT HEAL. SINGLE-FLIGHT: CONCURRENT FETCHES OF A BROKEN HOST SHARE ONE AI CALL.
const inflight = new Map<string, Promise<SelectorMap>>();

// -- FUNCTIONS -- //

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		throw new FetchError('invalid_url', 'That link doesn’t look right. Paste the full address of a chapter page.');
	}
}

// THE PER-HOST ZYTE httpResponseBody COST OVERRIDE (USD), OR null TO FALL BACK TO THE GLOBAL ENV ESTIMATE. ZYTE
// BILLS BY SITE-DIFFICULTY TIER AND DOESN'T REPORT THE TIER PER REQUEST, SO A HOST'S REAL RATE IS LEARNED FROM THE
// ZYTE INVOICE AND STORED VIA setHostFetchCost — MAKING THE COST METER + FETCH CHARGE PER-HOST ACCURATE INSTEAD OF
// ONE GLOBAL GUESS. IN-MEMORY FIRST (FREE), ELSE ONE DB READ PER HOST PER PROCESS (CACHED IN costChecked). NEVER
// THROWS — A BAD URL / DB HICCUP RETURNS null SO BILLING FALLS BACK TO THE ENV ESTIMATE.
export async function hostFetchCost(url: string): Promise<number | null> {
	let host: string;
	try {
		host = hostOf(url);
	} catch {
		return null;
	}
	const cached = fetchCost.get(host);
	if (cached != null) return cached;
	if (costChecked.has(host)) return null;
	try {
		const [row] = await db
			.select({ http: siteAdapters.fetchCostHttp })
			.from(siteAdapters)
			.where(eq(siteAdapters.host, host))
			.limit(1);
		costChecked.add(host);
		if (row && row.http != null) {
			fetchCost.set(host, row.http);
			return row.http;
		}
	} catch (e) {
		console.warn(`[fetch-cost] override lookup failed for ${host}:`, e);
	}
	return null;
}

// ASK DEEPSEEK FOR THE SELECTORS (TINY OUTPUT) FROM A PAGE DIGEST (BOUNDED INPUT). thinking IS DISABLED
// (deepseek-v4 STALLS/RETURNS EMPTY OTHERWISE) AND temperature 0 KEEPS THE MAP STABLE. `hint` CARRIES
// CORRECTIVE FEEDBACK ON A RETRY.
async function learnSelectors(root: HTMLElement, url: string, hint?: string): Promise<SelectorMap> {
	if (!hasApiKey()) {
		throw new FetchError(
			'no_api_key',
			'We can’t read new websites right now. Please try a chapter from a site that already works.',
			hostOf(url),
		);
	}
	const digest = buildSkeleton(root);
	const user = `URL: ${url}\n\n${digest}${hint ? `\n\nNOTE: ${hint}` : ''}`;
	let res;
	try {
		res = await queued(() =>
			withRetry(() =>
				deepseek.chat.completions.create({
					model: MODEL,
					temperature: 0,
					max_tokens: 1024,
					response_format: { type: 'json_object' },
					messages: [
						{ role: 'system', content: MAP_SYSTEM },
						{ role: 'user', content: user },
					],
					...thinkingParam(),
				}),
			),
		);
	} catch {
		throw new FetchError(
			'unsupported_site',
			'We’re having trouble reading this website right now. Please try again shortly.',
			hostOf(url),
		);
	}
	// RECORD THE AI SPEND FOR THIS MAPPING CALL (BEST-EFFORT) — CAPTURED EVEN IF THE PARSE LATER FAILS.
	void recordMapUsage(hostOf(url), computeUsage(res.usage));
	return coerceMap(res.choices[0]?.message?.content ?? '{}');
}

// AI FALLBACK FOR THE BOOK COVER — USED ONLY WHEN THE DETERMINISTIC extractCover (og:image / scored
// <img>) FOUND NOTHING ON THE BOOK INDEX PAGE. PICKS THE COVER URL FROM AN IMAGE-CANDIDATE DIGEST.
export async function learnCover(html: string, url: string): Promise<string | null> {
	if (!hasApiKey()) return null;
	const digest = buildImageDigest(html, url);
	if (!digest.trim()) return null;
	let res;
	try {
		res = await queued(() =>
			withRetry(() =>
				deepseek.chat.completions.create({
					model: MODEL,
					temperature: 0,
					max_tokens: 200,
					response_format: { type: 'json_object' },
					messages: [
						{ role: 'system', content: COVER_SYSTEM },
						{ role: 'user', content: `BOOK PAGE: ${url}\n\nIMAGES:\n${digest}` },
					],
					...thinkingParam(),
				}),
			),
		);
	} catch {
		return null;
	}
	void recordMapUsage(hostOf(url), computeUsage(res.usage));
	return coerceCover(res.choices[0]?.message?.content ?? '{}');
}

// READ-THROUGH ADAPTER LOOKUP: MEMORY CACHE → DB ROW. RETURNS null FOR AN UNKNOWN HOST (→ AI-LEARN).
async function getAdapter(host: string): Promise<SelectorMap | null> {
	const cached = cache.get(host);
	if (cached) return cached;
	const [row] = await db.select().from(siteAdapters).where(eq(siteAdapters.host, host)).limit(1);
	if (row) {
		// A CORRUPTED / TRUNCATED mapping ROW MUST NOT 500 THE FETCH — TREAT AN UNPARSEABLE MAP AS AN UNKNOWN
		// HOST (RETURN null) SO THE CALLER RE-LEARNS IT INSTEAD OF THROWING A RAW SyntaxError.
		let raw: SelectorMap;
		try {
			raw = JSON.parse(row.mapping) as SelectorMap;
		} catch {
			return null;
		}
		// SANITIZE ON READ SO MAPS PERSISTED BEFORE SELECTOR VALIDATION (WITH OVERFIT [href] SELECTORS) STOP
		// MIS-RESOLVING NAV — THEY FALL BACK TO THE RELIABLE text LABELS WITHOUT NEEDING A RE-LEARN.
		const m = sanitizeMap(raw);
		cache.set(host, m);
		return m;
	}
	return null;
}

async function persistAdapter(host: string, m: SelectorMap, sampleUrl: string): Promise<void> {
	const now = Date.now();
	await db
		.insert(siteAdapters)
		.values({
			host,
			mapping: JSON.stringify(m),
			model: MODEL,
			sampleUrl,
			lastHealAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: siteAdapters.host,
			set: {
				mapping: JSON.stringify(m),
				model: MODEL,
				sampleUrl,
				lastHealAt: now,
				updatedAt: now,
				// BUMP version SO A REDESIGN'S NEW MAP IS DISTINGUISHABLE FROM THE OLD ONE.
				version: sql`${siteAdapters.version} + 1`,
			},
		});
	cache.set(host, m);
}

// (RE)LEARN A HOST'S SELECTORS, VALIDATE AGAINST THIS PAGE (UP TO TWO ATTEMPTS WITH FEEDBACK), AND
// PERSIST. SINGLE-FLIGHT PER HOST, AND COOLDOWN-GUARDED SO A REPEATEDLY-UNPARSEABLE PAGE CAN'T RE-BILL.
function heal(host: string, url: string, html: string, root: HTMLElement): Promise<SelectorMap> {
	const existing = inflight.get(host);
	if (existing) return existing;
	const p = (async () => {
		const [row] = await db.select().from(siteAdapters).where(eq(siteAdapters.host, host)).limit(1);
		// RECENTLY HEALED AND STILL FAILING → DON'T SPEND ANOTHER CALL; REUSE WHAT'S STORED (THE CALLER
		// WILL RE-APPLY AND, IF IT STILL CAN'T PARSE, REPORT A CLEAN unsupported_site).
		if (row?.lastHealAt && Date.now() - row.lastHealAt < HEAL_COOLDOWN_MS) {
			// REUSE THE STORED MAP WITHOUT RE-BILLING — UNLESS IT'S CORRUPT, IN WHICH CASE IGNORE THE COOLDOWN
			// AND FALL THROUGH TO RE-LEARN BELOW (NEVER LET A RAW SyntaxError ESCAPE THE SHARED inflight PROMISE).
			try {
				return JSON.parse(row.mapping) as SelectorMap;
			} catch {
				// CORRUPT ROW — RE-LEARN.
			}
		}
		let hint: string | undefined;
		for (let attempt = 0; attempt < 2; attempt++) {
			let m: SelectorMap;
			try {
				m = await learnSelectors(root, url, hint);
			} catch (e) {
				// A FRIENDLY FetchError (no_api_key / API hiccup) PROPAGATES AS-IS. A RAW coerceMap ERROR
				// ("Model omitted title/body." ETC.) MUST NOT LEAK — RETRY WITH A HINT, THEN FALL THROUGH
				// TO THE FRIENDLY unsupported_site BELOW IF THE SECOND ATTEMPT ALSO FAILS.
				if (e instanceof FetchError) throw e;
				hint = 'Return valid JSON with concrete selectors chosen from the candidate lists.';
				continue;
			}
			// VALIDATE BEFORE PERSISTING — NEVER SAVE A MAP THAT CAN'T EXTRACT THIS PAGE.
			if (applyAdapter(root, html, m, url)) {
				await persistAdapter(host, m, url);
				return m;
			}
			hint =
				'Your previous selectors did not extract the chapter. The body must be the CONTENT CANDIDATE whose preview is the story prose (not a menu, comments, or the whole page), and the title must be a real chapter heading.';
		}
		throw new FetchError(
			'unsupported_site',
			'We couldn’t read chapters from this website. It may show its text in a way we can’t read.',
			host,
		);
	})().finally(() => inflight.delete(host));
	inflight.set(host, p);
	return p;
}

// PUBLIC ENTRY: HTML + URL → ParsedChapter. APPLIES THE CACHED MAP, SELF-HEALS ON A MISS, AND THROWS A
// TYPED FetchError THE API CAN TURN INTO A CLEAR MESSAGE.
export async function parseChapter(html: string, url: string): Promise<ParsedChapter> {
	const host = hostOf(url);
	const root = parse(html);

	const known = await getAdapter(host);
	if (known) {
		const parsed = applyAdapter(root, html, known, url);
		if (parsed) return parsed;
		console.warn(`[parse] cached map failed for ${host} at ${url}`);
	}

	// UNKNOWN HOST OR STALE MAP → (RE)LEARN.
	try {
		const learned = await heal(host, url, html, root);
		const parsed = applyAdapter(root, html, learned, url);
		if (parsed) return parsed;
		console.warn(`[parse] healed map also failed for ${host} at ${url}`);
	} catch (e) {
		// HEAL EXHAUSTED ITS ATTEMPTS — THE MODEL CAN'T MAP THIS PAGE. BEFORE GIVING UP, TRY A LAST-RESORT
		// LOOSE-BODY EXTRACTION: STRIP ALL CHROME FROM THE FULL PAGE AND USE <title> AS THE CHAPTER TITLE.
		// THIS LETS A LEGITIMATE CHAPTER WHOSE PAGE TEMPLATE HAPPENS TO CONFUSE THE AI STILL BE IMPORTED,
		// WITHOUT THE DELAY + COST OF ANOTHER AI CALL. FALL THROUGH TO THE FALLBACK BELOW.
		if (!(e instanceof FetchError && e.kind === 'unsupported_site')) throw e;
	}

	// FALLBACK: FIND THE BEST CONTENT BLOCK BY TEXT DENSITY (SAME HEURISTIC buildSkeleton USES TO
	// PRESENT CANDIDATES TO THE AI). THIS ZERO-COST GUESS TARGETS THE PAGE'S MAIN STORY DIV WITHOUT
	// INCLUDING THE FULL-PAGE CHROME (MENUS, SETTINGS PANELS, COMMENTS) THAT extractProse CAN'T FULLY
	// STRIP. ALSO RESOLVE NAV LINKS VIA fallbackNav (link rel + id/class heuristics) SO THE READER'S
	// PREV/NEXT BUTTONS STILL WORK — THE SAME HEURISTIC applyAdapter USES WHEN NavRule sel RESOLVES NOTHING.
	const candidateHtml = findBestContentHtml(root);
	if (candidateHtml) {
		const fallbackTitle = (root.querySelector('title')?.text?.trim() ?? 'Untitled').slice(0, 200);
		const fallbackBody = extractProse(candidateHtml);
		if (fallbackBody.length >= MIN_BODY_CHARS) {
			console.warn(`[parse] content-candidate fallback succeeded (${fallbackBody.length} chars)`);
			let prevUrl = fallbackNav(root, url, 'prev');
			let nextUrl = fallbackNav(root, url, 'next');
			const indexUrl = fallbackNav(root, url, 'index');
			if (prevUrl === url) prevUrl = null;
			if (nextUrl === url) nextUrl = null;
			return {
				titleSource: fallbackTitle,
				contentSource: fallbackBody,
				siteChapterId: null,
				chapterUrl: url,
				prevUrl,
				nextUrl,
				indexUrl,
				bookId: null,
				bookTitle: null,
				author: null,
			};
		}
	}
	throw new FetchError(
		'parse_failed',
		'We couldn’t find the chapter text on that page. Make sure the link goes straight to a chapter.',
		host,
	);
}
