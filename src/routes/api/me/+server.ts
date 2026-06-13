// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
// IMPORTED MODULES
import { adminAuth } from '$lib/server/auth/admin';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/auth/user';
import { SESSION_COOKIE } from '$lib/server/auth/verify';

// -- FUNCTIONS -- //

// WHO AM I — RETURNS THE CALLER'S OWN USER (FROM THE SESSION COOKIE OR BEARER TOKEN), OR null WHEN SIGNED
// OUT. EXEMPT FROM THE hooks 401 GUARD SO THE CLIENT auth STORE CAN PROBE SESSION STATE ON EVERY TARGET.
export const GET: RequestHandler = async ({ locals }) => {
	return json({ user: locals.user });
};

// DELETE THE CALLER'S ACCOUNT — REMOVES THE users ROW (CASCADES THEIR ENTIRE LIBRARY: BOOKS, CHAPTERS,
// TRANSLATIONS, GLOSSARY) AND THE FIREBASE ACCOUNT, THEN CLEARS THE SESSION COOKIE. IRREVERSIBLE.
export const DELETE: RequestHandler = async ({ locals, cookies }) => {
	const user = requireUser(locals);
	await db.delete(users).where(eq(users.id, user.id));
	try {
		await adminAuth().deleteUser(user.id);
	} catch {
		// THE DB ROW IS GONE EITHER WAY — A MISSING / ALREADY-DELETED FIREBASE USER MUST NOT FAIL THE REQUEST.
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
