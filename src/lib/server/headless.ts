// HEADLESS-BROWSER RENDER TIER — THE THIRD TRANSPORT FALLBACK (AFTER node fetch + curl) FOR SITES THAT
// BUILD THEIR CHAPTER WITH CLIENT-SIDE JAVASCRIPT (SPAs), WHERE THE STATIC HTML IS AN EMPTY SHELL.
//
// IT ONLY CHANGES HOW WE *GET* THE HTML — THE RENDERED MARKUP IS FED THROUGH THE SAME parseChapter
// (AI MAPPING + applyAdapter), SO NOTHING DOWNSTREAM CHANGES AND THERE IS NO EXTRA AI COST.
//
// Playwright IS LOADED LAZILY (dynamic import): IF THE PACKAGE OR THE CHROMIUM BINARY IS MISSING, render
// RETURNS null AND THE CALLER FALLS BACK CLEANLY (THE SITE FAILS AS unsupported_site, AS BEFORE).

// IMPORTED DEP-TYPES
import type { Browser } from 'playwright';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import PQueue from 'p-queue';

// -- CONSTANTS -- //

const RENDER_TIMEOUT_MS = 25_000;

const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// BOUND PARALLEL PAGES SO A BURST OF PREFETCHES CAN'T SPAWN UNBOUNDED CHROMIUM TABS (RAM GUARD — EACH RENDER
// IS ~250MB). TUNE VIA SCRAPER_CONCURRENCY; 5 SUITS A ~4GB MACHINE.
const queue = new PQueue({ concurrency: Math.max(1, Number(env.SCRAPER_CONCURRENCY ?? '5') || 5) });

// REUSE ONE BROWSER ACROSS REQUESTS / HMR RELOADS (LAUNCH IS EXPENSIVE).
declare global {
	// eslint-disable-next-line no-var
	var __xsBrowser: Browser | undefined;
}

// -- STATES -- //

// DE-DUPE CONCURRENT LAUNCHES (FIRST CALLER LAUNCHES; THE REST AWAIT THE SAME PROMISE).
let launching: Promise<Browser | null> | null = null;

// -- FUNCTIONS -- //

async function getBrowser(): Promise<Browser | null> {
	const existing = globalThis.__xsBrowser;
	if (existing?.isConnected()) return existing;
	if (launching) return launching;
	launching = (async () => {
		try {
			const { chromium } = await import('playwright');
			const browser = await chromium.launch({
				headless: true,
				args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
			});
			globalThis.__xsBrowser = browser;
			// IF CHROMIUM DIES, DROP THE SINGLETON SO THE NEXT CALL RELAUNCHES.
			browser.on('disconnected', () => {
				if (globalThis.__xsBrowser === browser) globalThis.__xsBrowser = undefined;
			});
			return browser;
		} catch {
			// PLAYWRIGHT NOT INSTALLED / CHROMIUM MISSING / LAUNCH FAILED → CALLER FALLS BACK.
			return null;
		} finally {
			launching = null;
		}
	})();
	return launching;
}

// RENDER url IN A REAL BROWSER AND RETURN THE FULLY-BUILT HTML (UNICODE — NO CHARSET HANDLING NEEDED),
// OR null IF RENDERING IS UNAVAILABLE / FAILED. THE CALLER IS RESPONSIBLE FOR THE SSRF CHECK BEFORE THIS.
export async function renderHtml(url: string, acceptLanguage: string): Promise<string | null> {
	const browser = await getBrowser();
	if (!browser) return null;
	return (await queue.add(async () => {
		const context = await browser.newContext({
			userAgent: BROWSER_UA,
			locale: 'zh-CN',
			viewport: { width: 1280, height: 900 },
			extraHTTPHeaders: { 'Accept-Language': acceptLanguage },
		});
		try {
			// DROP IMAGES / MEDIA / FONTS — WE ONLY NEED THE DOM TEXT, AND THIS CUTS RENDER TIME SHARPLY.
			await context.route('**/*', (route) => {
				const t = route.request().resourceType();
				if (t === 'image' || t === 'media' || t === 'font') return route.abort();
				return route.continue();
			});
			const page = await context.newPage();
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
			// LET CLIENT-SIDE JS POPULATE THE CHAPTER; networkidle IS BEST-EFFORT (SOME SITES NEVER IDLE).
			await page.waitForLoadState('networkidle', { timeout: RENDER_TIMEOUT_MS }).catch(() => {});
			const html = await page.content();
			return html && html.length > 200 ? html : null;
		} catch {
			return null;
		} finally {
			await context.close().catch(() => {});
		}
	})) as string | null;
}
