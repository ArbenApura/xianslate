// IMPORTED DEP-TYPES
import type { Handle, RequestEvent } from '@sveltejs/kit';
// IMPORTED TYPES
import type { AuthUser } from '$lib/server/auth/user';
// IMPORTED DEP-MODULES
import { json, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
// IMPORTED MODULES
import { upsertUserFromToken } from '$lib/server/auth/user';
import { SESSION_COOKIE, verifyIdToken, verifySessionCookie } from '$lib/server/auth/verify';
import { THEME_BG, THEME_COOKIE } from '$lib/stores/settings';

// -- TYPES -- //

declare global {
	var __xsProcessGuards: boolean | undefined;
}

// -- CONSTANTS -- //

// PROCESS-LEVEL RESILIENCE. A STRAY ASYNC REJECTION — e.g. A DETACHED TRANSLATION JOB SAVING TO A CHAPTER
// THE USER DELETED MID-FLIGHT (A POSTGRES FK VIOLATION, code 23503) — MUST NOT TAKE THE WHOLE SERVER DOWN.
// NODE EXITS ON AN UNHANDLED REJECTION BY DEFAULT; LOG IT AND KEEP SERVING. SINGLE-INSTANCE, SO STAYING UP
// THROUGH A BACKGROUND RACE IS FAR BETTER THAN CRASHING EVERY ACTIVE READER. REGISTERED ONCE (HMR-SAFE).
if (!globalThis.__xsProcessGuards) {
	globalThis.__xsProcessGuards = true;
	process.on('unhandledRejection', (reason) => console.error('[server] unhandled rejection (kept alive):', reason));
	process.on('uncaughtException', (err) => console.error('[server] uncaught exception (kept alive):', err));
}

const DARK = ['dark', 'oled', 'contrast'];

// -- CONSTANTS -- //

// CORS ORIGINS OF THE CAPACITOR NATIVE APPS (ANDROID WebView = https://localhost — androidScheme https in
// capacitor.config.ts — iOS WKWebView = capacitor://localhost). THE MOBILE APP IS A STATIC SPA THAT CALLS
// THIS SAME SERVER CROSS-ORIGIN. THE WEB APP IS SAME-ORIGIN, SO IT NEVER MATCHES AND IS COMPLETELY
// UNTOUCHED.
const CAPACITOR_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);

function corsHeaders(origin: string): Record<string, string> {
	return {
		'access-control-allow-origin': origin,
		'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
		'access-control-allow-headers': 'authorization, content-type',
		'access-control-max-age': '86400',
	};
}

// -- HANDLES -- //

// CORS FOR THE CAPACITOR STATIC SPA. PREFLIGHTS (OPTIONS) SHORT-CIRCUIT HERE; EVERY REAL RESPONSE TO A
// KNOWN NATIVE ORIGIN GETS THE HEADERS ATTACHED. NO CREDENTIALS FLAG — THE NATIVE APP AUTHENTICATES WITH
// A Bearer FIREBASE ID TOKEN, NOT COOKIES, SO NOTHING EXTRA IS REQUIRED FOR CROSS-ORIGIN FETCHES.
const corsHandle: Handle = async ({ event, resolve }) => {
	const origin = event.request.headers.get('origin');
	if (!origin || !CAPACITOR_ORIGINS.has(origin)) return resolve(event);
	if (event.request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: corsHeaders(origin) });
	}
	const response = await resolve(event);
	for (const [name, value] of Object.entries(corsHeaders(origin))) {
		response.headers.set(name, value);
	}
	return response;
};

// RESOLVE THE AUTHENTICATED USER FROM EITHER TRANSPORT — THE SAME-ORIGIN SESSION COOKIE (WEB) OR A
// Bearer FIREBASE ID TOKEN (CAPACITOR STATIC SPA — NO COOKIE POSSIBLE ACROSS ORIGINS). COOKIE WINS WHEN
// BOTH ARE PRESENT (THE WEB CLIENT SENDS BOTH; THEY NAME THE SAME USER). EACH VERIFY USES FIREBASE'S
// CACHED PUBLIC KEYS — NO NETWORK ROUND-TRIP PER REQUEST.
const BEARER_RE = /^Bearer\s+(.+)$/i;

async function resolveUser(event: RequestEvent): Promise<AuthUser | null> {
	const cookie = event.cookies.get(SESSION_COOKIE);
	if (cookie) {
		try {
			return await upsertUserFromToken(await verifySessionCookie(cookie));
		} catch {
			// INVALID / EXPIRED / REVOKED → TREAT AS SIGNED OUT (NEVER 500 THE WHOLE REQUEST ON A STALE COOKIE).
		}
	}
	const header = event.request.headers.get('authorization');
	const match = header ? BEARER_RE.exec(header) : null;
	if (match) {
		try {
			return await upsertUserFromToken(await verifyIdToken(match[1]));
		} catch {
			// INVALID / EXPIRED TOKEN → SIGNED OUT (THE FIREBASE WEB SDK REFRESHES ID TOKENS ~EVERY HOUR,
			// SO A STALE ONE IS A TRANSIENT STATE — THE CLIENT RETRIES AFTER getIdToken(true)).
		}
	}
	return null;
}

// -- FUNCTIONS -- //

// RESOLVE THE AUTHENTICATED USER AND ENFORCE ROUTE GUARDS FROM THE SAME-ORIGIN SESSION COOKIE. NO COOKIE →
// ZERO AUTH WORK (ANONYMOUS ASSET/LANDING HITS PAY NOTHING). populates event.locals.user.
const authHandle: Handle = async ({ event, resolve }) => {
	event.locals.user = await resolveUser(event);

	const { pathname } = event.url;

	// /api/* IS JSON — RETURN 401 JSON, NEVER A REDIRECT. /api/auth/* (SIGN-IN/OUT) AND /api/me (THE
	// "WHO AM I" PROBE — RETURNS { user: null } WHEN SIGNED OUT) ARE PUBLIC SO THEY NEVER 401.
	const user = event.locals.user;
	if (pathname.startsWith('/api/')) {
		const isPublicApi = pathname.startsWith('/api/auth/') || pathname === '/api/me' || pathname === '/api/me/';
		if (!isPublicApi && !user) return json({ message: 'Sign in required.' }, { status: 401 });
	} else if (pathname.startsWith('/app')) {
		// PAGES — REDIRECT TO /login, PRESERVING THE INTENDED DESTINATION.
		if (!user) throw redirect(303, `/login/?redirect=${encodeURIComponent(pathname + event.url.search)}`);
	} else if (user && /^\/(login|signup)\/?$/.test(pathname)) {
		// ALREADY SIGNED IN → SKIP THE AUTH PAGES. HONOUR A SAFE INTERNAL ?redirect= (THE BOUNCE TARGET),
		// ELSE GO TO THE LIBRARY.
		const dest = event.url.searchParams.get('redirect');
		const safe = !!dest && dest.startsWith('/') && !dest.startsWith('//') && !/^\/(login|signup)/.test(dest);
		throw redirect(303, safe ? dest : '/app/');
	}

	return resolve(event);
};

// PRE-RENDER THE SAVED THEME ONTO <html> FROM THE COOKIE SO THERE'S NO FLASH ON LOAD
const themeHandle: Handle = async ({ event, resolve }) => {
	const theme = event.cookies.get(THEME_COOKIE) ?? 'sepia';
	const isDark = DARK.includes(theme);
	const bg = (THEME_BG as Record<string, string>)[theme] ?? THEME_BG.sepia;
	const htmlClass = isDark ? 'h-full dark' : 'h-full';
	const htmlStyle = `background-color:${bg};color-scheme:${isDark ? 'dark' : 'light'}`;
	return resolve(event, {
		// ALSO SEED THE MOBILE BROWSER-CHROME COLOR (theme-color META) FROM THE SAME THEME SO THE ADDRESS /
		// STATUS BAR MATCHES THE PAGE ON FIRST PAINT — THE CLIENT KEEPS IT IN SYNC ON THEME CHANGE.
		transformPageChunk: ({ html }) =>
			html.replace('%THEME_CLASS%', htmlClass).replace('%THEME_STYLE%', htmlStyle).replace('%THEME_COLOR%', bg),
	});
};

// -- LIFECYCLES -- //

// CORS (PREFLIGHT + HEADERS FOR THE NATIVE SPA) FIRST, THEN AUTH (401/REDIRECT), THEN THEME (RENDER).
// TRANSLATION RUNS IN-PROCESS (SINGLE-INSTANCE): /api/translate DRIVES THE IN-MEMORY JOB DIRECTLY — NO
// WORKER OR CACHE-BUS TO START. GLOSSARY / SITE-ADAPTER CACHE INVALIDATION IS LOCAL TO THIS PROCESS.
export const handle = sequence(corsHandle, authHandle, themeHandle);
