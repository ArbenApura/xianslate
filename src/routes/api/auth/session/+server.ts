// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED ENVS ($env/...)
import { dev } from '$app/environment';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { upsertUserFromToken } from '$lib/server/auth/user';
import { createSessionCookie, SESSION_COOKIE, SESSION_MAX_AGE_MS, verifyIdToken } from '$lib/server/auth/verify';

// -- FUNCTIONS -- //

// EXCHANGE A FRESH FIREBASE ID TOKEN FOR A SAME-ORIGIN SESSION COOKIE (WEB SIGN-IN). VERIFIES THE TOKEN
// AND UPSERTS THE users ROW BEFORE MINTING THE COOKIE, SO A BAD TOKEN NEVER YIELDS A SESSION.
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json().catch(() => null)) as { idToken?: string } | null;
	const idToken = body?.idToken;
	if (!idToken) throw error(400, 'An idToken is required.');

	let cookie: string;
	try {
		const decoded = await verifyIdToken(idToken);
		await upsertUserFromToken(decoded);
		cookie = await createSessionCookie(idToken);
	} catch {
		throw error(401, 'Could not verify that sign-in. Try again.');
	}

	// httpOnly + Lax + SAME-ORIGIN: THE WEB APP AND /api SHARE AN ORIGIN, SO NO SameSite=None / CORS NEEDED.
	cookies.set(SESSION_COOKIE, cookie, {
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		path: '/',
		maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
	});
	return json({ ok: true });
};
