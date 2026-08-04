// IMPORTED MODULES
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { apiFetch } from '$lib/api';
import { firebaseAuth } from '$lib/firebase';
import { get, writable } from 'svelte/store';

// -- TYPES -- //

// THE CLIENT-FACING AUTHENTICATED USER. MIRRORS THE SERVER AuthUser SHAPE (SEE $lib/server/auth/user), BUT
// DECLARED HERE SO NO SERVER MODULE IS PULLED INTO THE CLIENT BUNDLE. /api/me RETURNS EXACTLY THIS.
export type SessionUser = {
	id: string;
	email: string;
	emailVerified: boolean;
	name: string | null;
	avatarUrl: string | null;
	role: 'user' | 'admin';
	createdAt: number;
};

// -- STORES -- //

// THE CLIENT SOURCE OF TRUTH FOR "WHO AM I". SEEDED FROM THE SSR LAYOUT DATA (NO FLASH) AND/OR
// REFRESHED FROM /api/me. null = SIGNED OUT.
export const currentUser = writable<SessionUser | null>(null);

// TRUE ONCE refreshUser() HAS RESOLVED AT LEAST ONCE — LETS UI DISTINGUISH "STILL LOADING" FROM "SIGNED OUT".
export const authReady = writable(false);

// -- FUNCTIONS -- //

// PULL THE CURRENT USER FROM THE SERVER (SAME-ORIGIN COOKIE). /api/me IS EXEMPT FROM THE 401 GUARD, SO A
// SIGNED-OUT CALL RETURNS { user: null } RATHER THAN ERRORING.
export async function refreshUser(): Promise<SessionUser | null> {
	if (!browser) return null;
	try {
		const res = await apiFetch('/api/me');
		const data = (await res.json().catch(() => ({}))) as { user?: SessionUser | null };
		const user = data.user ?? null;
		currentUser.set(user);
		return user;
	} catch {
		// NETWORK / PARSE FAILURE — LEAVE THE EXISTING VALUE, BUT DON'T BLOCK THE READY FLAG.
		return get(currentUser);
	} finally {
		authReady.set(true);
	}
}

// SEED THE STORE FROM SSR LAYOUT DATA WITHOUT CLOBBERING A FRESHER CLIENT VALUE.
export function seedUser(user: SessionUser | null | undefined): void {
	if (user === undefined) return;
	currentUser.set(user);
	authReady.set(true);
}

// FULL SIGN-OUT: DROP THE FIREBASE CLIENT SESSION, CLEAR THE SERVER COOKIE, RESET THE STORE, THEN LAND ON
// THE LOGIN PAGE. EACH STEP IS BEST-EFFORT SO A FAILURE IN ONE STILL SIGNS THE USER OUT EVERYWHERE ELSE.
export async function signOutEverywhere(redirectTo = '/login/'): Promise<void> {
	try {
		await firebaseAuth().signOut();
	} catch {
		// IGNORE — THE FIREBASE CLIENT MAY ALREADY BE SIGNED OUT.
	}
	try {
		await apiFetch('/api/auth/logout', { method: 'POST' });
	} catch {
		// IGNORE — THE COOKIE IS BEST-EFFORT TO CLEAR.
	}
	currentUser.set(null);
	authReady.set(true);
	await goto(redirectTo);
}
