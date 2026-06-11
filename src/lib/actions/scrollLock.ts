// SCROLL-LOCK ACTION — FREEZES <body> SCROLLING WHILE AN OVERLAY (DIALOG / DRAWER) IS MOUNTED, SO THE
// PAGE BEHIND CANNOT SCROLL AND ITS SCROLLBAR IS HIDDEN. REFERENCE-COUNTED SO STACKED OVERLAYS ONLY
// UNLOCK ON THE LAST CLOSE, AND THE REMOVED SCROLLBAR WIDTH IS ADDED BACK AS padding-right TO STOP THE
// LAYOUT BEHIND FROM SHIFTING. THE IMPERATIVE body.style MUTATION IS THE ACTION-LAYER ESCAPE HATCH
// (LIKE ripple / focusTrap) — COMPONENTS THEMSELVES STILL CARRY NO <style> OR style="".
//
// PASS maxWidth TO LOCK ONLY AT-OR-BELOW A VIEWPORT WIDTH (E.G. A lg:hidden DRAWER THAT IS INVISIBLE ON
// DESKTOP MUST NOT LOCK DESKTOP SCROLL): use:scrollLock={{ maxWidth: 1023 }}.

// -- TYPES -- //

type ScrollLockOptions = { maxWidth?: number };

// -- STATES -- //

let lockCount = 0;
let savedHtmlOverflow = '';
let savedHtmlPaddingRight = '';
let savedBodyOverflow = '';

// -- FUNCTIONS -- //

// APPLY THE GLOBAL LOCK ON THE FIRST OVERLAY; LATER OVERLAYS JUST BUMP THE COUNT.
// <body> IS height:100% SO THE VIEWPORT SCROLLBAR IS OWNED BY <html> (documentElement). WE:
//  (1) overflow:hidden ON html + body TO STOP SCROLL,
//  (2) ADD .no-scrollbar SO NO DEFAULT/UNTHEMED THUMB CAN LINGER (color-scheme CAN OTHERWISE PAINT ONE),
//  (3) PAD THE REMOVED SCROLLBAR WIDTH ON html — NOT body — BECAUSE html'S BACKGROUND IS THE THEME COLOUR
//      (applyThemeClass / SSR), WHEREAS body IS bg-white; PADDING body WOULD FLASH A WHITE STRIP UNDER THE
//      TRANSLUCENT BACKDROP (MOST VISIBLE ON sepia).
function acquire() {
	if (lockCount === 0 && typeof document !== 'undefined') {
		const html = document.documentElement;
		const body = document.body;
		const scrollbarWidth = window.innerWidth - html.clientWidth;
		savedHtmlOverflow = html.style.overflow;
		savedHtmlPaddingRight = html.style.paddingRight;
		savedBodyOverflow = body.style.overflow;
		html.style.overflow = 'hidden';
		body.style.overflow = 'hidden';
		html.classList.add('no-scrollbar');
		if (scrollbarWidth > 0) {
			const pad = parseFloat(getComputedStyle(html).paddingRight) || 0;
			html.style.paddingRight = `${pad + scrollbarWidth}px`;
		}
	}
	lockCount += 1;
}

// RESTORE THE ROOT AND BODY ONLY WHEN THE LAST OVERLAY RELEASES.
function release() {
	lockCount -= 1;
	if (lockCount === 0 && typeof document !== 'undefined') {
		const html = document.documentElement;
		const body = document.body;
		html.style.overflow = savedHtmlOverflow;
		html.style.paddingRight = savedHtmlPaddingRight;
		html.classList.remove('no-scrollbar');
		body.style.overflow = savedBodyOverflow;
	}
}

export function scrollLock(_node: HTMLElement, options: ScrollLockOptions = {}) {
	let held = false;

	// WHETHER THIS OVERLAY SHOULD HOLD A LOCK AT THE CURRENT VIEWPORT WIDTH.
	const shouldLock = () =>
		typeof window !== 'undefined' && (options.maxWidth == null || window.innerWidth <= options.maxWidth);

	// ACQUIRE / RELEASE TO MATCH shouldLock(), RE-EVALUATED ON RESIZE (E.G. ROTATING PAST THE BREAKPOINT).
	function sync() {
		const want = shouldLock();
		if (want && !held) {
			acquire();
			held = true;
		} else if (!want && held) {
			release();
			held = false;
		}
	}

	sync();
	if (typeof window !== 'undefined') window.addEventListener('resize', sync);

	return {
		update(next: ScrollLockOptions = {}) {
			options = next;
			sync();
		},
		destroy() {
			if (typeof window !== 'undefined') window.removeEventListener('resize', sync);
			if (held) release();
		},
	};
}
