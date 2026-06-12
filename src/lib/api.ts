// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/public';
// IMPORTED MODULES
import { browser } from '$app/environment';
import { firebaseAuth } from '$lib/firebase';

// -- CONSTANTS -- //

// THE HOSTED API ORIGIN FOR THE NATIVE (CAPACITOR) BUILD (e.g. https://xianslate.com). EMPTY ON WEB, WHERE
// /api IS SAME-ORIGIN. TRAILING SLASH TRIMMED SO `${API_BASE}/api/x` IS CLEAN.
const API_BASE = (env.PUBLIC_API_BASE ?? '').replace(/\/$/, '');

// -- FUNCTIONS -- //

// THE ONE CLIENT ENTRY POINT FOR /api CALLS.
//  - WEB: a same-origin fetch — the httpOnly session cookie rides along automatically; nothing extra.
//  - NATIVE (capacitor): prepend PUBLIC_API_BASE and attach the Firebase ID token as `Authorization: Bearer`
//    (no cookies cross-origin). Streaming responses (the translate SSE) pass straight through.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
	if (!__CAPACITOR_BUILD__) return fetch(path, init);

	const url = /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`;
	const headers = new Headers(init.headers);
	if (browser) {
		const token = await firebaseAuth()
			.currentUser?.getIdToken()
			.catch(() => null);
		if (token) headers.set('Authorization', `Bearer ${token}`);
	}
	return fetch(url, { ...init, headers });
}
