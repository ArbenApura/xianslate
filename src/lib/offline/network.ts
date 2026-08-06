// OFFLINE NETWORK-AWARENESS — THE SINGLE SOURCE OF TRUTH FOR "AM I ONLINE?".
//
// WHY A STORE + EVENT LISTENERS INSTEAD OF bare navigator.onLine: THE ANDROID WEBVIEW'S onLine FLAG IS
// NOTORIOUSLY UNRELIABLE (IT CAN STAY true AFTER THE RADIO DROPS, OR FLAP WHILE THE VPN/APN RECONFIGURES),
// SO EVERY FAILED /api FETCH IS THE AUTHORITATIVE "WE ARE OFFLINE" SIGNAL (see apiFetch in $lib/api).
// THE BROWSER EVENTS ARE THE POSITIVE SIGNAL — THE SPA RETRIES SYNC WHEN THEY FIRE.

import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';

// -- STORE -- //

// TRUE = THE NETWORK IS (BELIEVED) UP. SEEDED FROM navigator.onLine WHEN AVAILABLE; OPTIMISTICALLY TRUE
// ON SSR/UNKNOWN SO NON-BROWSER CODE NEVER FALSE-POSITIVES INTO "OFFLINE" MODE.
export const online = writable<boolean>(!browser || typeof navigator === 'undefined' ? true : navigator.onLine);

// LAST TIME THE STORE FLIPPED FROM FALSE → TRUE (ms epoch, 0 IF NEVER SEEN ONLINE) — THE SYNC ENGINE USES
// THIS TO AVOID FLUSHING THE OUTBOX IN A LOOP WHILE THE DEVICE IS STILL UNREACHABLE.
export const lastOnlineAt = writable<number>(0);

// -- STATE -- //

let listening = false;

// -- FUNCTIONS -- //

// REGISTER THE BROWSER online/offline LISTENERS (IDEMPOTENT — CALL ONCE FROM THE ROOT LAYOUT onMount).
export function initNetworkListeners(): void {
	if (!browser || listening) return;
	listening = true;
	const setOn = () => {
		online.set(true);
		lastOnlineAt.set(Date.now());
	};
	const setOff = () => online.set(false);
	window.addEventListener('online', setOn);
	window.addEventListener('offline', setOff);
	// SEED AGAIN IN CASE THE FLAG CHANGED BETWEEN MODULE LOAD AND LAYOUT MOUNT.
	online.set(navigator.onLine);
}

// THE FETCH-FAILURE FALLBACK: CALLED BY apiFetch WHEN A REQUEST THROWS A NETWORK-TYPE ERROR. THE WEBVIEW
// onLine FLAG MAY STILL SAY true — THIS IS THE TRUTH.
export function markOffline(): void {
	if (browser) online.set(false);
}

// CALLED BY apiFetch WHEN A REQUEST COMES BACK AT ALL (EVEN AN HTTP ERROR BODY MEANS THE NETWORK IS UP).
export function markOnline(): void {
	if (browser) {
		online.set(true);
		lastOnlineAt.set(Date.now());
	}
}

// SYNC READER FOR NON-REACTIVE CODE (GUARDS, QUEUES).
export function isOnline(): boolean {
	return get(online);
}
