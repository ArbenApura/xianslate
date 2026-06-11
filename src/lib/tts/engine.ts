// TTS ENGINE
// A singleton controller around the Web Speech API. It speaks ONE SENTENCE PER UTTERANCE and advances
// in onend — this is what makes the highlight track precisely (boundary char offsets stay short and
// reliable) and sidesteps Chrome's ~15s silent cutoff on long utterances.
//
// It exposes a single readable `state` store that the reader subscribes to for highlighting:
//   paraIndex / sentIndex          — where we are in the loaded paragraph list
//   sentStart / sentEnd            — plain-text char range of the spoken sentence (within its paragraph)
//   wordStart / wordEnd            — plain-text char range of the word currently being spoken
// Offsets are in the same plain-text space tokenize() produces, so the reader maps them straight onto
// rendered word spans.

import { get, writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { ttsSettings, voices, wordTimingSupport } from '$lib/stores/tts';
import { analyzeParagraph, type Sentence } from './text';

export type TtsStatus = 'idle' | 'playing' | 'paused';
export type TtsLang = 'en' | 'zh';

export interface TtsState {
	status: TtsStatus;
	lang: TtsLang;
	paraIndex: number; // -1 when idle
	sentIndex: number;
	sentStart: number;
	sentEnd: number;
	wordStart: number;
	wordEnd: number;
	total: number; // paragraphs loaded
}

interface Block {
	plain: string;
	sentences: Sentence[];
}

const IDLE: TtsState = {
	status: 'idle',
	lang: 'en',
	paraIndex: -1,
	sentIndex: 0,
	sentStart: -1,
	sentEnd: -1,
	wordStart: -1,
	wordEnd: -1,
	total: 0,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function createEngine() {
	const state = writable<TtsState>({ ...IDLE });

	let blocks: Block[] = [];
	let lang: TtsLang = 'en';
	let loadedRef: string[] | null = null; // identity of the last-loaded paragraph array
	let loadedLang: TtsLang | null = null;
	let gen = 0; // bumped on every interrupt so stale utterance callbacks are ignored
	let keepalive: ReturnType<typeof setInterval> | null = null;
	// HOLD A LIVE REFERENCE TO THE SPEAKING UTTERANCE. WITHOUT THIS, Chrome/Safari CAN GARBAGE-COLLECT IT
	// MID-SENTENCE — onend/onboundary STOP FIRING AND THE READ SILENTLY STALLS. WRITE-ONLY ON PURPOSE: ITS
	// SOLE JOB IS TO KEEP THE UTTERANCE REACHABLE, SO THE "ASSIGNED BUT NEVER READ" LINT IS EXPECTED.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let current: SpeechSynthesisUtterance | null = null;

	function supported(): boolean {
		return browser && 'speechSynthesis' in window;
	}

	// Remember whether a voice actually reports word-boundary timing. Some voices (notably Google's
	// remote "Google UK English …" voices) only fire start/end, so word highlighting can't work for
	// them. We learn this from real playback and the dialog uses it to disable the word-highlight option.
	function recordVoiceTiming(uri: string | null, sawBoundary: boolean, wordCount: number) {
		if (!uri) return;
		if (sawBoundary) {
			wordTimingSupport.update((m) => (m[uri] === true ? m : { ...m, [uri]: true }));
		} else if (wordCount >= 3 && get(wordTimingSupport)[uri] === undefined) {
			// Only conclude "unsupported" from a sentence long enough to expect a boundary; never
			// downgrade a voice we've already seen fire one.
			wordTimingSupport.update((m) => ({ ...m, [uri]: false }));
		}
	}

	// Build the per-paragraph speech model. No-op if the same array is already loaded; skipped while
	// speaking so an incidental reactive re-run can't wipe the queue mid-read.
	function load(paras: string[], l: TtsLang) {
		if (!supported()) return;
		if (paras === loadedRef && l === loadedLang) return;
		if (get(state).status !== 'idle') return;
		loadedRef = paras;
		loadedLang = l;
		lang = l;
		blocks = paras.map((p) => {
			const { plain, sentences } = analyzeParagraph(p);
			return { plain, sentences };
		});
		state.set({ ...IDLE, lang: l, total: blocks.length });
	}

	function pickVoice(): SpeechSynthesisVoice | null {
		if (!supported()) return null;
		const all = window.speechSynthesis.getVoices();
		const s = get(ttsSettings);
		const uri = lang === 'en' ? s.enVoiceURI : s.zhVoiceURI;
		if (uri) {
			const exact = all.find((v) => v.voiceURI === uri);
			if (exact) return exact;
		}
		const prefix = lang === 'en' ? 'en' : 'zh';
		return all.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ?? null;
	}

	function startKeepalive() {
		stopKeepalive();
		// Chrome can silently stop a long-running queue; a periodic resume() (a no-op when healthy)
		// keeps it alive without the audible glitch a pause/resume pair causes.
		keepalive = setInterval(() => {
			// ONLY NUDGE WHEN WE BELIEVE WE'RE PLAYING *AND* THE SYNTH ISN'T EXTERNALLY PAUSED (e.g. AN OS/
			// HARDWARE MEDIA-KEY PAUSE) — OTHERWISE resume() WOULD FIGHT THE USER EVERY 9s.
			if (get(state).status === 'playing' && !window.speechSynthesis.paused) {
				try {
					window.speechSynthesis.resume();
				} catch {
					/* ignore */
				}
			}
		}, 9000);
	}
	function stopKeepalive() {
		if (keepalive) clearInterval(keepalive);
		keepalive = null;
	}

	// Speak the sentence at the current (paraIndex, sentIndex); chain to the next on end.
	function speakCurrent() {
		if (!supported()) return;
		const myGen = gen;
		const st = get(state);
		const block = blocks[st.paraIndex];
		if (!block) {
			finish();
			return;
		}
		if (st.sentIndex >= block.sentences.length) {
			const nextPara = st.paraIndex + 1;
			if (nextPara >= blocks.length) {
				finish();
				return;
			}
			state.update((x) => ({ ...x, paraIndex: nextPara, sentIndex: 0 }));
			speakCurrent();
			return;
		}
		const sen = block.sentences[st.sentIndex];
		const text = block.plain.slice(sen.start, sen.end);
		if (!/\S/.test(text)) {
			state.update((x) => ({ ...x, sentIndex: x.sentIndex + 1 }));
			speakCurrent();
			return;
		}

		state.update((x) => ({ ...x, sentStart: sen.start, sentEnd: sen.end, wordStart: -1, wordEnd: -1 }));

		const s = get(ttsSettings);
		const u = new SpeechSynthesisUtterance(text);
		u.rate = clamp(s.rate, 0.5, 2.5);
		u.pitch = clamp(s.pitch, 0, 2);
		u.volume = clamp(s.volume, 0, 1);
		const voice = pickVoice();
		const voiceURI = voice?.voiceURI ?? null;
		if (voice) {
			u.voice = voice;
			u.lang = voice.lang;
		} else {
			u.lang = lang === 'en' ? 'en-US' : 'zh-TW';
		}

		// Track boundary support so we can tell the settings dialog whether word highlighting is possible
		// for this voice.
		const wordCount = (text.match(/\S+/g) ?? []).length;
		let sawBoundary = false;

		u.onboundary = (e) => {
			if (gen !== myGen) return;
			if (e.name && e.name !== 'word') return;
			sawBoundary = true;
			const ci = e.charIndex ?? 0;
			let len = e.charLength ?? 0;
			if (!len) {
				const m = text.slice(ci).match(/^\S+/);
				len = m ? m[0].length : 1;
			}
			state.update((x) => ({ ...x, wordStart: sen.start + ci, wordEnd: sen.start + ci + len }));
		};
		u.onend = () => {
			if (gen !== myGen) return;
			recordVoiceTiming(voiceURI, sawBoundary, wordCount);
			state.update((x) => ({ ...x, sentIndex: x.sentIndex + 1, wordStart: -1, wordEnd: -1 }));
			speakCurrent();
		};
		u.onerror = (e) => {
			if (gen !== myGen) return;
			// 'interrupted'/'canceled' belong to a superseded run (filtered by gen). A real error on the
			// live run: skip the troublesome sentence rather than stalling the whole read.
			if (e.error === 'interrupted' || e.error === 'canceled') return;
			state.update((x) => ({ ...x, sentIndex: x.sentIndex + 1, wordStart: -1, wordEnd: -1 }));
			speakCurrent();
		};

		current = u; // PIN IT (SEE `current` DECLARATION) UNTIL onend/onerror REPLACES OR finish() CLEARS IT
		window.speechSynthesis.speak(u);
	}

	// Hard-interrupt the current utterance and (re)start speaking at a position.
	function startAt(paraIndex: number, sentIndex: number) {
		if (!supported() || !blocks.length) return;
		gen++;
		try {
			window.speechSynthesis.cancel();
		} catch {
			/* ignore */
		}
		state.update((x) => ({
			...x,
			status: 'playing',
			paraIndex,
			sentIndex,
			wordStart: -1,
			wordEnd: -1,
		}));
		startKeepalive();
		// A microtask gap after cancel() makes the following speak() reliable in Chrome.
		setTimeout(() => speakCurrent(), 0);
	}

	function play(paraIndex = 0, sentIndex = 0) {
		startAt(paraIndex, sentIndex);
	}

	function pause() {
		if (!supported() || get(state).status !== 'playing') return;
		try {
			window.speechSynthesis.pause();
		} catch {
			/* ignore */
		}
		state.update((x) => ({ ...x, status: 'paused' }));
	}

	function resume() {
		if (!supported() || get(state).status !== 'paused') return;
		try {
			window.speechSynthesis.resume();
		} catch {
			/* ignore */
		}
		state.update((x) => ({ ...x, status: 'playing' }));
	}

	function finish() {
		gen++;
		stopKeepalive();
		current = null;
		try {
			window.speechSynthesis.cancel();
		} catch {
			/* ignore */
		}
		state.set({ ...IDLE, lang, total: blocks.length });
	}

	function stop() {
		finish();
	}

	function toggle() {
		const st = get(state).status;
		if (st === 'playing') pause();
		else if (st === 'paused') resume();
		else play(0, 0);
	}

	// Jump one sentence forward/back, crossing paragraph boundaries.
	function step(delta: number) {
		const st = get(state);
		if (st.paraIndex < 0) return;
		let p = st.paraIndex;
		let s = st.sentIndex + delta;
		while (s < 0) {
			p--;
			if (p < 0) {
				p = 0;
				s = 0;
				break;
			}
			s += blocks[p].sentences.length;
		}
		while (blocks[p] && s >= blocks[p].sentences.length) {
			s -= blocks[p].sentences.length;
			p++;
			if (p >= blocks.length) {
				stop();
				return;
			}
		}
		startAt(p, s);
	}
	const next = () => step(1);
	const prev = () => step(-1);

	// Start reading from the sentence that contains a given plain-text offset in a paragraph
	// (powers click-a-word-to-read-from-here).
	function seekToOffset(paraIndex: number, offset: number) {
		const block = blocks[paraIndex];
		if (!block) return;
		let s = 0;
		for (let k = 0; k < block.sentences.length; k++) {
			if (offset < block.sentences[k].end) {
				s = k;
				break;
			}
			s = k;
		}
		startAt(paraIndex, s);
	}

	// Live-apply voice/rate/pitch/volume edits: re-speak the current sentence so the change is heard
	// immediately rather than at the next sentence.
	if (browser) {
		let prevSettings = get(ttsSettings);
		let reapply: ReturnType<typeof setTimeout> | null = null;
		ttsSettings.subscribe((s) => {
			const changed =
				s.rate !== prevSettings.rate ||
				s.pitch !== prevSettings.pitch ||
				s.volume !== prevSettings.volume ||
				s.enVoiceURI !== prevSettings.enVoiceURI ||
				s.zhVoiceURI !== prevSettings.zhVoiceURI;
			prevSettings = s;
			if (!changed) return;
			// DEBOUNCE: DRAGGING A rate/volume SLIDER FIRES THIS ON EVERY STEP. RE-SPEAKING (cancel→speak) ON
			// EACH ONE STUTTERS THE AUDIO AND CAN DESYNC THE QUEUE — COALESCE INTO ONE RE-SPEAK AFTER THE
			// DRAG SETTLES, AND ONLY WHILE ACTUALLY PLAYING.
			if (reapply) clearTimeout(reapply);
			reapply = setTimeout(() => {
				reapply = null;
				const st = get(state);
				if (st.status === 'playing') startAt(st.paraIndex, st.sentIndex);
			}, 250);
		});
		// Keep playback from outliving the page.
		window.addEventListener('pagehide', () => stop());
	}

	return {
		state: { subscribe: state.subscribe } as Readable<TtsState>,
		supported,
		load,
		play,
		pause,
		resume,
		stop,
		toggle,
		next,
		prev,
		seekToOffset,
	};
}

export const tts = createEngine();
export { voices };
