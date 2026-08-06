// TOC DRAWER TESTS — ESCAPE CLOSES (THE UX FINDING) + THE DIALOG IS NAMED "TABLE OF CONTENTS".
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte';
import TocDrawer from '$lib/components/TocDrawer.svelte';

// GLOBALS ARE OFF IN THIS REPO — TESTING-LIBRARY'S AUTO-CLEANUP NEEDS AN EXPLICIT afterEach.
afterEach(cleanup);

// CHAPTERLIST PULLS IN apiFetch + IndexedDB — REPLACE ITS DEPS SO THE DRAWER RENDERS STANDALONE.
vi.mock('$lib/api', () => ({
	apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ book: {}, chapters: [] }) }),
}));
vi.mock('$lib/offline/chapters', () => ({
	readCachedToc: vi.fn().mockResolvedValue(null),
	cacheToc: vi.fn(),
	prefetchUntranslatedSources: vi.fn(),
}));
vi.mock('$lib/stores/auth', () => ({
	currentUser: { subscribe: () => () => {} },
}));
vi.mock('$lib/actions/ripple', () => ({ ripple: () => ({ destroy() {} }) }));
vi.mock('$lib/actions/scrollLock', () => ({ scrollLock: () => ({ destroy() {} }) }));
vi.mock('$lib/actions/focusTrap', () => ({ focusTrap: () => ({ destroy() {} }) }));

describe('TocDrawer', () => {
	it('renders a named "Table of contents" dialog when open', () => {
		render(TocDrawer, { open: true, bookId: 'b1' });
		expect(screen.getByRole('dialog', { name: 'Table of contents' })).toBeTruthy();
	});

	it('renders nothing when closed', () => {
		render(TocDrawer, { open: false, bookId: 'b1' });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('dispatches close on Escape over the backdrop (the UX finding)', async () => {
		const { component } = render(TocDrawer, { open: true, bookId: 'b1' });
		let closed = 0;
		component.$on('close', () => closed++);
		await fireEvent.keyDown(screen.getByLabelText('Close contents'), { key: 'Escape' });
		expect(closed).toBe(1);
	});

	it('dispatches close when the backdrop is clicked', async () => {
		const { component } = render(TocDrawer, { open: true, bookId: 'b1' });
		let closed = 0;
		component.$on('close', () => closed++);
		await fireEvent.click(screen.getByLabelText('Close contents'));
		expect(closed).toBe(1);
	});

	it('exposes a close button inside the drawer', () => {
		render(TocDrawer, { open: true, bookId: 'b1' });
		expect(screen.getByLabelText('Close')).toBeTruthy();
	});
});
