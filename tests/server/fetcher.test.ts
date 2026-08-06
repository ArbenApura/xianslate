// SSRF-GUARD TESTS — THE PRIVATE-ADDRESS MATRIX AND THE RESOLVE-AND-REJECT CORE OF fetcher.ts.
//
// THESE PIN THE GUARD THAT STOPS USER-SUPPLIED CHAPTER URLS FROM STEERING THE SERVER AT INTERNAL
// SERVICES / CLOUD METADATA (169.254.169.254), ACROSS IPv4, IPv6, AND IPv4-MAPPED-IPv6 FORMS.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPrivateIp } from '$lib/server/fetcher';

// -- isPrivateIp: PURE ADDRESS MATRIX (THE REAL MODULE IS FINE — NO DNS CALLS HAPPEN) -- //

describe('isPrivateIp — the address matrix', () => {
	it('flags IPv4 loopback/private/link-local ranges', () => {
		expect(isPrivateIp('127.0.0.1')).toBe(true);
		expect(isPrivateIp('10.0.0.1')).toBe(true);
		expect(isPrivateIp('172.16.0.1')).toBe(true);
		expect(isPrivateIp('172.31.255.255')).toBe(true);
		expect(isPrivateIp('192.168.1.1')).toBe(true);
		expect(isPrivateIp('169.254.169.254')).toBe(true); // AWS/GCP METADATA
		expect(isPrivateIp('0.0.0.0')).toBe(true);
		expect(isPrivateIp('255.255.255.255')).toBe(true); // BROADCAST
		expect(isPrivateIp('224.0.0.1')).toBe(true); // MULTICAST
		expect(isPrivateIp('240.0.0.1')).toBe(true); // RESERVED
	});

	it('flags IPv6 loopback, ULA, link-local and IPv4-mapped forms', () => {
		expect(isPrivateIp('::1')).toBe(true);
		expect(isPrivateIp('::')).toBe(true);
		expect(isPrivateIp('fc00::1')).toBe(true);
		expect(isPrivateIp('fd12:3456::1')).toBe(true);
		expect(isPrivateIp('fe80::1')).toBe(true);
		// IPv4-MAPPED IPv6 (::ffff:10.0.0.1) MUST BE CAUGHT AS 10.0.0.1
		expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
		expect(isPrivateIp('::ffff:192.168.0.5')).toBe(true);
	});

	it('allows public addresses', () => {
		for (const ip of ['8.8.8.8', '1.1.1.1', '104.20.23.154', '2606:4700::6814:179a']) {
			expect(isPrivateIp(ip)).toBe(false);
		}
	});
});

// -- assertPublicUrl: RESOLVE-AND-REJECT (DNS MOCKED) -- //
//
// NOTE ON THE MOCK PATTERN: ROUTING THE MOCK THROUGH A vi.fn() MAKES VITEST 4 FAIL THE TEST WHENEVER THE
// MOCKED lookup REJECTS (ITS SPY RESULT-TRACKING SURFACES THE MOCK'S REJECTED PROMISE AS THE TEST'S OWN
// FAILURE — REPRODUCED: A PRIOR RESOLVED CALL POISONS THE NEXT REJECTED ONE). PLAIN CLOSURES RETURNING REAL
// PROMISES (STATE TOGGLED PER TEST) AVOID THE TRACKING ENTIRELY AND ARE RELIABLE.

describe('assertPublicUrl — resolve, reject, pin', () => {
	let resolveTo: { address: string; family: number }[];
	let rejectWith: Error | null;
	let lookupCalls: unknown[][];
	let assertPublicUrl: (raw: string) => Promise<{ url: URL; address: string; family: number }>;

	beforeAll(async () => {
		resolveTo = [];
		rejectWith = null;
		lookupCalls = [];
		vi.doMock('node:dns/promises', () => ({
			lookup: (host: string, opts: unknown) => {
				lookupCalls.push([host, opts]);
				if (rejectWith) return Promise.reject(rejectWith);
				return Promise.resolve(resolveTo);
			},
		}));
		vi.resetModules();
		({ assertPublicUrl } = await import('$lib/server/fetcher'));
	});

	beforeEach(() => {
		resolveTo = [];
		rejectWith = null;
		lookupCalls = [];
	});

	it('rejects a malformed URL and a non-http(s) scheme before resolving', async () => {
		await expect(assertPublicUrl('not a url')).rejects.toMatchObject({ kind: 'invalid_url' });
		await expect(assertPublicUrl('file:///etc/passwd')).rejects.toMatchObject({ kind: 'invalid_url' });
		expect(lookupCalls).toHaveLength(0);
	});

	it('rejects when ANY resolved address is private (DNS-rebinding defence)', async () => {
		resolveTo = [
			{ address: '8.8.8.8', family: 4 },
			{ address: '169.254.169.254', family: 4 },
		];
		await expect(assertPublicUrl('https://evil.example/1.html')).rejects.toMatchObject({ kind: 'blocked_private' });
	});

	it('rejects an unresolvable host with a typed error', async () => {
		rejectWith = new Error('ENOTFOUND');
		await expect(assertPublicUrl('https://nonexistent.invalid/x')).rejects.toMatchObject({ kind: 'unresolvable' });
	});

	it('returns the validated URL + the first public address to pin', async () => {
		resolveTo = [
			{ address: '104.20.23.154', family: 4 },
			{ address: '2606:4700::6814:179a', family: 6 },
		];
		const pin = await assertPublicUrl('https://example.com/ch/1.html');
		expect(pin.url.href).toBe('https://example.com/ch/1.html');
		expect(pin.address).toBe('104.20.23.154');
		expect(pin.family).toBe(4);
	});

	it('resolves an IPv6-only host fine (public v6 is allowed)', async () => {
		resolveTo = [{ address: '2606:4700::6814:179a', family: 6 }];
		const pin = await assertPublicUrl('https://v6.example/x');
		expect(pin.address).toBe('2606:4700::6814:179a');
	});
});
