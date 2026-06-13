// IMPORTED DEP-TYPES
import type { Handle } from '@sveltejs/kit';
// IMPORTED TYPES
import type { AuthUser } from '$lib/server/auth/user';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { json, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
// IMPORTED MODULES
import { upsertUserFromToken } from '$lib/server/auth/user';
import { SESSION_COOKIE, verifyIdToken, verifySessionCookie } from '$lib/server/auth/verify';
import { THEME_BG, THEME_COOKIE } from '$lib/stores/settings';

// -- CONSTANTS -- //

const DARK = ['dark', 'oled', 'contrast'];

// ORIGINS ALLOWED TO CALL /api CROSS-ORIGIN WITH A BEARER TOKEN (THE CAPACITOR WEBVIEW). THE WEB APP IS
// SAME-ORIGIN AND DOESN'T NEED CORS. EXTEND VIA CORS_ALLOWED_ORIGINS (COMMA-SEPARATED).
const CORS_ORIGINS = new Set(
	['https://localhost', 'capacitor://localhost', 'http://localhost', ...(env.CORS_ALLOWED_ORIGINS ?? '').split(',')]
		.map((o) => o.trim())
		.filter(Boolean),
);

// -- FUNCTIONS -- //

function corsHeaders(origin: string): Record<string, string> {
	return {
		'access-control-allow-origin': origin,
		'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
		'access-control-allow-headers': 'authorization, content-type',
		// NO access-control-allow-credentials — NATIVE USES A BEARER TOKEN, NOT COOKIES.
		vary: 'origin',
	};
}

// CROSS-ORIGIN /api ACCESS FOR THE CAPACITOR APP (BEARER, NO COOKIES). ANSWERS THE PREFLIGHT AND TAGS /api
// RESPONSES WITH CORS HEADERS FOR ALLOWED ORIGINS. THE SAME-ORIGIN WEB APP SENDS NO Origin → UNAFFECTED.
const corsHandle: Handle = async ({ event, resolve }) => {
	const origin = event.request.headers.get('origin');
	const isApi = event.url.pathname.startsWith('/api/');
	const allowed = !!origin && CORS_ORIGINS.has(origin);

	if (isApi && event.request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: allowed ? corsHeaders(origin) : {} });
	}

	const res = await resolve(event);
	if (isApi && allowed) for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
	return res;
};

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

	// /api/* IS JSON — RETURN 401/403 JSON, NEVER A REDIRECT. /api/auth/* (SIGN-IN/OUT) AND /api/me (THE
	// "WHO AM I" PROBE — RETURNS { user: null } WHEN SIGNED OUT) ARE PUBLIC SO THEY NEVER 401.
	if (pathname.startsWith('/api/')) {
		const isPublicApi = pathname.startsWith('/api/auth/') || pathname === '/api/me' || pathname === '/api/me/';
		if (!isPublicApi) {
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

// -- LIFECYCLES -- //

// CORS FIRST (PREFLIGHT SHORT-CIRCUIT), THEN AUTH (401/403/REDIRECT), THEN THEME (RENDER).
// TRANSLATION RUNS IN-PROCESS (SINGLE-INSTANCE): /api/translate DRIVES THE IN-MEMORY JOB DIRECTLY — NO
// WORKER OR CACHE-BUS TO START. GLOSSARY / SITE-ADAPTER CACHE INVALIDATION IS LOCAL TO THIS PROCESS.
export const handle = sequence(corsHandle, authHandle, themeHandle);
