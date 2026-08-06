<script lang="ts">
	// OFFLINE-SAFE COVER IMAGE — RENDERS A BOOK COVER FROM THE BLOB CACHE WHEN OFFLINE.
	//
	// WHY: covers.coverUrl IS AN EXTERNAL URL (SCRAPED) OR A data: URI. THE LIBRARY <img> LOADS THE URL
	// DIRECTLY, WHICH OFFLINE MEANS A BROKEN IMAGE (HIDDEN BY hideImg). THIS COMPONENT:
	//   1. data:/blob: URLs PASS THROUGH UNCHANGED (NO CACHING NEEDED).
	//   2. REMOTE URLs ARE DOWNLOADED ONCE (WHEN ONLINE), STORED AS BLOBS IN IndexedDB, AND RENDERED FROM
	//      AN OBJECT URL — SO THE COVER SHOWS OFFLINE TOO.
	//   3. A COVER THAT IS NEITHER CACHED NOR FETCHABLE HIDES ITSELF (THE GRADIENT PLACEHOLDER SHOWS
	//      THROUGH, EXACTLY LIKE THE OLD hideImg BEHAVIOUR).
	//
	// WHY THE <img> IS GATED ON RESOLUTION (THE "COVER RELOADS EVERY PAGE" FIX): MOUNTING WITH THE RAW
	// REMOTE URL FIRST AND SWAPPING TO THE BLOB AFTER THE ASYNC CACHE LOOKUP MEANT EVERY PAGE VISIT FIRED
	// A NETWORK REQUEST EVEN WHEN THE BLOB WAS CACHED — AND OFFLINE, THE REMOTE URL'S on:error COULD HIDE
	// THE <img> BEFORE THE LOOKUP FINISHED (CACHED COVERS NEVER SHOWED). THE DECISION LOGIC LIVES IN
	// $lib/offline/covers (resolveCoverSrc — UNIT-TESTED); THIS COMPONENT ONLY RENDERS THE RESULT.
	// ALL ATTRIBUTES (class, loading, decoding, alt, …) ARE FORWARDED TO THE <img>.

	import { onDestroy, onMount } from 'svelte';
	import { coverGet, coverPut } from '$lib/offline/db';
	import { isOnline } from '$lib/offline/network';
	import { resolveCoverSrc } from '$lib/offline/covers';

	// -- REQUIRED PROPS -- //

	export let src: string;

	// -- OPTIONAL PROPS -- //

	export let alt = '';

	// -- STATES -- //

	// null = STILL RESOLVING — THE <img> IS NOT RENDERED UNTIL WE KNOW WHERE THE IMAGE COMES FROM (SEE THE
	// HEADER COMMENT). data:/blob: AND CACHED COVERS RESOLVE ON THE FIRST FRAME, WITHOUT ANY NETWORK.
	let resolved: string | null = null;
	let objUrl: string | null = null;
	let hidden = false;
	let mounted = false;
	let lastSrc = src;

	// -- FUNCTIONS -- //

	async function resolve() {
		const r = await resolveCoverSrc(src, {
			get: async (url) => (await coverGet(url))?.blob ?? null,
			put: (url, blob) => coverPut(url, blob),
			fetchImage: async (url) => {
				const res = await fetch(url, { mode: 'cors' });
				return res.ok ? await res.blob() : null;
			},
			isOnline,
		});
		if (r.kind === 'passthrough') {
			resolved = r.src;
			return;
		}
		if (r.kind === 'blob') {
			// A CACHE HIT ALWAYS UNHIDES — A PREVIOUS SRC MAY HAVE ERRORED (RAW FALLBACK → on:error).
			hidden = false;
			if (objUrl) URL.revokeObjectURL(objUrl);
			objUrl = URL.createObjectURL(r.blob);
			resolved = objUrl;
			return;
		}
		// RAW FALLBACK: THE BROWSER WILL FAIL IT AND WE HIDE (OFFLINE / DEAD REMOTE), OR LOAD IT (ONLINE).
		resolved = r.src;
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		mounted = true;
		resolve();
	});
	onDestroy(() => {
		if (objUrl) URL.revokeObjectURL(objUrl);
	});

	// RE-RESOLVE WHEN THE COVER URL CHANGES (Svelte REUSES THE INSTANCE INSIDE {#each}).
	$: if (mounted && src !== lastSrc) {
		lastSrc = src;
		// BLANK THE <img> WHILE THE NEW COVER RESOLVES — THE OLD BLOB IS REVOKED NOW AND MUST NOT FLASH.
		if (objUrl) {
			URL.revokeObjectURL(objUrl);
			objUrl = null;
		}
		resolved = null;
		hidden = false;
		resolve();
	}
</script>

{#if !hidden && resolved}
	<img src={resolved} {alt} {...$$restProps} on:error={() => (hidden = true)} />
{/if}
