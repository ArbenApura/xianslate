// OFFLINE SESSION PERSISTENCE — KEEP THE LAST-KNOWN AUTHENTICATED USER LOCALLY SO A COLD START WHILE
// OFFLINE RENDERS THE APP INSTEAD OF BOUNCING TO /login.
//
// WITHOUT THIS, THE CAPACITOR SPA (NO SSR, data.user undefined) STARTS EVERY LAUNCH BY PROBING /api/me;
// OFFLINE THAT PROBE FAILS, currentUser STAYS null, AND THE LAYOUT GUARD REDIRECTS TO /login EVEN
// THOUGH A VALID FIREBASE SESSION IS PERSISTED. THE STORED USER IS A STALE-UNTIL-REFRESHED CACHE: THE
// SERVER'S /api/me RESPONSE (USER OR EXPLICIT null) ALWAYS WINS WHEN REACHABLE.

import { metaDelete, metaGet, metaSet } from '$lib/offline/db';
import type { SessionUser } from '$lib/stores/auth';
// -- CONSTANTS -- //

const SESSION_KEY = 'session:user';

// -- FUNCTIONS -- //

// PERSIST THE CURRENTLY KNOWN USER (null = SIGNED OUT — CLEARS THE CACHE).
export async function persistSessionUser(user: SessionUser | null): Promise<void> {
	if (!user) {
		await metaDelete(SESSION_KEY);
		return;
	}
	await metaSet(SESSION_KEY, user);
}

// READ THE LAST-KNOWN USER (null WHEN NONE, SIGNED OUT, OR IndexedDB IS UNAVAILABLE).
export async function readSessionUser(): Promise<SessionUser | null> {
	return metaGet<SessionUser>(SESSION_KEY);
}
