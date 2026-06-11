// IMPORTED DEP-TYPES
import type { LayoutServerLoad } from './$types';
// IMPORTED CONSTANTS
import { THEME_COOKIE } from '$lib/stores/settings';

// -- FUNCTIONS -- //

// PROVIDE THE COOKIE THEME TO THE LAYOUT SO THE CONTENT ROOT RENDERS IT ON THE SERVER (NO FLICKER)
export const load: LayoutServerLoad = ({ cookies }) => {
	return { theme: cookies.get(THEME_COOKIE) ?? 'sepia' };
};
