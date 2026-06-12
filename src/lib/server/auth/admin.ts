// IMPORTED DEP-TYPES
import type { App } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// -- STATES -- //

// LAZY SINGLETON — INITIALISED ON FIRST USE (NOT AT IMPORT), SO A BUILD / A REQUEST THAT NEVER TOUCHES AUTH
// DOESN'T REQUIRE FIREBASE_SERVICE_ACCOUNT TO BE SET.
let app: App | undefined;

// -- FUNCTIONS -- //

// THE firebase-admin APP SINGLETON, REUSED ACROSS REQUESTS / HMR (getApps() GUARDS AGAINST DOUBLE-INIT).
function ensureApp(): App {
	if (app) return app;
	const existing = getApps();
	if (existing.length) {
		app = existing[0];
		return app;
	}
	// SERVICE-ACCOUNT JSON (THE WHOLE KEY FILE, AS A SINGLE ENV STRING). KEPT SERVER-ONLY.
	const raw = env.FIREBASE_SERVICE_ACCOUNT;
	if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured.');
	app = initializeApp({ credential: cert(JSON.parse(raw)) });
	return app;
}

// THE Auth INSTANCE FOR verifyIdToken / SESSION-COOKIE MINT + VERIFY.
export function adminAuth(): Auth {
	return getAuth(ensureApp());
}
