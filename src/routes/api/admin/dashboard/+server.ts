// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { getDashboard } from '$lib/server/site-stats';

// -- FUNCTIONS -- //

// SITES + AI-COST DASHBOARD DATA — AGGREGATED SERVER-SIDE (NO CLIENT DB ACCESS). hooks ALREADY GATES
// /api/admin/* TO ADMINS; THE re-check NARROWS THE TYPE AND DOCUMENTS THE REQUIREMENT AT THE HANDLER.
export const GET: RequestHandler = async ({ locals }) => {
	const user = requireUser(locals);
	if (user.role !== 'admin') throw error(403, 'Admin only.');
	return json(await getDashboard());
};
