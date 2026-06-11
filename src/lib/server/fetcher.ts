// IMPORTED TYPES
import type { ParsedChapter } from '$lib/types';
// IMPORTED DEP-MODULES
import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
// IMPORTED MODULES
import { getLanguage } from '$lib/languages';
import { decodeTextBytes } from './charset';
import { FetchError } from './fetch-error';
import { renderHtml } from './headless';
import { extractCover } from './site-parser';
import { learnCover } from './site-adapter';
import { parseChapter } from './site-adapter';
import { recordFetchError, recordFetchOk } from './site-stats';

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

// CURL FALLBACK — PROVEN TO PASS THE SITE'S BOT CHECK ON THIS HOST. `pin` IS THE PRE-VALIDATED IP.
async function curlFetch(
	u: URL,
	pin: { address: string; family: number },
	acceptLanguage: string,
	hints: string[],
): Promise<string> {
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
	return decodeHtmlBytes(buf, null, hints);
}

// FETCH HTML, FALLING BACK TO SYSTEM curl WHEN THE NODE CLIENT IS BLOCKED (CLOUDFLARE 403).
// REDIRECTS ARE FOLLOWED *MANUALLY* SO EVERY HOP IS RE-VALIDATED BY THE SSRF GUARD — A PUBLIC URL THAT
// 30x-REDIRECTS TO 127.0.0.1 / 169.254.169.254 / AN INTERNAL HOST IS REJECTED INSTEAD OF FOLLOWED.
async function fetchHtml(url: string, acceptLanguage: string, hints: string[]): Promise<string> {
	const headers = browserHeaders(acceptLanguage);
	let current = url;
	for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
		const pin = await assertPublicUrl(current);
		let res: Response;
		try {
			res = await fetch(current, {
				headers,
				redirect: 'manual', // WE RESOLVE REDIRECTS OURSELVES AND RE-VALIDATE EACH TARGET
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
		} catch {
			// NETWORK ERROR / TIMEOUT → TRY THE curl FALLBACK ON THIS VALIDATED, PINNED URL
			return await curlFetch(pin.url, pin, acceptLanguage, hints);
		}
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location');
			if (!loc)
				throw new FetchError('http_error', 'This page didn’t load correctly. Please try again in a moment.');
			current = new URL(loc, current).href; // LOOP RE-VALIDATES IT
			continue;
		}
		if (res.ok)
			return decodeHtmlBytes(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type'), hints);
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

// APPROX VISIBLE-TEXT LENGTH OF A PAGE (TAGS/SCRIPTS STRIPPED) — TINY VALUES MEAN A CLIENT-RENDERED SHELL.
function visibleTextLen(html: string): number {
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim().length;
}

// RENDER A JS-BUILT PAGE IN HEADLESS CHROMIUM AND RETURN ITS HTML — SSRF-GUARDED (WE VALIDATE THE HOST
// IS PUBLIC BEFORE NAVIGATING) AND BEST-EFFORT (null IF RENDERING IS UNAVAILABLE OR FAILS).
async function tryRender(url: string, acceptLanguage: string): Promise<string | null> {
	try {
		await assertPublicUrl(url);
		return await renderHtml(url, acceptLanguage);
	} catch {
		return null;
	}
}

// ONLY A PARSE-STAGE FAILURE (NO CHAPTER FOUND IN STATIC HTML) IS WORTH A RENDER RETRY — NOT A TRANSPORT
// OR CONFIG FAILURE (BLOCKED / NOT FOUND / NO API KEY): RENDERING THOSE WOULD FAIL THE SAME WAY.
function isRenderableFailure(e: unknown): boolean {
	return e instanceof FetchError && (e.kind === 'unsupported_site' || e.kind === 'parse_failed');
}

// FETCH A CHAPTER PAGE FROM ANY SUPPORTED HOST. TRANSPORT LIVES HERE; THE SITE-SPECIFIC PARSING IS
// DELEGATED TO THE AI-LEARNED, SELF-HEALING ADAPTER. `sourceLang` TUNES Accept-Language AND THE LEGACY
// CHARSET CANDIDATES (zh→Big5/GBK, ja→Shift_JIS/EUC-JP, ko→EUC-KR). FOR JS-RENDERED (SPA) PAGES WHERE THE
// STATIC HTML HAS NO CHAPTER, IT FALLS BACK TO A HEADLESS RENDER AND PARSES THAT INSTEAD. EVERY FAILURE
// SURFACES AS A TYPED FetchError SO THE API CAN REPORT EXACTLY WHY.
export async function fetchChapter(url: string, sourceLang?: string): Promise<ParsedChapter> {
	const lang = getLanguage(sourceLang);
	try {
		const html = await fetchHtml(url, lang.acceptLanguage, lang.charsetHints);

		// PRE-CHECK: AN OBVIOUS SPA SHELL (ALMOST NO VISIBLE TEXT) → RENDER FIRST, SO WE DON'T SPEND AN AI
		// MAPPING CALL ON EMPTY HTML. OTHERWISE PARSE THE STATIC HTML AND RENDER ONLY IF IT CAN'T BE PARSED.
		let chapter: ParsedChapter;
		if (visibleTextLen(html) < 600) {
			const rendered = await tryRender(url, lang.acceptLanguage);
			chapter = await parseChapter(rendered ?? html, url);
		} else {
			try {
				chapter = await parseChapter(html, url);
			} catch (e) {
				if (!isRenderableFailure(e)) throw e;
				const rendered = await tryRender(url, lang.acceptLanguage);
				if (!rendered || rendered === html) throw e;
				chapter = await parseChapter(rendered, url);
			}
		}

		// RECORD THE OUTCOME FOR THE /admin DASHBOARD (BEST-EFFORT, NEVER BLOCKS THE FETCH).
		void recordFetchOk(url);
		return chapter;
	} catch (e) {
		void recordFetchError(url, e);
		throw e;
	}
}

// FETCH A BOOK'S COVER IMAGE FROM ITS INDEX/BOOK PAGE. SSRF-GUARDED, BEST-EFFORT (null ON ANY FAILURE).
// TRIES og:image / scored <img> DETERMINISTICALLY, THEN AN AI PICK FROM THE PAGE'S IMAGES AS A FALLBACK.
export async function fetchBookCover(indexUrl: string, sourceLang?: string): Promise<string | null> {
	try {
		await assertPublicUrl(indexUrl);
		const lang = getLanguage(sourceLang);
		const html = await fetchHtml(indexUrl, lang.acceptLanguage, lang.charsetHints);
		return extractCover(html, indexUrl) ?? (await learnCover(html, indexUrl));
	} catch {
		return null;
	}
}
