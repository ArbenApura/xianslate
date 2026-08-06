// OFFLINE-GATE TESTS — requireOnline + THE BANNER STORE (TOAST MOCKED, ONLINE STORE DRIVEN DIRECTLY).
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = { error: vi.fn() };
vi.mock('svelte-sonner', () => ({ toast: toastMock }));

const { offlineBanner, requireOnline } = await import('$lib/offline/gate');
const { online } = await import('$lib/offline/network');
const { get } = await import('svelte/store');

describe('offline gate', () => {
	beforeEach(() => toastMock.error.mockReset());

	it('requireOnline allows the action when online', () => {
		online.set(true);
		expect(requireOnline('Translation')).toBe(true);
		expect(toastMock.error).not.toHaveBeenCalled();
	});

	it('requireOnline blocks with a feature-named toast when offline', () => {
		online.set(false);
		expect(requireOnline('Translation')).toBe(false);
		expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('Translation'));
		expect(toastMock.error.mock.calls[0][0]).toContain('offline');
	});

	it('offlineBanner mirrors the inverse of the online store', () => {
		online.set(true);
		expect(get(offlineBanner)).toBe(false);
		online.set(false);
		expect(get(offlineBanner)).toBe(true);
	});
});
