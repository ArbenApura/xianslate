// IMPORTED DEP-TYPES
import type { PageServerLoad } from './$types';
// IMPORTED DEP-MODULES
import { redirect } from '@sveltejs/kit';

// /app/account/ IS THE ACCOUNT LANDING — EVERY SECTION IS A REAL ROUTE, SO THE BARE PATH (USED BY THE
// ACCOUNT MENU + LANDING FOOTER LINKS) BOUNCES TO THE PROFILE SECTION. 303 KEEPS THE ADDRESS BAR CLEAN
// AND MAKES "Profile" THE CANONICAL URL, MATCHING THE OTHER SECTIONS' EXACT ROUTES.
export const load: PageServerLoad = () => {
	throw redirect(303, '/app/account/profile/');
};
