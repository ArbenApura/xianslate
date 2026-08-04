// -- FUNCTIONS -- //

// THE ONE CLIENT ENTRY POINT FOR /api CALLS — A SAME-ORIGIN fetch; THE httpOnly SESSION COOKIE RIDES ALONG
// AUTOMATICALLY. STREAMING RESPONSES (THE TRANSLATE SSE) PASS STRAIGHT THROUGH.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(path, init);
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
