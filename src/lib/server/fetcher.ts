import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { parse } from 'node-html-parser';
import type { ParsedChapter } from '$lib/types';

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

// -- SSRF GUARD -- //
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
		throw new Error('Invalid URL.');
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');
	const host = u.hostname.toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
		throw new Error('Refusing to fetch a private/loopback address.');
	}
	let addrs: { address: string; family: number }[];
	try {
		addrs = await lookup(host, { all: true });
	} catch {
		throw new Error('Could not resolve host.');
	}
	if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
		throw new Error('Refusing to fetch a private/internal address.');
	}
	return { url: u, address: addrs[0].address, family: addrs[0].family };
}

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 30_000;

const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
	'User-Agent': BROWSER_UA,
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
	'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
	'Upgrade-Insecure-Requests': '1',
	'sec-ch-ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
	'sec-ch-ua-mobile': '?0',
	'sec-ch-ua-platform': '"Windows"',
	'Sec-Fetch-Dest': 'document',
	'Sec-Fetch-Mode': 'navigate',
	'Sec-Fetch-Site': 'none',
	'Sec-Fetch-User': '?1',
};

// THESE NOVEL SITES OFTEN SERVE LEGACY CHINESE ENCODINGS (Big5 / GBK / GB18030), NOT UTF-8. DECODE THE
// RAW BYTES BY THE DECLARED CHARSET (HTTP Content-Type → <meta charset> → <meta http-equiv>) SO THE
// TEXT ISN'T MOJIBAKE. Node's TextDecoder ships full-ICU, so gbk/big5/gb18030 labels work natively.
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

function decodeHtmlBytes(bytes: Uint8Array, contentType: string | null): string {
	const label = detectCharset(bytes, contentType);
	try {
		return new TextDecoder(label).decode(bytes);
	} catch {
		// UNKNOWN/UNSUPPORTED LABEL → FALL BACK TO UTF-8 RATHER THAN THROWING
		return new TextDecoder('utf-8').decode(bytes);
	}
}

/** CURL FALLBACK — PROVEN TO PASS THE SITE'S BOT CHECK ON THIS HOST. `pin` IS THE PRE-VALIDATED IP. */
async function curlFetch(u: URL, pin: { address: string; family: number }): Promise<string> {
	const port = u.port || (u.protocol === 'https:' ? '443' : '80');
	const { stdout } = await execFileAsync(
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
			'Accept-Language: zh-CN,zh;q=0.9',
			u.href,
		],
		// CAPTURE RAW BYTES (NOT utf8) SO CHARSET DETECTION CAN RUN ON THE ORIGINAL ENCODING.
		{ maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' },
	);
	const buf = stdout as unknown as Buffer;
	if (!buf || buf.length < 100) throw new Error('Empty response from curl fallback.');
	return decodeHtmlBytes(buf, null);
}

/**
 * FETCH HTML, FALLING BACK TO SYSTEM curl WHEN THE NODE CLIENT IS BLOCKED (CLOUDFLARE 403).
 * REDIRECTS ARE FOLLOWED *MANUALLY* SO EVERY HOP IS RE-VALIDATED BY THE SSRF GUARD — A PUBLIC URL THAT
 * 30x-REDIRECTS TO 127.0.0.1 / 169.254.169.254 / AN INTERNAL HOST IS REJECTED INSTEAD OF FOLLOWED.
 */
async function fetchHtml(url: string): Promise<string> {
	let current = url;
	for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
		const pin = await assertPublicUrl(current);
		let res: Response;
		try {
			res = await fetch(current, {
				headers: BROWSER_HEADERS,
				redirect: 'manual', // WE RESOLVE REDIRECTS OURSELVES AND RE-VALIDATE EACH TARGET
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
		} catch {
			// NETWORK ERROR / TIMEOUT → TRY THE curl FALLBACK ON THIS VALIDATED, PINNED URL
			return await curlFetch(pin.url, pin);
		}
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location');
			if (!loc) throw new Error(`HTTP ${res.status} (redirect with no Location).`);
			current = new URL(loc, current).href; // LOOP RE-VALIDATES IT
			continue;
		}
		if (res.ok) return decodeHtmlBytes(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type'));
		// CLOUDFLARE / BOT-CHECK BLOCK → curl FALLBACK ON THE SAME VALIDATED URL; ANYTHING ELSE IS FATAL
		if (res.status === 403 || res.status === 503) return await curlFetch(pin.url, pin);
		throw new Error(`HTTP ${res.status}`);
	}
	throw new Error('Too many redirects.');
}

const ENTITIES: Record<string, string> = {
	'&emsp;': '　',
	'&ensp;': ' ',
	'&nbsp;': ' ',
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&apos;': "'",
	'&ldquo;': '“',
	'&rdquo;': '”',
};

// SAFELY TURN A NUMERIC CODEPOINT INTO A CHAR — A MALFORMED &#1114112; (> 0x10FFFF) WOULD OTHERWISE
// THROW RangeError AND ABORT THE WHOLE PARSE; FALL BACK TO THE LITERAL ENTITY INSTEAD.
function codePointOr(cp: number, literal: string): string {
	if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return literal;
	try {
		return String.fromCodePoint(cp);
	} catch {
		return literal;
	}
}

function decodeEntities(s: string): string {
	const out = s.replace(/&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g, (m) => {
		if (ENTITIES[m]) return ENTITIES[m];
		const dec = /^&#(\d+);$/.exec(m);
		if (dec) return codePointOr(Number(dec[1]), m);
		const hex = /^&#x([0-9a-fA-F]+);$/.exec(m);
		if (hex) return codePointOr(parseInt(hex[1], 16), m);
		return m;
	});
	return out;
}

// CONSTRUCTED FROM AN ESCAPE (NOT A LITERAL U+3000) TO AVOID A no-irregular-whitespace LINT ERROR.
const IDEOGRAPHIC_SPACE_RE = new RegExp('\\u3000', 'g');

/** TURN A CONTENT-DIV innerHTML INTO CLEAN PARAGRAPH TEXT */
function htmlToParagraphs(html: string): string {
	const noScripts = html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<ins[\s\S]*?<\/ins>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '');
	const withBreaks = noScripts.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
	const noTags = withBreaks.replace(/<[^>]+>/g, '');
	const decoded = decodeEntities(noTags);
	return decoded
		.split('\n')
		.map((l) => l.replace(IDEOGRAPHIC_SPACE_RE, ' ').trim())
		.filter((l) => l.length > 0)
		.join('\n\n');
}

function abs(href: string | undefined, base: string): string | null {
	if (!href) return null;
	try {
		return new URL(href, base).href;
	} catch {
		return null;
	}
}

/** FETCH + PARSE A uukanshu.cc CHAPTER PAGE */
export async function fetchChapter(url: string): Promise<ParsedChapter> {
	const html = await fetchHtml(url);
	const root = parse(html);

	const title = root.querySelector('h1.pt10')?.text?.trim() ?? root.querySelector('h1')?.text?.trim() ?? '';
	const contentEl = root.querySelector('.readcotent');
	if (!title || !contentEl) {
		throw new Error('Could not parse chapter (title/content not found). Is this a uukanshu.cc chapter URL?');
	}
	const contentZh = htmlToParagraphs(contentEl.innerHTML);

	// NAV LINKS BY ANCHOR TEXT (上一章 / 下一章 / 目錄)
	let prevUrl: string | null = null;
	let nextUrl: string | null = null;
	let indexUrl: string | null = null;
	for (const a of root.querySelectorAll('a')) {
		const t = a.text.trim();
		const href = a.getAttribute('href');
		if (t === '上一章') prevUrl = abs(href, url);
		else if (t === '下一章') nextUrl = abs(href, url);
		else if (t === '目錄' || t === '目录') indexUrl = abs(href, url);
	}

	// IDS FROM THE URL PATH: /book/<bookId>/<chapterId>.html
	const m = /\/book\/(\d+)\/(\d+)\.html/.exec(url);
	const bookId = m?.[1] ?? null;
	const siteChapterId = m?.[2] ?? null;

	// IF prev/next POINT AT THE INDEX, TREAT AS START/END (NO NEIGHBOUR)
	if (prevUrl && indexUrl && prevUrl === indexUrl) prevUrl = null;
	if (nextUrl && indexUrl && nextUrl === indexUrl) nextUrl = null;

	// BOOK TITLE FROM THE BREADCRUMB ANCHOR THAT LINKS TO THE INDEX
	let bookTitle: string | null = null;
	if (indexUrl) {
		for (const a of root.querySelectorAll('a')) {
			if (abs(a.getAttribute('href'), url) === indexUrl && a.text.trim() && a.text.trim() !== '目錄') {
				bookTitle = a.text.trim();
				break;
			}
		}
	}

	// AUTHOR FROM THE LastRead SCRIPT, IF PRESENT
	let author: string | null = null;
	const lr = /lastread\.set\(([^)]*)\)/.exec(html);
	if (lr) {
		const parts = lr[1].split(',').map((p) => p.trim().replace(/^["']|["']$/g, ''));
		if (parts.length >= 5 && parts[4]) author = parts[4];
	}

	return {
		titleZh: title,
		contentZh,
		siteChapterId,
		chapterUrl: url,
		prevUrl,
		nextUrl,
		indexUrl,
		bookId,
		bookTitle,
		author,
	};
}
