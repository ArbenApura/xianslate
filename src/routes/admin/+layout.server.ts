// IMPORTED DEP-TYPES
import type { LayoutServerLoad } from './$types';
// IMPORTED DEP-MODULES
import { redirect } from '@sveltejs/kit';

// SERVER-AUTHORITATIVE GUARD FOR /admin — SIGNED OUT → /login (PRESERVING THE DESTINATION), SIGNED IN BUT
// NOT AN ADMIN → /app. RUNS ON ENTRY TO THE /admin LAYOUT, SO CLIENT-SIDE NAVIGATION CAN'T BYPASS IT.
// (MIRRORS hooks.server.ts; NATIVE IS COVERED BY THE CLIENT GUARD IN +layout.svelte.)
export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(303, `/login/?redirect=${encodeURIComponent(url.pathname + url.search)}`);
	if (locals.user.role !== 'admin') throw redirect(303, '/app/');
	return {};
};
