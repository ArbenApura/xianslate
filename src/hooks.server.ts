// IMPORTED DEP-TYPES
import type { Handle } from '@sveltejs/kit';
// IMPORTED TYPES
import type { AuthUser } from '$lib/server/auth/user';
// IMPORTED DEP-MODULES
import { json, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
// IMPORTED MODULES
import { upsertUserFromToken } from '$lib/server/auth/user';
import { SESSION_COOKIE, verifyIdToken, verifySessionCookie } from '$lib/server/auth/verify';
import { THEME_BG, THEME_COOKIE } from '$lib/stores/settings';

// -- CONSTANTS -- //

const DARK = ['dark', 'oled', 'contrast'];

// -- FUNCTIONS -- //

// RESOLVE THE AUTHENTICATED USER AND ENFORCE ROUTE GUARDS. ACCEPTS EITHER A BEARER ID TOKEN (NATIVE) OR THE
// SAME-ORIGIN SESSION COOKIE (WEB). NO COOKIE + NO BEARER → ZERO AUTH WORK (ANONYMOUS ASSET/LANDING HITS
// PAY NOTHING). populates event.locals.user.
const authHandle: Handle = async ({ event, resolve }) => {
	let user: AuthUser | null = null;
	const authz = event.request.headers.get('authorization');
	const cookie = event.cookies.get(SESSION_COOKIE);
	try {
		if (authz?.startsWith('Bearer ')) {
			user = await upsertUserFromToken(await verifyIdToken(authz.slice(7)));
		} else if (cookie) {
			user = await upsertUserFromToken(await verifySessionCookie(cookie));
		}
	} catch {
		// INVALID / EXPIRED / REVOKED → TREAT AS SIGNED OUT (NEVER 500 THE WHOLE REQUEST ON A STALE COOKIE).
		user = null;
	}
	event.locals.user = user;

	const { pathname } = event.url;

	// /api/* IS JSON — RETURN 401/403 JSON, NEVER A REDIRECT. /api/auth/* IS PUBLIC (SIGN-IN/OUT).
	if (pathname.startsWith('/api/')) {
		if (!pathname.startsWith('/api/auth/')) {
			if (!user) return json({ message: 'Sign in required.' }, { status: 401 });
			if (pathname.startsWith('/api/admin/') && user.role !== 'admin')
				return json({ message: 'Admin only.' }, { status: 403 });
		}
	} else if (pathname.startsWith('/app') || pathname.startsWith('/admin')) {
		// PAGES — REDIRECT TO /login, PRESERVING THE INTENDED DESTINATION.
		if (!user) throw redirect(303, `/login/?redirect=${encodeURIComponent(pathname + event.url.search)}`);
		if (pathname.startsWith('/admin') && user.role !== 'admin') throw redirect(303, '/app/');
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

// AUTH FIRST (CAN SHORT-CIRCUIT WITH 401/403/REDIRECT BEFORE ANY THEME WORK), THEN THEME (DOES THE RENDER).
export const handle = sequence(authHandle, themeHandle);
