// IMPORTED DEP-TYPES
import type { Handle } from '@sveltejs/kit';
// IMPORTED TYPES
import type { AuthUser } from '$lib/server/auth/user';
// IMPORTED DEP-MODULES
import { json, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
// IMPORTED MODULES
import { upsertUserFromToken } from '$lib/server/auth/user';
import { SESSION_COOKIE, verifySessionCookie } from '$lib/server/auth/verify';
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

// -- FUNCTIONS -- //

// RESOLVE THE AUTHENTICATED USER AND ENFORCE ROUTE GUARDS FROM THE SAME-ORIGIN SESSION COOKIE. NO COOKIE →
// ZERO AUTH WORK (ANONYMOUS ASSET/LANDING HITS PAY NOTHING). populates event.locals.user.
const authHandle: Handle = async ({ event, resolve }) => {
	let user: AuthUser | null = null;
	const cookie = event.cookies.get(SESSION_COOKIE);
	if (cookie) {
		try {
			user = await upsertUserFromToken(await verifySessionCookie(cookie));
		} catch {
			// INVALID / EXPIRED / REVOKED → TREAT AS SIGNED OUT (NEVER 500 THE WHOLE REQUEST ON A STALE COOKIE).
			user = null;
		}
	}
	event.locals.user = user;

	const { pathname } = event.url;

	// /api/* IS JSON — RETURN 401 JSON, NEVER A REDIRECT. /api/auth/* (SIGN-IN/OUT) AND /api/me (THE
	// "WHO AM I" PROBE — RETURNS { user: null } WHEN SIGNED OUT) ARE PUBLIC SO THEY NEVER 401.
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

// AUTH (401/REDIRECT) FIRST, THEN THEME (RENDER).
// TRANSLATION RUNS IN-PROCESS (SINGLE-INSTANCE): /api/translate DRIVES THE IN-MEMORY JOB DIRECTLY — NO
// WORKER OR CACHE-BUS TO START. GLOSSARY / SITE-ADAPTER CACHE INVALIDATION IS LOCAL TO THIS PROCESS.
export const handle = sequence(authHandle, themeHandle);
