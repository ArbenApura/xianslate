// IMPORTED DEP-MODULES
import { readable } from 'svelte/store';

// -- CONSTANTS -- //

// BELOW Tailwind'S sm BREAKPOINT (640px) — TOO NARROW FOR THE TWO-COLUMN (BILINGUAL) READING LAYOUT.
const MOBILE_QUERY = '(max-width: 639px)';

// -- STORES -- //

// TRUE ON NARROW (PHONE) VIEWPORTS, LIVE-UPDATING ON RESIZE / ROTATE. FALSE DURING SSR (NO window),
// SO IT NEVER CHANGES MARKUP BETWEEN SERVER AND FIRST CLIENT RENDER.
export const isMobile = readable(false, (set) => {
	if (typeof window === 'undefined' || !window.matchMedia) return;
	const mq = window.matchMedia(MOBILE_QUERY);
	set(mq.matches);
	const onChange = (e: MediaQueryListEvent) => set(e.matches);
	mq.addEventListener('change', onChange);
	return () => mq.removeEventListener('change', onChange);
});
