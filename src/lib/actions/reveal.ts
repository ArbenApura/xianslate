// IMPORTED DEP-TYPES
import type { Action } from 'svelte/action';

// SCROLL-REVEAL: FADE + RISE AN ELEMENT THE FIRST TIME IT ENTERS THE VIEWPORT. THE ELEMENT KEEPS ITS OWN
// transition-* CLASSES IN MARKUP; THIS ACTION ONLY TOGGLES THE START STATE (opacity-0 / translate-y-4) AND
// REMOVES IT ON INTERSECTION. APPLY ONLY TO BELOW-THE-FOLD CONTENT — ABOVE-THE-FOLD STAYS VISIBLE SO A
// SCRIPT HICCUP CAN NEVER HIDE THE HERO. NO-OP (CONTENT SHOWN IMMEDIATELY) WHEN THE USER PREFERS REDUCED
// MOTION OR IntersectionObserver IS UNAVAILABLE / DURING SSR.
export const reveal: Action<HTMLElement, { delay?: number } | undefined> = (node, opts) => {
	if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

	// RUNTIME-DYNAMIC PER-ELEMENT STAGGER (CAN'T BE A STATIC TAILWIND CLASS) — SET DIRECTLY ON THE NODE.
	if (opts?.delay) node.style.transitionDelay = `${opts.delay}ms`;
	node.classList.add('opacity-0', 'translate-y-4');

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				node.classList.remove('opacity-0', 'translate-y-4');
				io.unobserve(node);
			}
		},
		{ threshold: 0.1, rootMargin: '0px 0px -8% 0px' },
	);
	io.observe(node);

	return { destroy: () => io.disconnect() };
};
