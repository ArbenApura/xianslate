import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// READ-ALOUD PREFERENCES — persisted separately from reading settings so a TTS-defaults bump doesn't
// reset typography (and vice-versa). Voice is stored per spoken language (the app reads English or
// Chinese) so each keeps its own chosen voice.
export interface TtsSettings {
	version: number;
	rate: number; // 0.5–2.5 (1 = normal)
	pitch: number; // 0–2 (1 = normal)
	volume: number; // 0–1
	enVoiceURI: string | null; // null = auto-pick first matching voice
	zhVoiceURI: string | null;
	highlight: boolean; // tint the sentence currently being spoken
	highlightWord: boolean; // brighter tint on the exact word currently being spoken
	autoScroll: boolean; // keep the spoken line in view
}

// BUMP version WHEN DEFAULTS CHANGE — TRIGGERS A ONE-TIME ADOPT OF THE NEW DEFAULTS.
export const TTS_DEFAULTS: TtsSettings = {
	version: 1,
	rate: 1,
	pitch: 1,
	volume: 1,
	enVoiceURI: null,
	zhVoiceURI: null,
	highlight: true,
	highlightWord: true,
	autoScroll: true,
};

const KEY = 'xianslate:tts';

// MERGE SAVED VALUES FORWARD ONTO DEFAULTS (KNOWN KEYS, TYPE-CHECKED) — A TTS-DEFAULTS version BUMP MUST
// NOT WIPE THE USER'S CHOSEN VOICES / RATE / PITCH.
function mergeKnown(parsed: unknown): TtsSettings {
	const out = { ...TTS_DEFAULTS };
	if (parsed && typeof parsed === 'object') {
		for (const k of Object.keys(TTS_DEFAULTS) as (keyof TtsSettings)[]) {
			const v = (parsed as Record<string, unknown>)[k];
			// VOICE URIS ARE string | null — ALLOW null THROUGH; OTHERWISE REQUIRE A TYPE MATCH.
			if (v === null || (v !== undefined && typeof v === typeof TTS_DEFAULTS[k])) {
				(out as Record<string, unknown>)[k] = v;
			}
		}
	}
	out.version = TTS_DEFAULTS.version;
	return out;
}

function load(): TtsSettings {
	if (!browser) return { ...TTS_DEFAULTS };
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) return mergeKnown(JSON.parse(raw));
	} catch {
		// IGNORE CORRUPT STATE
	}
	return { ...TTS_DEFAULTS };
}

function create() {
	const store = writable<TtsSettings>(load());
	if (browser) {
		store.subscribe((s) => {
			try {
				localStorage.setItem(KEY, JSON.stringify(s));
			} catch {
				// IGNORE QUOTA ERRORS
			}
		});
	}
	return store;
}

export const ttsSettings = create();

export function resetTtsSettings() {
	ttsSettings.set({ ...TTS_DEFAULTS });
}

// AVAILABLE SYSTEM VOICES — populated lazily (Chrome loads them async via the voiceschanged event).
export const voices = writable<SpeechSynthesisVoice[]>([]);

// PER-VOICE WORD-TIMING SUPPORT, keyed by voiceURI. Filled in by the engine from real playback:
// true once a voice fires `boundary` events, false once a long sentence finishes without any. Voices
// not yet observed are absent (we fall back to the localService heuristic in voiceHasWordTiming).
export const wordTimingSupport = writable<Record<string, boolean>>({});

/**
 * Whether word-level highlighting can work for a voice. Network voices (localService === false) —
 * e.g. Google's remote voices — only fire start/end, so word highlighting is impossible. A confirmed
 * runtime observation always wins over the heuristic. Unknown voice → assume yes.
 */
export function voiceHasWordTiming(
	voice: SpeechSynthesisVoice | null | undefined,
	observed: Record<string, boolean>,
): boolean {
	if (!voice) return true;
	const seen = observed[voice.voiceURI];
	if (seen !== undefined) return seen;
	return voice.localService !== false;
}

let voicesInit = false;
export function ensureVoices() {
	if (!browser || voicesInit || !('speechSynthesis' in window)) return;
	voicesInit = true;
	const refresh = () => voices.set(window.speechSynthesis.getVoices() ?? []);
	refresh();
	try {
		window.speechSynthesis.addEventListener('voiceschanged', refresh);
	} catch {
		window.speechSynthesis.onvoiceschanged = refresh;
	}
}
