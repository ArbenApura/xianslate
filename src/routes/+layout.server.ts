// IMPORTED DEP-TYPES
import type { LayoutServerLoad } from './$types';
// IMPORTED CONSTANTS
import { THEME_COOKIE } from '$lib/stores/settings';

// -- FUNCTIONS -- //

// PROVIDE THE COOKIE THEME (SO THE CONTENT ROOT RENDERS IT ON THE SERVER — NO FLICKER) AND THE SIGNED-IN
// USER (SO THE CLIENT auth STORE SEEDS WITHOUT A ROUND-TRIP / FLASH ON WEB). ON THE CAPACITOR STATIC SPA
// NO SERVER LOAD RUNS, SO data.user IS undefined THERE AND THE STORE FALLS BACK TO THE /api/me PROBE.
export const load: LayoutServerLoad = ({ cookies, locals }) => {
	return { theme: cookies.get(THEME_COOKIE) ?? 'sepia', user: locals.user };
};
