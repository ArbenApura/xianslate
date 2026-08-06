// OFFLINE COVER-RESOLUTION LOGIC — THE PURE DECISION HALF OF OfflineCover.svelte, EXTRACTED SO THE
// "CACHED COVER MUST NOT HIT THE NETWORK" PROPERTY IS UNIT-TESTABLE WITHOUT jsdom/IndexedDB (THE IO-BOUND
// HALF — coverGet/coverPut/fetch — LIVES IN THE COMPONENT, MIRRORING THE outbox-core/outbox SPLIT).
//
// THE BUG THIS FIXES: THE OLD COMPONENT MOUNTED <img src={REMOTE_URL}> IMMEDIATELY AND ONLY THEN DID THE
// ASYNC IndexedDB LOOKUP — SO EVERY PAGE VISIT FIRED A NETWORK REQUEST FOR THE COVER EVEN WHEN A CACHED
// BLOB EXISTED (THE "COVER RELOADS ON EVERY PAGE" SYMPTOM), AND OFFLINE THE REMOTE URL'S on:error COULD
// HIDE THE <img> BEFORE THE CACHE LOOKUP FINISHED (CACHED COVERS NEVER SHOWED). THE COMPONENT NOW GATES
// RENDERING ON THIS RESOLUTION: A CACHED COVER RENDERS DIRECTLY FROM THE BLOB — ZERO NETWORK — AND CANNOT
// BE PRE-EMPTED BY A FAILED REMOTE LOAD.

export type CoverResolution =
	// data:/blob: — RENDER AS-IS, NEVER CACHE, NEVER TOUCH THE NETWORK.
	| { kind: 'passthrough'; src: string }
	// CACHED OR FRESHLY DOWNLOADED — THE COMPONENT RENDERS IT VIA AN OBJECT URL.
	| { kind: 'blob'; blob: Blob; url: string }
	// NOTHING USABLE — RENDER THE RAW URL (IT WILL ERROR + HIDE OFFLINE, LOAD AS-IS ONLINE).
	| { kind: 'raw'; src: string };

export type CoverDeps = {
	get: (url: string) => Promise<Blob | null>;
	put: (url: string, blob: Blob) => Promise<void> | void;
	fetchImage: (url: string) => Promise<Blob | null>;
	isOnline: () => boolean;
};

export async function resolveCoverSrc(src: string, deps: CoverDeps): Promise<CoverResolution> {
	// data: URIs (USER-UPLOADED COVERS) AND ALREADY-RESOLVED BLOB URLs RENDER DIRECTLY — NO IndexedDB
	// LOOKUP, NO NETWORK.
	if (src.startsWith('data:') || src.startsWith('blob:')) return { kind: 'passthrough', src };
	// CACHED BLOB → RETURN IT WITHOUT TOUCHING THE NETWORK (THE CORE FIX — SEE HEADER).
	const cached = await deps.get(src);
	if (cached) return { kind: 'blob', blob: cached, url: src };
	// NOT CACHED: ONLINE → DOWNLOAD + CACHE IT FOR NEXT TIME; OFFLINE → FALL THROUGH TO THE RAW URL
	// (THE BROWSER WILL FAIL IT AND THE COMPONENT HIDES, AS BEFORE).
	if (deps.isOnline()) {
		try {
			const blob = await deps.fetchImage(src);
			if (blob) {
				void deps.put(src, blob);
				return { kind: 'blob', blob, url: src };
			}
		} catch {
			// CORS / NETWORK — FALL THROUGH TO THE RAW URL.
		}
	}
	return { kind: 'raw', src };
}
