// IMPORTED DEP-TYPES
import type { DecodedIdToken } from 'firebase-admin/auth';
// IMPORTED MODULES
import { adminAuth } from './admin';

// -- CONSTANTS -- //

// THE FIREBASE SESSION-COOKIE NAME.
export const SESSION_COOKIE = 'xianslate_session';

// SESSION LIFETIME — FIREBASE CAPS createSessionCookie AT 14 DAYS.
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// -- FUNCTIONS -- //

// VERIFY A FIREBASE ID TOKEN (THE SHORT-LIVED TOKEN POSTED AT SIGN-IN).
export function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
	return adminAuth().verifyIdToken(idToken);
}

// MINT A LONG-LIVED SESSION COOKIE FROM A FRESH ID TOKEN (SIGN-IN). THE ID TOKEN MUST BE < 5 MIN OLD.
export function createSessionCookie(idToken: string, expiresInMs = SESSION_MAX_AGE_MS): Promise<string> {
	return adminAuth().createSessionCookie(idToken, { expiresIn: expiresInMs });
}

// VERIFY A SESSION COOKIE. checkRevoked DEFAULTS false SO THE PER-REQUEST hook VERIFIES LOCALLY
// (CACHED PUBLIC KEYS — NO NETWORK ROUND-TRIP PER REQUEST); PASS true WHERE REVOCATION MATTERS.
export function verifySessionCookie(cookie: string, checkRevoked = false): Promise<DecodedIdToken> {
	return adminAuth().verifySessionCookie(cookie, checkRevoked);
}
