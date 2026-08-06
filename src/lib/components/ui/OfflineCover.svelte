<script lang="ts">
	// OFFLINE-SAFE COVER IMAGE — RENDERS A BOOK COVER FROM THE BLOB CACHE WHEN OFFLINE.
	//
	// WHY: covers.coverUrl IS AN EXTERNAL URL (SCRAPED) OR A data: URI. THE LIBRARY/READER <img> LOADS THE
	// URL DIRECTLY, WHICH OFFLINE MEANS A BROKEN IMAGE (HIDDEN BY hideImg). THIS COMPONENT:
	//   1. data:/blob: URLs PASS THROUGH UNCHANGED (NO CACHING NEEDED).
	//   2. REMOTE URLs ARE DOWNLOADED ONCE (WHEN ONLINE), STORED AS BLOBS IN IndexedDB, AND RENDERED FROM
	//      AN OBJECT URL — SO THE COVER SHOWS OFFLINE TOO.
	//   3. A COVER THAT IS NEITHER CACHED NOR FETCHABLE HIDES ITSELF (THE GRADIENT PLACEHOLDER SHOWS
	//      THROUGH, EXACTLY LIKE THE OLD hideImg BEHAVIOUR).
	// ALL ATTRIBUTES (class, loading, decoding, alt, …) ARE FORWARDED TO THE <img>.

	import { onDestroy, onMount } from 'svelte';
	import { coverGet, coverPut } from '$lib/offline/db';
	import { isOnline } from '$lib/offline/network';

	// -- REQUIRED PROPS -- //

	export let src: string;

	// -- OPTIONAL PROPS -- //

	export let alt = '';

	// -- STATES -- //

	let resolved = src;
	let objUrl: string | null = null;
	let hidden = false;
	let mounted = false;
	let lastSrc = src;

	// -- FUNCTIONS -- //

	async function resolve() {
		// data: URIs (USER-UPLOADED COVERS) AND ALREADY-RESOLVED BLOB URLs RENDER DIRECTLY.
		if (src.startsWith('data:') || src.startsWith('blob:')) {
			resolved = src;
			return;
		}
		// CACHED BLOB → OBJECT URL (FAST + WORKS OFFLINE).
		const cached = await coverGet(src);
		if (cached?.blob) {
			if (objUrl) URL.revokeObjectURL(objUrl);
			objUrl = URL.createObjectURL(cached.blob);
			resolved = objUrl;
			return;
		}
		// NOT CACHED: ONLINE → DOWNLOAD + CACHE IT FOR NEXT TIME; OFFLINE → FALL BACK TO THE RAW URL
		// (THE BROWSER WILL FAIL IT AND WE HIDE, AS BEFORE).
		if (isOnline()) {
			try {
				const res = await fetch(src, { mode: 'cors' });
				if (res.ok) {
					const blob = await res.blob();
					void coverPut(src, blob);
					if (objUrl) URL.revokeObjectURL(objUrl);
					objUrl = URL.createObjectURL(blob);
					resolved = objUrl;
					return;
				}
			} catch {
				// CORS / NETWORK — FALL THROUGH TO THE RAW URL.
			}
		}
		resolved = src;
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
		resolved = src;
		hidden = false;
		resolve();
	}
</script>

{#if !hidden}
	<img src={resolved} {alt} {...$$restProps} on:error={() => (hidden = true)} />
{/if}
