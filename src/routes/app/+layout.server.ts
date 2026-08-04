// IMPORTED DEP-TYPES
import type { LayoutServerLoad } from './$types';
// IMPORTED DEP-MODULES
import { redirect } from '@sveltejs/kit';

// SERVER-AUTHORITATIVE GUARD FOR THE ENTIRE /app GROUP. ENTERING /app FROM ANYWHERE RUNS THIS LAYOUT'S
// SERVER LOAD — A NEWLY-ENTERED LAYOUT ALWAYS FETCHES ITS SERVER DATA, UNLIKE THE CACHED ROOT +layout.server
// LOAD — SO A CLIENT-SIDE NAVIGATION (e.g. THE LANDING "Open app" BUTTON) CANNOT SLIP PAST IT THE WAY IT
// SLIPS PAST THE hooks.server.ts GUARD. THE REDIRECT IS ISSUED BEFORE ANY /app HTML IS SENT (NO FLASH).
export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) throw redirect(303, `/login/?redirect=${encodeURIComponent(url.pathname + url.search)}`);
	return {};
};
