// RESOLVE-COVER TESTS — THE PURE DECISION LOGIC BEHIND OfflineCover.svelte (src/lib/offline/covers.ts).
//
// THE KEY REGRESSION TEST IS THE FIRST BLOB CASE: "A CACHED COVER MUST NOT TOUCH THE NETWORK". THE OLD
// COMPONENT MOUNTED <img src={REMOTE_URL}> BEFORE THE ASYNC CACHE LOOKUP, SO EVERY PAGE VISIT FIRED A
// NETWORK REQUEST EVEN WHEN THE BLOB WAS CACHED (THE "COVER RELOADS ON EVERY PAGE" BUG) — AND OFFLINE,
// THE REMOTE URL'S on:error COULD HIDE THE <img> BEFORE THE LOOKUP FINISHED (CACHED COVERS NEVER SHOWED).
import { describe, expect, it } from 'vitest';
import { resolveCoverSrc, type CoverDeps } from '$lib/offline/covers';

function makeDeps(overrides: Partial<CoverDeps> = {}): CoverDeps {
	return {
		get: async () => null,
		put: () => {},
		fetchImage: async () => null,
		isOnline: () => true,
		...overrides,
	};
}

describe('resolveCoverSrc', () => {
	it('passes data: and blob: URIs straight through with no cache/network access', async () => {
		let got = 0;
		let fetched = 0;
		const d = makeDeps({
			get: async () => {
				got++;
				return null;
			},
			fetchImage: async () => {
				fetched++;
				return null;
			},
		});
		expect(await resolveCoverSrc('data:image/png;base64,AAA', d)).toEqual({
			kind: 'passthrough',
			src: 'data:image/png;base64,AAA',
		});
		expect(await resolveCoverSrc('blob:https://localhost/uuid', d)).toEqual({
			kind: 'passthrough',
			src: 'blob:https://localhost/uuid',
		});
		expect(got).toBe(0);
		expect(fetched).toBe(0);
	});

	it('serves a cached blob WITHOUT hitting the network (the reload-on-every-page regression)', async () => {
		const blob = new Blob(['cover']);
		let fetched = 0;
		let put = 0;
		const d = makeDeps({
			get: async () => blob,
			fetchImage: async () => {
				fetched++;
				return null;
			},
			put: async () => {
				put++;
			},
		});
		const r = await resolveCoverSrc('https://cdn.example/cover.jpg', d);
		expect(r.kind).toBe('blob');
		if (r.kind === 'blob') expect(r.blob).toBe(blob);
		expect(fetched).toBe(0); // THE CORE FIX: NO NETWORK REQUEST WHEN CACHED
		expect(put).toBe(0);
	});

	it('downloads + caches an uncached cover when online', async () => {
		const blob = new Blob(['fresh']);
		const seen: { url: string; blob: Blob }[] = [];
		const d = makeDeps({
			get: async () => null,
			fetchImage: async () => blob,
			put: async (url, b) => {
				seen.push({ url, blob: b });
			},
		});
		const r = await resolveCoverSrc('https://cdn.example/cover.jpg', d);
		expect(r.kind).toBe('blob');
		expect(seen).toEqual([{ url: 'https://cdn.example/cover.jpg', blob }]);
	});

	it('falls back to the raw URL when offline and uncached', async () => {
		const d = makeDeps({
			get: async () => null,
			isOnline: () => false,
			fetchImage: async () => {
				throw new Error('must not run');
			},
		});
		expect(await resolveCoverSrc('https://cdn.example/cover.jpg', d)).toEqual({
			kind: 'raw',
			src: 'https://cdn.example/cover.jpg',
		});
	});

	it('falls back to the raw URL when online but the fetch fails (CORS / 404)', async () => {
		const d1 = makeDeps({ get: async () => null, fetchImage: async () => null });
		expect(await resolveCoverSrc('https://cdn.example/cover.jpg', d1)).toEqual({
			kind: 'raw',
			src: 'https://cdn.example/cover.jpg',
		});
		const d2 = makeDeps({
			get: async () => null,
			fetchImage: async () => {
				throw new TypeError('Failed to fetch');
			},
		});
		expect((await resolveCoverSrc('https://cdn.example/cover.jpg', d2)).kind).toBe('raw');
	});
});
