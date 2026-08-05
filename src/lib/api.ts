// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/public';
// IMPORTED DEP-MODULES
import { browser } from '$app/environment';
// IMPORTED MODULES
import { firebaseAuth } from '$lib/firebase';

// -- CONSTANTS -- //

// THE LIVE API ORIGIN FOR THE CAPACITOR STATIC SPA — BAKED INTO THE BUNDLE AT BUILD TIME (adapter-static
// runs generateEnvModule). EMPTY → SAME-ORIGIN (THE WEB APP: PAGES AND /api SHARE ONE ORIGIN, SO NO
// PREFIX IS NEEDED AND SSR KEEPS USING RELATIVE URLS VIA THE SVELTEKIT LOAD fetch).
const API_BASE = (env.PUBLIC_API_BASE ?? '').replace(/\/+$/, '');

// -- FUNCTIONS -- //

// RESOLVE AN API PATH TO A FETCHABLE URL: ABSOLUTE (PUBLIC_API_BASE + path) ON THE NATIVE BUILD, THE
// RELATIVE PATH AS-IS ON WEB (WHERE THE SVELTEKIT LOAD fetch / THE BROWSER RESOLVE IT SAME-ORIGIN).
export function apiUrl(path: string): string {
	return API_BASE ? `${API_BASE}${path}` : path;
}

// A FRESH FIREBASE ID TOKEN AS A Bearer HEADER — THE CAPACITOR SPA'S AUTH TRANSPORT (IT CANNOT HOLD THE
// httpOnly SESSION COOKIE ACROSS ORIGINS). WEB REQUESTS RIDE THE COOKIE INSTEAD, BUT SENDING BOTH IS
// HARMLESS (THE SERVER PREFERS THE COOKIE). NEVER RUNS DURING SSR — NO FIREBASE INIT, NO TOKEN FETCH.
export async function authHeaders(): Promise<Record<string, string>> {
	if (!browser) return {};
	try {
		const user = firebaseAuth().currentUser;
		if (!user) return {};
		const token = await user.getIdToken();
		return { authorization: `Bearer ${token}` };
	} catch {
		return {};
	}
}

// THE ONE CLIENT ENTRY POINT FOR /api CALLS — SAME-ORIGIN fetch ON WEB (THE httpOnly SESSION COOKIE RIDES
// ALONG AUTOMATICALLY); ABSOLUTE + Bearer ON THE CAPACITOR SPA. STREAMING RESPONSES (THE TRANSLATE SSE)
// PASS STRAIGHT THROUGH.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	for (const [name, value] of Object.entries(await authHeaders())) headers.set(name, value);
	return fetch(apiUrl(path), { ...init, headers });
}

// CONVENIENCE WRAPPER OVER apiFetch FOR JSON ENDPOINTS — PARSES THE BODY, AND ON A NON-OK RESPONSE THROWS AN
// Error CARRYING THE SERVER'S { message } (FALLING BACK TO fallbackMsg). REPLACES THE ~40 HAND-ROLLED
// `if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? '…')` BLOCKS ACROSS THE APP.
export async function apiJson<T = unknown>(
	path: string,
	init: RequestInit = {},
	fallbackMsg = 'Something went wrong. Try again.',
): Promise<T> {
	const res = await apiFetch(path, init);
	const data = await res.json().catch(() => ({}) as Record<string, unknown>);
	if (!res.ok) throw new Error((data as { message?: string }).message ?? fallbackMsg);
	return data as T;
}
