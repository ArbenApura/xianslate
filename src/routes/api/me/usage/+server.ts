// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { json } from '@sveltejs/kit';
// IMPORTED MODULES
import { getAccountUsage } from '$lib/server/account-usage';
import { requireUser } from '$lib/server/auth/user';
import { quotaStatus } from '$lib/server/spend-guard';

// PER-ACCOUNT USAGE FOR THE ACCOUNT > USAGE SECTION — MOVED OFF THE SSR +page.server.ts LOAD SO THE
// CAPACITOR STATIC SPA (WHICH RUNS NO SERVER LOADS) CAN FETCH IT THROUGH THE SAME /api SURFACE. SAME
// SERVER-AUTHORITATIVE DATA (getAccountUsage) + THE LIVE QUOTA STATE (quotaStatus — WHAT THE SPEND/RATE
// GUARD IS ENFORCING AND HOW CLOSE THIS ACCOUNT IS TO EITHER LIMIT). requireUser KEEPS IT SELF-ONLY,
// AND THE hooks 401 GUARD SHIELDS IT FOR SIGNED-OUT CALLERS.
export const GET: RequestHandler = async ({ locals }) => {
	const user = requireUser(locals);
	return json({ usage: await getAccountUsage(user.id), quota: await quotaStatus(user.id) });
};
