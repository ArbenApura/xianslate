// AUTOMATED TEST HARNESS FOR THE SCRAPER ENGINE.
//
// EXERCISES THE *REAL* PURE ENGINE (site-parser.ts) AGAINST LIVE CHINESE NOVEL SITES: FETCH → AI-MAP
// (DEEPSEEK) → applyAdapter → SCORE. THE STATEFUL ORCHESTRATION (CACHE/DB/HEAL) IS REPLICATED HERE IN
// MINIATURE SO WE CAN RUN WITHOUT BOOTING SvelteKit. BUNDLE WITH esbuild, RUN WITH node --env-file=.env.
//
//   node tools/run-fetch-test.mjs            # all default URLs, using the learned-map cache
//   FORCE=1 node tools/run-fetch-test.mjs    # ignore cache, re-learn every host (after prompt changes)
//   node tools/run-fetch-test.mjs <url>...   # specific URLs

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import OpenAI from 'openai';
import { parse } from 'node-html-parser';
import { buildSkeleton, applyAdapter, coerceMap, MAP_SYSTEM, type SelectorMap } from '../src/lib/server/site-parser';
import { decodeTextBytes } from '../src/lib/server/charset';
import { renderHtml } from '../src/lib/server/headless';

const execFileAsync = promisify(execFile);

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const client = new OpenAI({
	apiKey: process.env.DEEPSEEK_API_KEY ?? '',
	baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
});
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
const FORCE = process.env.FORCE === '1';

const CACHE_FILE = 'tools/learned-maps.json';
const learned: Record<string, SelectorMap> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
function saveLearned(): void {
	writeFileSync(CACHE_FILE, JSON.stringify(learned, null, 2));
}

const DEFAULT_URLS = [
	'https://www.jjwxc.net/onebook.php?novelid=6287584&chapterid=1',
	'https://www.piaotia.com/html/12/12507/11623029.html',
	'https://www.shuhaige.net/441453/151502857.html',
	'https://www.biquguo.com/45/45492/478093.html',
];

function hostOf(u: string): string {
	return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
}

async function curlFetch(url: string): Promise<Buffer> {
	const { stdout } = await execFileAsync('curl', ['-sL', '-m', '30', '--compressed', '-A', UA, url], {
		maxBuffer: 64 * 1024 * 1024,
		encoding: 'buffer',
	});
	return stdout as unknown as Buffer;
}

async function fetchHtml(url: string): Promise<string> {
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
			redirect: 'follow',
			signal: AbortSignal.timeout(30_000),
		});
		if (res.ok) {
			const b = Buffer.from(await res.arrayBuffer());
			if (b.length >= 100) return decodeTextBytes(new Uint8Array(b), true);
		}
	} catch {
		// FALL THROUGH TO curl
	}
	const buf = await curlFetch(url);
	if (!buf || buf.length < 100) throw new Error('empty response (blocked / network)');
	return decodeTextBytes(new Uint8Array(buf), true);
}

let aiCalls = 0;
async function learn(root: ReturnType<typeof parse>, url: string, hint?: string): Promise<SelectorMap> {
	aiCalls++;
	const digest = buildSkeleton(root);
	const res = await client.chat.completions.create({
		model: MODEL,
		temperature: 0,
		max_tokens: 1024,
		response_format: { type: 'json_object' },
		messages: [
			{ role: 'system', content: MAP_SYSTEM },
			{ role: 'user', content: `URL: ${url}\n\n${digest}${hint ? `\n\nNOTE: ${hint}` : ''}` },
		],
		thinking: { type: 'disabled' },
	} as never);
	return coerceMap(res.choices[0]?.message?.content ?? '{}');
}

type EngineResult = { parsed: ReturnType<typeof applyAdapter>; map: SelectorMap; usedAi: boolean; digest: string };

function visibleTextLen(html: string): number {
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim().length;
}

async function engine(url: string): Promise<EngineResult> {
	const host = hostOf(url);
	let html = await fetchHtml(url);
	// MIRROR PRODUCTION: AN SPA SHELL (ALMOST NO VISIBLE TEXT) → RENDER IN HEADLESS CHROMIUM FIRST.
	if (visibleTextLen(html) < 600) {
		const rendered = await renderHtml(url, 'zh-CN,zh;q=0.9');
		if (rendered) {
			console.log(`  (rendered ${host}: ${visibleTextLen(html)} → ${visibleTextLen(rendered)} visible chars)`);
			html = rendered;
		}
	}
	const root = parse(html);
	const digest = buildSkeleton(root);

	const cached = FORCE ? undefined : learned[host];
	if (cached) {
		const p = applyAdapter(root, html, cached, url);
		if (p) return { parsed: p, map: cached, usedAi: false, digest };
	}

	let hint: string | undefined;
	let lastErr: unknown;
	for (let i = 0; i < 2; i++) {
		let m: SelectorMap;
		try {
			m = await learn(root, url, hint);
		} catch (e) {
			lastErr = e;
			hint = 'Return valid JSON with concrete selectors chosen from the candidate lists.';
			continue;
		}
		const p = applyAdapter(root, html, m, url);
		if (p) {
			learned[host] = m;
			saveLearned();
			return { parsed: p, map: m, usedAi: true, digest };
		}
		lastErr = new Error('selectors did not extract a chapter');
		hint =
			'Your previous selectors did not extract the chapter. The body must be the CONTENT CANDIDATE whose preview is story prose (not a menu/comments/whole page); the title must be a real chapter heading.';
	}
	throw lastErr ?? new Error('unsupported');
}

// CHROME TOKENS THAT SHOULD NEVER APPEAR AT THE START OF A REAL CHAPTER BODY.
const CHROME =
	/排行榜|登录|登錄|注册|註冊|书架|書架|首页|首頁|加入书签|推荐票|推薦票|最近阅读|VIP作品|论坛|論壇|APP下载|站内搜索|繁體版|简体版|您的浏览器|javascript/i;

type Score = { status: 'PASS' | 'WARN' | 'FAIL'; issues: string[]; head: string };
function evaluate(r: EngineResult): Score {
	const p = r.parsed!;
	const issues: string[] = [];
	const title = (p.titleSource || '').trim();
	const body = p.contentSource || '';
	const head = body.slice(0, 160).replace(/\s+/g, ' ');

	if (!title) issues.push('NO TITLE');
	else if (title.length > 120) issues.push(`title too long (${title.length})`);
	if (body.length < 400) issues.push(`BODY TOO SHORT (${body.length})`);
	if (CHROME.test(head)) issues.push('CHROME LEAK in body head');
	const navCount = [p.prevUrl, p.nextUrl, p.indexUrl].filter(Boolean).length;
	if (navCount === 0) issues.push('no prev/next/index');

	const fail = issues.some((s) => /NO TITLE|BODY TOO SHORT|CHROME LEAK/.test(s));
	const status = fail ? 'FAIL' : issues.length ? 'WARN' : 'PASS';
	return { status, issues, head };
}

async function main(): Promise<void> {
	if (!existsSync('tools')) mkdirSync('tools');
	const args = process.argv.slice(2).filter((a) => a.startsWith('http'));
	const urls = args.length ? args : DEFAULT_URLS;

	// DEBUG: DUMP THE PAGE DIGEST THE MODEL ACTUALLY SEES, THEN STOP (NO AI CALL).
	if (process.env.DEBUG === '1') {
		for (const url of urls) {
			let html = await fetchHtml(url);
			if (visibleTextLen(html) < 600) {
				const rendered = await renderHtml(url, 'zh-CN,zh;q=0.9');
				if (rendered) html = rendered;
			}
			const root = parse(html);
			console.log(`\n===== DIGEST ${url} (htmlLen=${html.length}) =====`);
			console.log(buildSkeleton(root));
		}
		return;
	}

	let pass = 0;
	let warn = 0;
	let fail = 0;
	for (const url of urls) {
		try {
			const r = await engine(url);
			const e = evaluate(r);
			if (e.status === 'PASS') pass++;
			else if (e.status === 'WARN') warn++;
			else fail++;
			const p = r.parsed!;
			console.log(`\n[${e.status}] ${url}`);
			console.log(`  host=${hostOf(url)}  ai=${r.usedAi}`);
			console.log(`  title : "${(p.titleSource || '').slice(0, 90)}"`);
			console.log(`  body  : ${(p.contentSource || '').length} chars`);
			console.log(`  head  : ${e.head.slice(0, 100)}`);
			console.log(
				`  nav   : prev=${p.prevUrl ? 'Y' : '-'} next=${p.nextUrl ? 'Y' : '-'} index=${p.indexUrl ? 'Y' : '-'}  author=${p.author ?? '-'}`,
			);
			console.log(`  map   : title=${JSON.stringify(r.map.title)} body=${JSON.stringify(r.map.body)}`);
			if (e.issues.length) console.log(`  ISSUES: ${e.issues.join('; ')}`);
		} catch (e) {
			fail++;
			console.log(`\n[ERROR] ${url}`);
			console.log(`  ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	console.log(`\n==== ${pass} PASS / ${warn} WARN / ${fail} FAIL  (${urls.length} sites, ${aiCalls} AI calls) ====`);
}

await main();
