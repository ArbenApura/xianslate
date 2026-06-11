// IMPORTED DEP-TYPES
import type { PageServerLoad } from './$types';
// IMPORTED MODULES
import { getDashboard } from '$lib/server/site-stats';

// SITES + AI-COST DASHBOARD DATA — AGGREGATED SERVER-SIDE (NO CLIENT DB ACCESS).
export const load: PageServerLoad = async () => {
	return { dashboard: await getDashboard() };
};
