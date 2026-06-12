// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { json } from '@sveltejs/kit';
// IMPORTED MODULES
import { SESSION_COOKIE } from '$lib/server/auth/verify';

// -- FUNCTIONS -- //

// CLEAR THE SESSION COOKIE (WEB SIGN-OUT). THE CLIENT ALSO CALLS THE FIREBASE SDK's signOut().
export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
