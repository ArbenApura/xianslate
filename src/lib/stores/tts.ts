// IMPORTED ENVS
import { browser } from '$app/environment';
// IMPORTED DEP-MODULES
import { writable } from 'svelte/store';

// -- TYPES -- //

// READ-ALOUD PREFERENCES — PERSISTED SEPARATELY FROM READING SETTINGS SO A TTS-DEFAULTS BUMP DOESN'T
// RESET TYPOGRAPHY (AND VICE-VERSA). VOICE IS STORED PER SPOKEN LANGUAGE (THE APP READS ENGLISH OR
// CHINESE) SO EACH KEEPS ITS OWN CHOSEN VOICE.
export interface TtsSettings {
	version: number;
	rate: number; // 0.5–2.5 (1 = NORMAL)
	pitch: number; // 0–2 (1 = NORMAL)
	volume: number; // 0–1
	enVoiceURI: string | null; // null = AUTO-PICK FIRST MATCHING VOICE
	zhVoiceURI: string | null;
	highlight: boolean; // TINT THE SENTENCE CURRENTLY BEING SPOKEN
	highlightWord: boolean; // BRIGHTER TINT ON THE EXACT WORD CURRENTLY BEING SPOKEN
	autoScroll: boolean; // KEEP THE SPOKEN LINE IN VIEW
}

// -- CONSTANTS -- //

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

// -- STATES -- //

let voicesInit = false;

// -- STORES -- //

export const ttsSettings = create();

// AVAILABLE SYSTEM VOICES — POPULATED LAZILY (Chrome LOADS THEM ASYNC VIA THE voiceschanged EVENT).
export const voices = writable<SpeechSynthesisVoice[]>([]);

// PER-VOICE WORD-TIMING SUPPORT, KEYED BY voiceURI. FILLED IN BY THE ENGINE FROM REAL PLAYBACK:
// true ONCE A VOICE FIRES `boundary` EVENTS, false ONCE A LONG SENTENCE FINISHES WITHOUT ANY. VOICES
// NOT YET OBSERVED ARE ABSENT (WE FALL BACK TO THE localService HEURISTIC IN voiceHasWordTiming).
export const wordTimingSupport = writable<Record<string, boolean>>({});

// -- FUNCTIONS -- //

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
				// IGNORE STORAGE ERRORS (PRIVATE MODE / QUOTA)
			}
		});
	}
	return store;
}

export function resetTtsSettings() {
	ttsSettings.set({ ...TTS_DEFAULTS });
}

// WHETHER WORD-LEVEL HIGHLIGHTING CAN WORK FOR A VOICE. NETWORK VOICES (localService === false) —
// E.G. Google'S REMOTE VOICES — ONLY FIRE start/end, SO WORD HIGHLIGHTING IS IMPOSSIBLE. A CONFIRMED
// RUNTIME OBSERVATION ALWAYS WINS OVER THE HEURISTIC. UNKNOWN VOICE → ASSUME YES.
export function voiceHasWordTiming(
	voice: SpeechSynthesisVoice | null | undefined,
	observed: Record<string, boolean>,
): boolean {
	if (!voice) return true;
	const seen = observed[voice.voiceURI];
	if (seen !== undefined) return seen;
	return voice.localService !== false;
}

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
