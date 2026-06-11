import { THEME_COOKIE } from '$lib/stores/settings';
import type { LayoutServerLoad } from './$types';

// PROVIDE THE COOKIE THEME TO THE LAYOUT SO THE CONTENT ROOT RENDERS IT ON THE SERVER (NO FLICKER)
export const load: LayoutServerLoad = ({ cookies }) => {
	return { theme: cookies.get(THEME_COOKIE) ?? 'sepia' };
};
