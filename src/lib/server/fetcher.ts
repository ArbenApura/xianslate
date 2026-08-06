// IMPORTED TYPES
import type { ParsedChapter } from '$lib/types';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import PQueue from 'p-queue';
// IMPORTED MODULES
import { getLanguage } from '$lib/languages';
import { decodeTextBytes } from './charset';
import { FetchError } from './fetch-error';
import { extractBookTitle, extractCover } from './site-parser';
import { learnCover } from './site-adapter';
import { hostFetchCost, parseChapter } from './site-adapter';
import { recordFetchError, recordFetchOk } from './site-stats';

// -- TYPES -- //

// A TRANSPORT RESULT: THE DECODED HTML PLUS WHAT THE FETCH COST. THE FREE node-fetch / curl PATHS REPORT
// costUsd 0; ONLY ZYTE REQUESTS CARRY A COST.
interface FetchResult {
	html: string;
	provider: 'zyte' | 'direct' | 'curl';
	costUsd: number;
}

// ONE BILLED FETCH EVENT REPORTED TO THE CALLER VIA THE onBill CALLBACK. THE CALLER OWNS RECORDING IT — IT
// KNOWS THE userId AND (AFTER INGEST) THE chapterId, WHICH THE TRANSPORT DOESN'T. provider IS THE ZYTE TIER
// ('zyte' = HTTP). FREE PATHS (costUsd 0) DON'T EMIT.
export interface FetchBilling {
	host: string;
	provider: string;
	costUsd: number;
}

// -- CONSTANTS -- //

const execFileAsync = promisify(execFile);

// RESOLVE curl ROBUSTLY: SOME ENVIRONMENTS RUN WITH A STRIPPED PATH THAT OMITS System32, SO A BARE
// 'curl' SPAWN FAILS WITH ENOENT EVEN THOUGH WINDOWS SHIPS curl.exe. POINT AT THE ABSOLUTE PATH WHEN
// IT EXISTS; FALL BACK TO 'curl' (PATH LOOKUP) ON LINUX/MAC.
const CURL_BIN: string = (() => {
	if (process.platform === 'win32') {
		const sys = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
		const p = `${sys}\\System32\\curl.exe`;
		if (existsSync(p)) return p;
	}
	return 'curl';
})();

const MAX_REDIRECTS = 5;

const FETCH_TIMEOUT_MS = 30_000;

// ZYTE API — MANAGED FETCH/UNBLOCKING. WHEN ZYTE_API_KEY IS SET IT'S THE PRIMARY TRANSPORT FOR EVERY FETCH
// (httpResponseBody TIER), AND THE node-fetch→curl PATH BELOW BECOMES THE FREE FALLBACK FOR A ZYTE OUTAGE OR
// AN UNCONFIGURED (DEV) ENV. COSTS ARE PASS-THROUGH AND ENV-TUNABLE SO A PRICE CHANGE NEEDS NO CODE EDIT —
// THEY ARE WHAT recordFetchUsage DEDUCTS FROM THE USER'S ROLLING BUDGET PER REQUEST.
const ZYTE_API_KEY = env.ZYTE_API_KEY ?? '';

const ZYTE_ENDPOINT = env.ZYTE_ENDPOINT ?? 'https://api.zyte.com/v1/extract';

// USD PER *SUCCESSFUL* ZYTE httpResponseBody REQUEST. ZYTE BILLS BY SITE-DIFFICULTY TIER (1–5) AND THE API DOES
// NOT RETURN THE TIER OR COST PER REQUEST, SO THIS IS A FIXED PASS-THROUGH *ESTIMATE*, NOT THE EXACT CHARGE. PAYG
// PER-1k RANGES (2026): HTTP $0.13 (T1) → $1.27 (T5). A SITE ONLY REACHES ZYTE WHEN THE FREE direct→curl PATH
// FAILED — THOSE ARE THE HARDER SITES, WHICH SKEW TO TIER 3+ — SO THE DEFAULT BELOW IS TIER-3, NOT THE TIER-1
// FLOOR, TO AVOID SILENTLY UNDER-COUNTING SPEND. MEASURE YOUR REAL RATE FROM THE ZYTE INVOICE (total $ ÷
// SUCCESSFUL httpResponseBody REQUESTS) AND SET THE ENV.
const ZYTE_COST_HTTP = Number(env.ZYTE_COST_PER_REQUEST ?? '0.00044');

// ZYTE ENFORCES A PER-KEY *RATE* LIMIT (DEFAULT 2 req/s = 120/min), RETURNING 429 ON EXCESS — IT IS NOT
// CONCURRENCY-BASED. BOTH TIERS SHARE IT, SO WE PACE EVERY ZYTE CALL THROUGH ONE QUEUE CAPPED AT ZYTE_RPS
// STARTS PER SECOND INSTEAD OF FIRING UNBOUNDED CONCURRENT REQUESTS. RAISE ZYTE_RPS ONLY AFTER ZYTE LIFTS YOUR
// KEY'S LIMIT (SUPPORT TICKET). SINGLE-PROCESS ONLY: A MULTI-INSTANCE DEPLOY WOULD NEED A SHARED LIMITER, SINCE
// EACH PROCESS GETS ITS OWN BUDGET HERE — DIVIDE ZYTE_RPS BY THE INSTANCE COUNT THEN.
const ZYTE_RPS = Math.max(1, Number(env.ZYTE_RPS ?? '2'));

// HOW MANY TIMES TO RETRY A 429/503 (RATE LIMIT / TRANSIENT) WITH BACKOFF BEFORE GIVING UP TO THE FREE PATH.
const ZYTE_MAX_RETRIES = Math.max(0, Number(env.ZYTE_MAX_RETRIES ?? '4'));

// PACES EVERY ZYTE CALL TO <= ZYTE_RPS STARTS PER SECOND (SHARED BY THE HTTP + RENDER TIERS, PER KEY).
const zyteQueue = new PQueue({ interval: 1000, intervalCap: ZYTE_RPS });

// HARD CEILING ON A FETCHED RESPONSE BODY — A MALICIOUS / MISCONFIGURED HOST COULD OTHERWISE STREAM AN
// UNBOUNDED BODY AND OOM THE (SINGLE-INSTANCE) SERVER. MIRRORS THE curl FALLBACK'S 32MB maxBuffer.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// BUILD THE BROWSER HEADER SET FOR A FETCH IN A GIVEN SOURCE LANGUAGE — ONLY Accept-Language VARIES.
function browserHeaders(acceptLanguage: string): Record<string, string> {
	return {
		'User-Agent': BROWSER_UA,
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': acceptLanguage,
		'Upgrade-Insecure-Requests': '1',
		'sec-ch-ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"Windows"',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
	};
}

// -- FUNCTIONS -- //

// THE FETCH TARGET IS USER-SUPPLIED, SO REFUSE LOOPBACK / PRIVATE / LINK-LOCAL DESTINATIONS BEFORE WE
// (OR THE curl FALLBACK) TOUCH THEM — OTHERWISE THE SERVER COULD BE STEERED AT INTERNAL SERVICES OR
// CLOUD METADATA ENDPOINTS. WE RESOLVE THE HOST AND CHECK EVERY ADDRESS (GUARDS DNS-REBINDING TOO).
function isPrivateV4(ip: string): boolean {
	const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
	if (!m) return false;
	const o = m.slice(1).map(Number);
	if (o.some((n) => n > 255)) return false;
	const [a, b] = o;
	return (
		a === 0 || // "this" network
		a === 10 || // private
		a === 127 || // loopback
		(a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
		(a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
		(a === 172 && b >= 16 && b <= 31) || // private
		(a === 192 && b === 168) // private
	);
}

function isPrivateIp(ip: string): boolean {
	const v = ip.toLowerCase();
	if (v === '::1' || v === '::') return true; // loopback / unspecified
	if (v.startsWith('::ffff:')) return isPrivateV4(v.slice(7)); // IPv4-mapped IPv6
	if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
	if (v.startsWith('fe80')) return true; // link-local
	return isPrivateV4(v);
}

// RESOLVE THE HOST, REJECT IF ANY ADDRESS IS PRIVATE/INTERNAL, AND RETURN THE VALIDATED ADDRESS SO THE
// CALLER CAN *PIN* IT FOR THE ACTUAL FETCH (CLOSES THE DNS-REBINDING TOCTOU: WE FETCH THE EXACT IP WE
// CHECKED, NOT A SECOND RESOLUTION THE ATTACKER COULD FLIP TO A PRIVATE HOST).
async function assertPublicUrl(raw: string): Promise<{ url: URL; address: string; family: number }> {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new FetchError('invalid_url', 'That link doesn’t look right. Paste the full address of a chapter page.');
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') {
		throw new FetchError('invalid_url', 'That link doesn’t look right. It should start with http:// or https://.');
	}
	const host = u.hostname.toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
		throw new FetchError(
			'blocked_private',
			'That link points somewhere we can’t open. Paste a public chapter page link.',
			host,
		);
	}
	let addrs: { address: string; family: number }[];
	try {
		addrs = await lookup(host, { all: true });
	} catch {
		throw new FetchError(
			'unresolvable',
			`We couldn’t find the site “${host}”. Check the link and try again.`,
			host,
		);
	}
	if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
		throw new FetchError(
			'blocked_private',
			'That link points somewhere we can’t open. Paste a public chapter page link.',
			host,
		);
	}
	return { url: u, address: addrs[0].address, family: addrs[0].family };
}

// THESE NOVEL SITES OFTEN SERVE LEGACY CHINESE ENCODINGS (Big5 / GBK / GB18030), NOT UTF-8. DECODE THE
// RAW BYTES BY THE DECLARED CHARSET (HTTP Content-Type → <meta charset> → <meta http-equiv>) SO THE
// TEXT ISN'T MOJIBAKE. Node's TextDecoder SHIPS full-ICU, SO gbk/big5/gb18030 LABELS WORK NATIVELY.
function detectCharset(bytes: Uint8Array, contentType: string | null): string {
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
	const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
	if (fromHeader) return fromHeader.toLowerCase();
	// SNIFF THE FIRST 2KB (ASCII-COMPATIBLE PREFIX) FOR A <meta> CHARSET DECLARATION
	const head = Buffer.from(bytes.slice(0, 2048)).toString('latin1');
	const meta =
		head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
		head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1];
	return (meta ?? 'utf-8').toLowerCase();
}

function decodeHtmlBytes(bytes: Uint8Array, contentType: string | null, hints: string[] = []): string {
	const declared = detectCharset(bytes, contentType);
	// A DECLARED/SNIFFED CHARSET WINS; OTHERWISE TRY THE SOURCE LANGUAGE'S LEGACY CANDIDATES BY SCORE
	// (decodeTextBytes HANDLES BOM/UTF-8/LEGACY DETECTION) SO JP/KR PAGES WITHOUT A DECLARATION DECODE TOO.
	if (declared && declared !== 'utf-8') {
		try {
			return new TextDecoder(declared).decode(bytes);
		} catch {
			// FALL THROUGH TO HINT-BASED DETECTION
		}
	}
	return decodeTextBytes(bytes, true, hints);
}

// PERFORM THE ACTUAL DIRECT-PATH REQUEST WITH THE *EXACT IP assertPublicUrl VALIDATED* — THE CORE OF THE
// SSRF PIN. node's fetch/undici RE-RESOLVES THE HOSTNAME ITSELF (A SECOND, INDEPENDENT DNS LOOKUP THE
// ATTACKER COULD FLIP TO A PRIVATE/METADATA ADDRESS BETWEEN OUR CHECK AND THE CONNECT — THE DNS-REBINDING
// TOCTOU). http(s).request's `lookup` OPTION OVERRIDES RESOLUTION, SO THE CONNECTION IS PINNED TO THE
// ADDRESS WE ALREADY CHECKED (THE SAME PIN THE curl FALLBACK APPLIES VIA --resolve). TLS STILL VALIDATES
// THE REAL HOSTNAME (SNI + cert), AND REDIRECTS STAY MANUAL — EVERY HOP RE-RUNS assertPublicUrl.
//
// THE BODY IS STREAMED WITH A HARD BYTE CEILING (MAX_BODY_BYTES) SO WE NEVER BUFFER AN UNBOUNDED PAGE;
// AN OVERFLOW REJECTS WITH A TYPED too_large (THE CALLER DOES NOT RETRY IT VIA curl).
async function pinnedRequest(
	url: URL,
	pin: { address: string; family: number },
	headers: Record<string, string>,
	signal?: AbortSignal,
): Promise<{ status: number; location: string | null; contentType: string | null; body: Uint8Array }> {
	const mod = url.protocol === 'https:' ? httpsRequest : httpRequest;
	return new Promise((resolve, reject) => {
		const tooLarge = () =>
			new FetchError('too_large', 'That page is too large for us to open. Try a direct chapter link.', url.hostname);
		const req = mod(
			{
				hostname: url.hostname,
				port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
				path: `${url.pathname}${url.search}`,
				method: 'GET',
				headers,
				signal,
				// NODE CALLS THE CUSTOM lookup WITH { all: true } BY DEFAULT — RETURN THE ARRAY FORM THEN,
				// THE SINGLE-ADDRESS FORM OTHERWISE (node:net VALIDATES THE RESULT BY opts.all).
				lookup: ((_host: string, opts: object, cb: Parameters<LookupFunction>[2]) => {
					if ((opts as { all?: boolean }).all) {
						cb(null, [{ address: pin.address, family: pin.family }]);
					} else {
						cb(null, pin.address, pin.family);
					}
				}) as LookupFunction,
			},
			(res) => {
				const chunks: Uint8Array[] = [];
				let total = 0;
				res.on('data', (c: Buffer) => {
					total += c.length;
					if (total > MAX_BODY_BYTES) {
						req.destroy(tooLarge());
						return;
					}
					chunks.push(new Uint8Array(c));
				});
				res.on('end', () => {
					const body = new Uint8Array(total);
					let offset = 0;
					for (const c of chunks) {
						body.set(c, offset);
						offset += c.length;
					}
					resolve({
						status: res.statusCode ?? 0,
						location: (res.headers.location ?? null) as string | null,
						contentType: (res.headers['content-type'] ?? null) as string | null,
						body,
					});
				});
				res.on('error', (e) => reject(e));
			},
		);
		req.on('error', (e) => reject(e));
		req.end();
	});
}

// CURL FALLBACK — PROVEN TO PASS THE SITE'S BOT CHECK ON THIS HOST. `pin` IS THE PRE-VALIDATED IP.
async function curlFetch(
	u: URL,
	pin: { address: string; family: number },
	acceptLanguage: string,
	hints: string[],
): Promise<FetchResult> {
	const port = u.port || (u.protocol === 'https:' ? '443' : '80');
	let stdout: string | Buffer;
	try {
		({ stdout } = await execFileAsync(
			CURL_BIN,
			[
				'-s',
				'--compressed',
				// HARDENING: NO REDIRECT FOLLOWING (THE CALLER VALIDATED THIS EXACT URL), ONLY http/https,
				// PIN DNS TO THE ALREADY-VALIDATED IP (BLOCKS DNS-REBINDING), AND BOUND THE REQUEST TIME.
				'--max-redirs',
				'0',
				'--proto',
				'=http,https',
				'--resolve',
				`${u.hostname}:${port}:${pin.address}`,
				'--connect-timeout',
				'10',
				'--max-time',
				'30',
				'-A',
				BROWSER_UA,
				'-H',
				`Accept-Language: ${acceptLanguage}`,
				u.href,
			],
			// CAPTURE RAW BYTES (NOT utf8) SO CHARSET DETECTION CAN RUN ON THE ORIGINAL ENCODING.
			{ maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' },
		));
	} catch {
		// curl SPAWN FAILURE / CONNECT TIMEOUT / TOO-LARGE BODY — A TRANSPORT FAILURE, NOT A PARSE ISSUE.
		throw new FetchError(
			'network',
			`We couldn’t reach “${u.hostname}”. It may be down — please try again in a moment.`,
			u.hostname,
		);
	}
	const buf = stdout as unknown as Buffer;
	// AN EMPTY BODY HERE MEANS THE BOT WALL WON (curl IS ALREADY OUR ANTI-BLOCK FALLBACK).
	if (!buf || buf.length < 100) {
		throw new FetchError(
			'blocked_bot',
			`“${u.hostname}” won’t let us open its pages, so its chapters can’t be loaded.`,
			u.hostname,
		);
	}
	return { html: decodeHtmlBytes(buf, null, hints), provider: 'curl', costUsd: 0 };
}

// HOST OF A URL FOR THE BILLING LEDGER (www-STRIPPED, LOWERCASED). NEVER THROWS.
function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return 'unknown';
	}
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ONE PACED + RETRIED POST TO ZYTE. zyteQueue CAPS THE START RATE TO ZYTE_RPS; A 429 (RATE LIMIT) OR 503 IS
// RETRIED WITH BACKOFF — HONORING Retry-After WHEN PRESENT, ELSE EXPONENTIAL (0.5s→8s) — RATHER THAN FAILING
// OVER, BECAUSE A RATE LIMIT IS TRANSIENT, NOT AN OUTAGE. RETURNS THE FINAL Response (THE CALLER MAPS A
// STILL-NON-OK STATUS TO A TYPED FetchError); A network/timeout THROW PROPAGATES TO THE CALLER'S FALLBACK.
async function zyteRequest(body: Record<string, unknown>): Promise<Response> {
	const headers = {
		// ZYTE USES HTTP BASIC AUTH: THE API KEY IS THE USERNAME, THE PASSWORD IS EMPTY.
		Authorization: `Basic ${Buffer.from(`${ZYTE_API_KEY}:`).toString('base64')}`,
		'Content-Type': 'application/json',
	};
	const payload = JSON.stringify(body);
	for (let attempt = 0; ; attempt++) {
		// queue.add PACES THE START TO RESPECT ZYTE_RPS; A FRESH TIMEOUT BOUNDS EACH ATTEMPT.
		const res = (await zyteQueue.add(() =>
			fetch(ZYTE_ENDPOINT, {
				method: 'POST',
				headers,
				body: payload,
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			}),
		)) as Response | undefined;
		if (!res)
			throw new FetchError(
				'network',
				'We couldn’t reach the page service right now. Please try again in a moment.',
			);
		if ((res.status !== 429 && res.status !== 503) || attempt >= ZYTE_MAX_RETRIES) return res;
		// RATE-LIMITED / TRANSIENT → WAIT THEN RETRY. PREFER THE SERVER'S Retry-After (SECONDS), CAPPED AT 30s.
		const ra = Number(res.headers.get('retry-after'));
		const waitMs =
			Number.isFinite(ra) && ra > 0 ? Math.min(30_000, ra * 1000) : Math.min(8_000, 500 * 2 ** attempt);
		await sleep(waitMs);
	}
}

// FETCH VIA THE ZYTE API (httpResponseBody TIER). RETURNS THE RAW BODY (base64) + HEADERS, SO OUR EXISTING
// CHARSET PIPELINE STILL DECODES LEGACY GBK / Big5 / Shift_JIS CORRECTLY. A TARGET 404 SURFACES AS not_found; A
// BAD KEY / QUOTA / ZYTE 5xx BECOMES network SO THE CALLER CAN DEGRADE TO THE FREE DIRECT PATH. NO SSRF DNS
// PIN IS NEEDED — ZYTE EGRESSES FROM ITS OWN NETWORK, NOT OURS — BUT WE STILL REJECT NON-http(s) INPUT.
async function zyteFetch(url: string, hints: string[]): Promise<FetchResult> {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		throw new FetchError('invalid_url', 'That link doesn’t look right. Paste the full address of a chapter page.');
	}
	if (target.protocol !== 'http:' && target.protocol !== 'https:') {
		throw new FetchError('invalid_url', 'That link doesn’t look right. It should start with http:// or https://.');
	}
	let res: Response;
	try {
		res = await zyteRequest({ url, httpResponseBody: true, httpResponseHeaders: true });
	} catch {
		throw new FetchError('network', 'We couldn’t reach the page service right now. Please try again in a moment.');
	}
	if (!res.ok) {
		if (res.status === 404)
			throw new FetchError(
				'not_found',
				'That chapter page couldn’t be found. The link may be wrong or the page was removed.',
			);
		// 401/403 (KEY/QUOTA) OR 5xx ARE ZYTE-SIDE — TREAT AS A TRANSPORT FAILURE SO THE CALLER CAN FALL BACK.
		throw new FetchError('network', 'The page service is busy right now. Please try again in a moment.');
	}
	const data = (await res.json()) as {
		httpResponseBody?: string;
		httpResponseHeaders?: { name: string; value: string }[];
	};
	if (!data.httpResponseBody)
		throw new FetchError(
			'blocked_bot',
			`“${target.hostname}” won’t let us open its pages, so its chapters can’t be loaded.`,
		);
	const bytes = new Uint8Array(Buffer.from(data.httpResponseBody, 'base64'));
	const contentType = data.httpResponseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? null;
	// PER-HOST COST OVERRIDE (THIS HOST'S OBSERVED ZYTE TIER, FROM INVOICE RECONCILIATION) WHEN SET, ELSE THE ENV ESTIMATE.
	return {
		html: decodeHtmlBytes(bytes, contentType, hints),
		provider: 'zyte',
		costUsd: (await hostFetchCost(url)) ?? ZYTE_COST_HTTP,
	};
}

// DIRECT TRANSPORT — node fetch, FALLING BACK TO SYSTEM curl WHEN THE NODE CLIENT IS BLOCKED (CLOUDFLARE 403).
// REDIRECTS ARE FOLLOWED *MANUALLY* SO EVERY HOP IS RE-VALIDATED BY THE SSRF GUARD — A PUBLIC URL THAT
// 30x-REDIRECTS TO 127.0.0.1 / 169.254.169.254 / AN INTERNAL HOST IS REJECTED INSTEAD OF FOLLOWED. THIS IS THE
// FREE PATH (costUsd 0): USED WHEN ZYTE ISN'T CONFIGURED, OR AS THE FALLBACK ON A ZYTE TRANSPORT FAILURE.
async function directFetchHtml(url: string, acceptLanguage: string, hints: string[]): Promise<FetchResult> {
	const headers = browserHeaders(acceptLanguage);
	let current = url;
	for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
		const pin = await assertPublicUrl(current);
		let res: { status: number; location: string | null; contentType: string | null; body: Uint8Array };
		try {
			res = await pinnedRequest(new URL(current), pin, headers, AbortSignal.timeout(FETCH_TIMEOUT_MS));
		} catch (e) {
			// A TYPED FetchError (too_large) IS FINAL — DON'T RE-FETCH THE SAME HUGE PAGE VIA curl. ANY
			// OTHER FAILURE (DNS/TLS/TIMEOUT/REFUSED) → TRY THE curl FALLBACK ON THIS VALIDATED, PINNED URL.
			if (e instanceof FetchError) throw e;
			return await curlFetch(pin.url, pin, acceptLanguage, hints);
		}
		if (res.status >= 300 && res.status < 400) {
			const loc = res.location;
			if (!loc)
				throw new FetchError('http_error', 'This page didn’t load correctly. Please try again in a moment.');
			current = new URL(loc, current).href; // LOOP RE-VALIDATES IT
			continue;
		}
		if (res.status >= 200 && res.status < 300)
			return {
				html: decodeHtmlBytes(res.body, res.contentType, hints),
				provider: 'direct',
				costUsd: 0,
			};
		// CLOUDFLARE / BOT-CHECK BLOCK → curl FALLBACK ON THE SAME VALIDATED URL; ANYTHING ELSE IS FATAL
		if (res.status === 403 || res.status === 503) return await curlFetch(pin.url, pin, acceptLanguage, hints);
		if (res.status === 404)
			throw new FetchError(
				'not_found',
				'That chapter page couldn’t be found. The link may be wrong or the page was removed.',
			);
		throw new FetchError('http_error', 'This site isn’t responding properly right now. Please try again later.');
	}
	throw new FetchError('http_error', 'This page kept redirecting and couldn’t be opened.');
}

// PRIMARY-TRANSPORT SELECTOR. WHEN ZYTE IS CONFIGURED IT FETCHES EVERY PAGE (httpResponseBody TIER) AND WE
// BILL THE USER PASS-THROUGH; A ZYTE *TRANSPORT* FAILURE (network) DEGRADES TO THE FREE node-fetch→curl PATH SO
// AN OUTAGE / MISSING KEY NEVER TAKES DOWN ALL FETCHES. A REAL TARGET OUTCOME (404 / blocked) PROPAGATES AS-IS.
async function fetchHtml(url: string, acceptLanguage: string, hints: string[]): Promise<FetchResult> {
	if (ZYTE_API_KEY) {
		try {
			return await zyteFetch(url, hints);
		} catch (e) {
			if (!(e instanceof FetchError) || e.kind !== 'network') throw e;
			// ZYTE WAS UNREACHABLE / ERRORED — FALL THROUGH TO THE FREE DIRECT PATH (NO CHARGE).
		}
	}
	return await directFetchHtml(url, acceptLanguage, hints);
}

// FETCH A CHAPTER PAGE FROM ANY SUPPORTED HOST. TRANSPORT LIVES HERE; THE SITE-SPECIFIC PARSING IS
// DELEGATED TO THE AI-LEARNED, SELF-HEALING ADAPTER. `sourceLang` TUNES Accept-Language AND THE LEGACY
// CHARSET CANDIDATES (zh→Big5/GBK, ja→Shift_JIS/EUC-JP, ko→EUC-KR). ZYTE'S httpResponseBody TIER IS THE
// PRIMARY TRANSPORT (FREE node-fetch→curl FALLBACK). `userId` ATTRIBUTES ANY AI SITE-MAPPING / COVER-
// LEARNING SPEND TRIGGERED BY THIS FETCH TO THE CALLING ACCOUNT (OTHERWISE IT WAS SITE-WIDE, UNCOUNTED
// COST). `onBill` (WHEN GIVEN) RECEIVES EACH BILLED ZYTE FETCH (PAY-PER-SUCCESS) SO THE CALLER CAN CHARGE
// THE USER AND ATTRIBUTE IT TO THE CHAPTER; OMIT IT FOR UNBILLED (e.g. TEST-HARNESS) CALLS. EVERY FAILURE
// SURFACES AS A TYPED FetchError SO THE API CAN REPORT WHY.
export async function fetchChapter(
	url: string,
	sourceLang?: string,
	userId?: string,
	onBill?: (e: FetchBilling) => void,
): Promise<ParsedChapter> {
	const lang = getLanguage(sourceLang);
	// REPORT A BILLED (ZYTE) TRANSPORT ON A RETURNED PAGE — ZYTE CHARGES FOR THE RESPONSE WHETHER OR NOT PARSING
	// LATER SUCCEEDS, SO EMIT AS SOON AS THE PAGE COMES BACK. FREE PATHS (costUsd 0) ARE SKIPPED; site_events
	// ALREADY LOGS EVERY FETCH FOR THE DASHBOARD.
	const bill = (r: FetchResult) => {
		if (onBill && r.costUsd > 0) onBill({ host: hostOf(url), provider: r.provider, costUsd: r.costUsd });
	};
	try {
		const res = await fetchHtml(url, lang.acceptLanguage, lang.charsetHints);
		bill(res);
		const chapter = await parseChapter(res.html, url, userId);
		// RECORD THE OUTCOME FOR THE SITE-RELIABILITY LEDGER (BEST-EFFORT, NEVER BLOCKS THE FETCH).
		void recordFetchOk(url);
		return chapter;
	} catch (e) {
		void recordFetchError(url, e);
		throw e;
	}
}

// FETCH A BOOK'S METADATA (COVER + CLEAN TITLE) FROM ITS INDEX/BOOK PAGE IN ONE REQUEST. BEST-EFFORT (NULLS
// ON ANY FAILURE). COVER: og:image / scored <img> DETERMINISTICALLY, THEN AN AI PICK AS A FALLBACK. TITLE:
// og:title — THE AUTHORITATIVE BOOK NAME WHEN THE CHAPTER PAGE'S HEADING MASHES BOOK + CHAPTER TOGETHER. THE
// INDEX/BOOK PAGE IS THE RIGHT SOURCE FOR BOTH, SO THEY SHARE THE (BILLED) FETCH — `onBill` IS CALLED LIKE
// fetchChapter (BOOK-LEVEL: NO chapterId). `userId` ATTRIBUTES AI COVER-LEARNING SPEND TO THE CALLING
// ACCOUNT. INPUT VALIDATION + SSRF GUARDING LIVE IN THE TRANSPORT.
export async function fetchBookMeta(
	indexUrl: string,
	sourceLang?: string,
	userId?: string,
	onBill?: (e: FetchBilling) => void,
): Promise<{ cover: string | null; title: string | null }> {
	try {
		const lang = getLanguage(sourceLang);
		const res = await fetchHtml(indexUrl, lang.acceptLanguage, lang.charsetHints);
		if (onBill && res.costUsd > 0) onBill({ host: hostOf(indexUrl), provider: res.provider, costUsd: res.costUsd });
		const cover = extractCover(res.html, indexUrl) ?? (await learnCover(res.html, indexUrl, userId));
		return { cover, title: extractBookTitle(res.html) };
	} catch {
		return { cover: null, title: null };
	}
}
