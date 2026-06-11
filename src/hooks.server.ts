// IMPORTED DEP-TYPES
import type { Handle } from '@sveltejs/kit';
// IMPORTED MODULES
import { THEME_BG, THEME_COOKIE } from '$lib/stores/settings';

// -- CONSTANTS -- //

const DARK = ['dark', 'oled', 'contrast'];

// -- FUNCTIONS -- //

// PRE-RENDER THE SAVED THEME ONTO <html> FROM THE COOKIE SO THERE'S NO FLASH ON LOAD
export const handle: Handle = async ({ event, resolve }) => {
	const theme = event.cookies.get(THEME_COOKIE) ?? 'sepia';
	const isDark = DARK.includes(theme);
	const bg = (THEME_BG as Record<string, string>)[theme] ?? THEME_BG.sepia;
	const htmlClass = isDark ? 'h-full dark' : 'h-full';
	const htmlStyle = `background-color:${bg};color-scheme:${isDark ? 'dark' : 'light'}`;
	return resolve(event, {
		// ALSO SEED THE MOBILE BROWSER-CHROME COLOR (theme-color META) FROM THE SAME THEME SO THE ADDRESS /
		// STATUS BAR MATCHES THE PAGE ON FIRST PAINT — THE CLIENT KEEPS IT IN SYNC ON THEME CHANGE.
		transformPageChunk: ({ html }) =>
			html.replace('%THEME_CLASS%', htmlClass).replace('%THEME_STYLE%', htmlStyle).replace('%THEME_COLOR%', bg),
	});
};
