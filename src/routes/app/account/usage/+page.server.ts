// IMPORTED DEP-TYPES
import type { PageServerLoad } from './$types';
// IMPORTED MODULES
import { getAccountUsage } from '$lib/server/account-usage';
import { requireUser } from '$lib/server/auth/user';

// SERVER-AUTHORITATIVE USAGE DATA FOR THE CALLING ACCOUNT — AGGREGATED FROM THE translations CACHE, THE
// ai_usage LEDGER (PIPELINE + userId-ATTRIBUTED MAP SPEND), AND fetch_usage. RENDERED SSR (NO CLIENT
// ROUND-TRIP), BEHIND THE /app GUARD — A USER CAN ONLY EVER SEE THEIR OWN TOTALS.
export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	return { usage: await getAccountUsage(user.id) };
};
