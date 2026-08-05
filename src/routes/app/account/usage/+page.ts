// IMPORTED DEP-TYPES
import type { PageLoad } from './$types';
// IMPORTED TYPES
import type { AccountUsage } from '$lib/types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
// IMPORTED MODULES
import { apiUrl, authHeaders } from '$lib/api';

// USAGE DATA NOW COMES FROM /api/me/usage (A UNIVERSAL LOAD) SO THE PAGE WORKS IDENTICALLY UNDER WEB SSR
// AND THE CAPACITOR STATIC SPA — THE SPA RUNS NO SERVER LOADS, SO THE OLD +page.server.ts COULD NOT
// SUPPLY IT THERE. WEB SSR RESOLVES THE RELATIVE URL VIA THE SVELTEKIT LOAD fetch; THE NATIVE SPA GETS
// THE ABSOLUTE PUBLIC_API_BASE URL + A Bearer FIREBASE ID TOKEN (authHeaders).
export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch(apiUrl('/api/me/usage'), { headers: await authHeaders() });
	if (!res.ok) throw error(res.status, 'Could not load usage.');
	const data = (await res.json()) as { usage: AccountUsage };
	return { usage: data.usage };
};
