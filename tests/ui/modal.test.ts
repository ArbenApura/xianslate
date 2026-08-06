// MODAL COMPONENT TESTS — ACCESSIBLE NAME (THE a11y FIX) + ESCAPE-TO-CLOSE.
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte';
import Modal from '$lib/components/ui/Modal.svelte';

// GLOBALS ARE OFF IN THIS REPO — TESTING-LIBRARY'S AUTO-CLEANUP NEEDS AN EXPLICIT afterEach.
afterEach(cleanup);

// RIPPLE/SCROLL-LOCK ACTIONS TOUCH DOM APIs jsdom DOESN'T HAVE — THEY ARE AUGMENTATION, NOT BEHAVIOR.
vi.mock('$lib/actions/ripple', () => ({ ripple: () => ({ destroy() {} }) }));
vi.mock('$lib/actions/scrollLock', () => ({ scrollLock: () => ({ destroy() {} }) }));
vi.mock('$lib/actions/focusTrap', () => ({ focusTrap: () => ({ destroy() {} }) }));

describe('Modal', () => {
	it('exposes the title as the dialog accessible name (aria-labelledby)', () => {
		render(Modal, { open: true, title: 'Chapter settings' });
		// getByRole WITH A NAME FAILS IF THE DIALOG HAS NO ACCESSIBLE NAME — THE REGRESSION TEST FOR THE FIX.
		expect(screen.getByRole('dialog', { name: 'Chapter settings' })).toBeTruthy();
	});

	it('does not render at all when closed', () => {
		render(Modal, { open: false, title: 'Hidden' });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('dispatches close on Escape', async () => {
		const { component } = render(Modal, { open: true, title: 'T' });
		let closed = 0;
		component.$on('close', () => closed++);
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(closed).toBe(1);
	});

	it('dispatches close when the backdrop is clicked', async () => {
		const { component } = render(Modal, { open: true, title: 'T' });
		let closed = 0;
		component.$on('close', () => closed++);
		const backdrop = screen.getByLabelText('Close dialog');
		await fireEvent.click(backdrop);
		expect(closed).toBe(1);
	});

	it('renders the title text and the close button', () => {
		render(Modal, { open: true, title: 'Settings' });
		expect(screen.getByText('Settings')).toBeTruthy();
		expect(screen.getByLabelText('Close')).toBeTruthy();
	});
});
