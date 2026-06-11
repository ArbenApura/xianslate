// FOCUS-TRAP ACTION FOR MODAL DIALOGS / DRAWERS.
// `aria-modal="true"` alone does NOT stop keyboard focus from walking into the page behind an overlay.
// This action: (1) moves focus into the dialog on open, (2) cycles Tab/Shift+Tab within it, and
// (3) restores focus to whatever was focused before, on close. Use with a container that has
// `tabindex="-1"` so it can hold focus when it contains no focusable children.

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusTrap(node: HTMLElement) {
	const previouslyFocused = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;

	const focusables = (): HTMLElement[] =>
		Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			(el) => el.offsetParent !== null || el === document.activeElement,
		);

	// MOVE FOCUS INTO THE DIALOG (FIRST FOCUSABLE, ELSE THE CONTAINER ITSELF).
	queueMicrotask(() => {
		const first = focusables()[0];
		(first ?? node).focus();
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const items = focusables();
		if (items.length === 0) {
			e.preventDefault();
			node.focus();
			return;
		}
		const idx = items.indexOf(document.activeElement as HTMLElement);
		if (e.shiftKey) {
			if (idx <= 0) {
				e.preventDefault();
				items[items.length - 1].focus();
			}
		} else if (idx === items.length - 1 || idx === -1) {
			e.preventDefault();
			items[0].focus();
		}
	}

	node.addEventListener('keydown', onKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			// RESTORE FOCUS TO THE OPENER SO KEYBOARD USERS AREN'T STRANDED.
			previouslyFocused?.focus?.();
		},
	};
}
