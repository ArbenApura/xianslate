// SSE STREAMING TRANSPORT FOR THE TRANSLATE / EXTRACT PIPELINE.
//
// TRANSPORT SELECTION HAPPENS UP FRONT — THE REQUEST IS SENT EXACTLY ONCE (A LATE FALLBACK WOULD
// DOUBLE-POST: THE SERVER WOULD RUN THE JOB TWICE, DOUBLE-BILLING EXTRACTION):
//   - iOS WKWebView → XMLHttpRequest PROGRESS STREAMING (ITS fetch() DOES NOT DELIVER STREAMING BODIES).
//   - EVERYWHERE ELSE (WEB + ANDROID WebView / CHROMIUM) → fetch() ReadableStream, ABORTABLE, INCREMENTAL.
//
// THE CONSUMER RETURNS 'stop' TO END THE STREAM EARLY (E.G. THE EXTRACT 'done' EVENT OR A SUPERSEDED
// RUN); A THROW FROM THE CONSUMER REJECTS streamSse (E.G. AN SSE `error` EVENT) AND RELEASES THE
// CONNECTION.

// IMPORTED DEP-MODULES
import { Capacitor } from '@capacitor/core';
import { browser } from '$app/environment';
// IMPORTED MODULES
import { apiUrl, authHeaders } from '$lib/api';

// -- TYPES -- //

// DELIBERATELY LOOSE BEYOND `type` — CONSUMERS READ ARBITRARY EVENT FIELDS (text / paragraphs / done / …)
// EXACTLY LIKE THE OLD UNTYPED `JSON.parse(line)`, SO ACCESS STAYS ERGONOMIC. type IS THE ONE FIELD EVERY
// EVENT CARRIES AND THE SWITCH KEY.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SseEvent = { type: string } & Record<string, any>;

export type SseHandler = (event: SseEvent) => 'stop' | void;

// -- FUNCTIONS -- //

function useXhrTransport(): boolean {
	// iOS WKWebView ONLY — CHROMIUM (WEB + ANDROID) STREAMS FINE THROUGH fetch.
	return browser && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

// SPLIT A RUNNING BUFFER INTO COMPLETE SSE BLOCKS ("\n\n"-SEPARATED) AND DISPATCH THE JSON OF EVERY
// "data:" LINE TO onEvent. RETURNS THE REMAINING PARTIAL BUFFER. HEARTBEAT COMMENT BLOCKS (": ping") AND
// MALFORMED EVENTS ARE SKIPPED WITHOUT STOPPING THE STREAM.
function consumeBlocks(buf: string, onEvent: SseHandler, stopped: { v: boolean }): string {
	const blocks = buf.split('\n\n');
	const rest = blocks.pop() ?? '';
	for (const block of blocks) {
		const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
		if (!dataLine) continue;
		const line = dataLine.slice(5).trim();
		if (!line) continue;
		let msg: SseEvent;
		try {
			msg = JSON.parse(line);
		} catch {
			continue;
		}
		if (onEvent(msg) === 'stop') {
			stopped.v = true;
			break;
		}
	}
	return rest;
}

// THE iOS WKWebView TRANSPORT: POST AND DISPATCH EVENTS FROM ONPROGRESS AS CHUNKS ARRIVE. A CONSUMER THROW
// (AN SSE `error` EVENT) OR A NON-2xx RESPONSE REJECTS; ABORT (SIGNAL OR CONSUMER 'stop') RESOLVES QUIETLY
// — THE CONSUMER DECIDES WHAT AN EARLY END MEANS.
function readSseViaXhr(
	url: string,
	headers: Record<string, string>,
	payload: string,
	onEvent: SseHandler,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url);
		for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
		xhr.responseType = 'text';

		let buf = '';
		const stopped = { v: false };
		let done = false;
		let settled = false;
		const cleanup = () => signal?.removeEventListener('abort', onAbort);

		// DISPATCH THE PENDING BUFFER, PROPAGATING CONSUMER ERRORS OUT OF THE PROMISE.
		const dispatch = (full: string) => {
			try {
				buf = consumeBlocks(buf + full.slice(buf.length), onEvent, stopped);
			} catch (err) {
				settled = true;
				cleanup();
				done = true;
				xhr.abort();
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		};

		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			done = true;
			xhr.abort();
			resolve();
		};

		xhr.onprogress = () => {
			if (done || stopped.v) return;
			dispatch(xhr.responseText);
			if (stopped.v) xhr.abort();
		};
		xhr.onload = () => {
			if (settled) return;
			if (xhr.status >= 400) {
				// A PRE-STREAM FAILURE (e.g. AN OWNERSHIP 404) IS A NORMAL RESPONSE, NOT SSE.
				settled = true;
				cleanup();
				done = true;
				let message = `Request failed (${xhr.status}).`;
				try {
					const data = JSON.parse(xhr.responseText || '{}');
					if (typeof data?.message === 'string') message = data.message;
				} catch {
					/* NOT JSON — KEEP THE DEFAULT */
				}
				reject(new Error(message));
				return;
			}
			settled = true;
			cleanup();
			done = true;
			if (!stopped.v) dispatch(xhr.responseText); // FINAL FLUSH — ANY COMPLETE BLOCKS AFTER THE LAST PROGRESS EVENT
			resolve();
		};
		xhr.onerror = () => {
			if (settled) return;
			settled = true;
			cleanup();
			done = true;
			reject(new Error('Network error during stream.'));
		};
		xhr.onabort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			done = true;
			resolve();
		};

		signal?.addEventListener('abort', onAbort);
		xhr.send(payload);
	});
}

// POST `path` WITH A JSON BODY AND DISPATCH EACH SSE EVENT TO onEvent UNTIL THE STREAM ENDS, THE CONSUMER
// RETURNS 'stop', OR signal ABORTS. A NON-OK RESPONSE THROWS WITH THE SERVER'S { message }.
export async function streamSse(path: string, body: unknown, onEvent: SseHandler, signal?: AbortSignal): Promise<void> {
	const url = apiUrl(path);
	const headers = { 'content-type': 'application/json', ...(await authHeaders()) };
	const payload = JSON.stringify(body);

	// iOS WKWebView: SEND THROUGH XHR FROM THE START — NO DOUBLE POST, NO AMBIGUOUS BODY DETECTION.
	if (useXhrTransport()) {
		await readSseViaXhr(url, headers, payload, onEvent, signal);
		return;
	}

	const res = await fetch(url, { method: 'POST', headers, body: payload, signal });
	if (!res.ok) {
		const data = (await res.json().catch(() => ({}))) as { message?: string };
		throw new Error(data.message ?? `Request failed (${res.status}).`);
	}

	// DEFENSIVE: NO STREAMING BODY (SHOULD NOT HAPPEN OUTSIDE iOS) — THE SERVER JOB STILL COMPLETES
	// DETACHED; NEVER RE-POST (THAT WOULD DOUBLE-BILL).
	const streamable = res.body && typeof (res.body as { getReader?: unknown }).getReader === 'function';
	if (!streamable) return;

	const reader = (res.body as ReadableStream<Uint8Array>).getReader();
	const decoder = new TextDecoder();
	const stopped = { v: false };
	let buf = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buf += decoder.decode(value, { stream: true });
		buf = consumeBlocks(buf, onEvent, stopped);
		if (stopped.v) {
			// CONSUMER WANTS THE STREAM ENDED EARLY — CANCEL THE READER AND RELEASE THE CONNECTION.
			try {
				await reader.cancel();
			} catch {
				/* IGNORE */
			}
			return;
		}
	}
}
