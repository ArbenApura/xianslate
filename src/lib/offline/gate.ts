// OFFLINE UX HELPERS — THE GATE FOR NETWORK-ONLY FEATURES AND THE INDICATOR STORE THE BANNER RENDERS.
//
// WHICH FEATURES ARE NETWORK-ONLY (AND THUS GATED):
//   - TRANSLATION (DeepSeek RUNS SERVER-SIDE): translate, translate-text, extract
//   - WEB FETCHING: add-by-URL, neighbour fetch, chapter refresh, cover scrape
//   - IMPORT/EXPORT: epub/txt import, book export, glossary import/export
//   - AUTH: sign-in/up, /api/auth/session
// EVERYTHING ELSE (READING CACHED CHAPTERS, TTS, PROGRESS, PIN/ARCHIVE — QUEUED) WORKS OFFLINE.

import { toast } from 'svelte-sonner';
import { get, writable } from 'svelte/store';
import { online } from '$lib/offline/network';

// -- STORE -- //

// TRUE WHILE THE APP IS OFFLINE — THE ROOT LAYOUT RENDERS THE BANNER FROM THIS.
export const offlineBanner = writable(false);
online.subscribe((up) => offlineBanner.set(!up));

// -- FUNCTIONS -- //

// GATE A NETWORK-ONLY ACTION: RETURN true WHEN ONLINE (CALLER PROCEEDS) OR false WHEN OFFLINE (WITH A
// CLEAR TOAST — THE CALLER SHOULD ABORT).
export function requireOnline(feature = 'This'): boolean {
	if (get(online)) return true;
	toast.error(`You're offline — ${feature} needs an internet connection.`);
	return false;
}
