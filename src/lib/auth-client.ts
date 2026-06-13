// IMPORTED DEP-TYPES
import type { UserCredential } from 'firebase/auth';
// IMPORTED MODULES
import { goto } from '$app/navigation';
import { apiFetch } from '$lib/api';
import { refreshUser } from '$lib/stores/auth';

// EXCHANGE A SIGNED-IN FIREBASE CREDENTIAL FOR A SAME-ORIGIN SERVER SESSION COOKIE, THEN NAVIGATE INTO THE
// APP. THE SERVER VERIFIES THE ID TOKEN + UPSERTS THE users ROW BEFORE MINTING THE COOKIE. THE auth STORE
// IS HYDRATED FROM /api/me BEFORE NAVIGATING SO THE LIBRARY HEADER (ADMIN GATE / ACCOUNT MENU) IS CORRECT
// IMMEDIATELY — THE ROOT LAYOUT'S SERVER LOAD WOULDN'T RE-RUN ON THIS CLIENT-SIDE NAVIGATION ON ITS OWN.
export async function establishSession(cred: UserCredential, redirectTo = '/app/'): Promise<void> {
	const idToken = await cred.user.getIdToken();
	const res = await apiFetch('/api/auth/session', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ idToken }),
	});
	if (!res.ok) throw new Error('Could not start your session. Please try again.');
	await refreshUser();
	await goto(redirectTo);
}

// TURN A FIREBASE AUTH ERROR CODE INTO A HUMAN, ACTION-SPECIFIC MESSAGE (THE RAW CODES ARE TECHNICAL).
export function authErrorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
	const code = (e as { code?: string })?.code ?? '';
	switch (code) {
		case 'auth/invalid-email':
			return 'That email address looks invalid.';
		case 'auth/user-not-found':
		case 'auth/wrong-password':
		case 'auth/invalid-credential':
			return 'Wrong email or password.';
		case 'auth/email-already-in-use':
			return 'An account with that email already exists. Try signing in.';
		case 'auth/weak-password':
			return 'Please choose a password with at least 6 characters.';
		case 'auth/popup-closed-by-user':
		case 'auth/cancelled-popup-request':
			return 'Sign-in was cancelled.';
		case 'auth/too-many-requests':
			return 'Too many attempts. Please wait a moment and try again.';
		case 'auth/network-request-failed':
			return 'Network error. Check your connection and try again.';
		default:
			return e instanceof Error && e.message ? e.message : fallback;
	}
}
