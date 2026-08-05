// TTS ENGINE
// A SINGLETON CONTROLLER AROUND THE Web Speech API. IT SPEAKS ONE SENTENCE PER UTTERANCE AND ADVANCES
// IN onend — THIS IS WHAT MAKES THE HIGHLIGHT TRACK PRECISELY (BOUNDARY CHAR OFFSETS STAY SHORT AND
// RELIABLE) AND SIDESTEPS Chrome'S ~15s SILENT CUTOFF ON LONG UTTERANCES.
//
// IT EXPOSES A SINGLE READABLE `state` STORE THAT THE READER SUBSCRIBES TO FOR HIGHLIGHTING:
//   paraIndex / sentIndex          — WHERE WE ARE IN THE LOADED PARAGRAPH LIST
//   sentStart / sentEnd            — PLAIN-TEXT CHAR RANGE OF THE SPOKEN SENTENCE (WITHIN ITS PARAGRAPH)
//   wordStart / wordEnd            — PLAIN-TEXT CHAR RANGE OF THE WORD CURRENTLY BEING SPOKEN
// OFFSETS ARE IN THE SAME PLAIN-TEXT SPACE tokenize() PRODUCES, SO THE READER MAPS THEM STRAIGHT ONTO
// RENDERED WORD SPANS.

// IMPORTED DEP-TYPES
import type { Readable } from 'svelte/store';
// IMPORTED TYPES
import type { Sentence } from './text';
// IMPORTED DEP-MODULES
import { Capacitor } from '@capacitor/core';
import { get, writable } from 'svelte/store';
import { browser } from '$app/environment';
// IMPORTED MODULES
import { ttsSettings, wordTimingSupport } from '$lib/stores/tts';
import { analyzeParagraph } from './text';

// -- TYPES -- //

export type TtsStatus = 'idle' | 'playing' | 'paused';
// A BCP-47-ISH VOICE LANGUAGE TAG (e.g. 'en-US', 'zh-TW', 'ja-JP', 'ko-KR'). WAS 'en' | 'zh' BEFORE THE
// READER BECAME LANGUAGE-AGNOSTIC; VOICE SELECTION NOW MATCHES BY THE TWO-LETTER PREFIX.
export type TtsLang = string;

export interface TtsState {
	status: TtsStatus;
	lang: TtsLang;
	paraIndex: number; // -1 WHEN IDLE
	sentIndex: number;
	sentStart: number;
	sentEnd: number;
	wordStart: number;
	wordEnd: number;
	total: number; // PARAGRAPHS LOADED
}

interface Block {
	plain: string;
	sentences: Sentence[];
}

// -- CONSTANTS -- //

const IDLE: TtsState = {
	status: 'idle',
	lang: 'en-US',
	paraIndex: -1,
	sentIndex: 0,
	sentStart: -1,
	sentEnd: -1,
	wordStart: -1,
	wordEnd: -1,
	total: 0,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// -- FUNCTIONS -- //

function createEngine() {
	const state = writable<TtsState>({ ...IDLE });

	let blocks: Block[] = [];
	let lang: TtsLang = 'en-US';
	let loadedRef: string[] | null = null; // IDENTITY OF THE LAST-LOADED PARAGRAPH ARRAY
	let loadedLang: TtsLang | null = null;
	let gen = 0; // BUMPED ON EVERY INTERRUPT SO STALE UTTERANCE CALLBACKS ARE IGNORED
	let keepalive: ReturnType<typeof setInterval> | null = null;
	// HOLD A LIVE REFERENCE TO THE SPEAKING UTTERANCE. WITHOUT THIS, Chrome/Safari CAN GARBAGE-COLLECT IT
	// MID-SENTENCE — onend/onboundary STOP FIRING AND THE READ SILENTLY STALLS. WRITE-ONLY ON PURPOSE: ITS
	// SOLE JOB IS TO KEEP THE UTTERANCE REACHABLE, SO THE "ASSIGNED BUT NEVER READ" LINT IS EXPECTED.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let current: SpeechSynthesisUtterance | null = null;

	function hasWebSpeech(): boolean {
		return browser && 'speechSynthesis' in window;
	}

	function hasNativeTts(): boolean {
		// THE CAPACITOR FALLBACK — ANDROID's WebView HAS NO Web Speech API (iOS WKWebView KEEPS IT, SO IT
		// STAYS THE PREFERRED PATH THERE).
		return browser && Capacitor.isNativePlatform();
	}

	function supported(): boolean {
		return hasWebSpeech() || hasNativeTts();
	}

	// REMEMBER WHETHER A VOICE ACTUALLY REPORTS WORD-BOUNDARY TIMING. SOME VOICES (NOTABLY Google'S
	// REMOTE "Google UK English …" VOICES) ONLY FIRE start/end, SO WORD HIGHLIGHTING CAN'T WORK FOR
	// THEM. WE LEARN THIS FROM REAL PLAYBACK AND THE DIALOG USES IT TO DISABLE THE WORD-HIGHLIGHT OPTION.
	function recordVoiceTiming(uri: string | null, sawBoundary: boolean, wordCount: number) {
		if (!uri) return;
		if (sawBoundary) {
			wordTimingSupport.update((m) => (m[uri] === true ? m : { ...m, [uri]: true }));
		} else if (wordCount >= 3 && get(wordTimingSupport)[uri] === undefined) {
			// ONLY CONCLUDE "UNSUPPORTED" FROM A SENTENCE LONG ENOUGH TO EXPECT A BOUNDARY; NEVER
			// DOWNGRADE A VOICE WE'VE ALREADY SEEN FIRE ONE.
			wordTimingSupport.update((m) => ({ ...m, [uri]: false }));
		}
	}

	// BUILD THE PER-PARAGRAPH SPEECH MODEL. NO-OP IF THE SAME ARRAY IS ALREADY LOADED; SKIPPED WHILE
	// SPEAKING SO AN INCIDENTAL REACTIVE RE-RUN CAN'T WIPE THE QUEUE MID-READ.
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
		// THE TWO SAVED-VOICE SLOTS STILL COVER en/zh; OTHER LANGUAGES AUTO-PICK A MATCHING SYSTEM VOICE.
		const prefix = lang.slice(0, 2).toLowerCase();
		const uri = prefix === 'en' ? s.enVoiceURI : prefix === 'zh' ? s.zhVoiceURI : '';
		if (uri) {
			const exact = all.find((v) => v.voiceURI === uri);
			if (exact) return exact;
		}
		return all.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ?? null;
	}

	function startKeepalive() {
		stopKeepalive();
		// Chrome CAN SILENTLY STOP A LONG-RUNNING QUEUE; A PERIODIC resume() (A NO-OP WHEN HEALTHY)
		// KEEPS IT ALIVE WITHOUT THE AUDIBLE GLITCH A pause/resume PAIR CAUSES.
		keepalive = setInterval(() => {
			// ONLY NUDGE WHEN WE BELIEVE WE'RE PLAYING *AND* THE SYNTH ISN'T EXTERNALLY PAUSED (e.g. AN OS/
			// HARDWARE MEDIA-KEY PAUSE) — OTHERWISE resume() WOULD FIGHT THE USER EVERY 9s.
			if (get(state).status === 'playing' && !window.speechSynthesis.paused) {
				try {
					window.speechSynthesis.resume();
				} catch {
					/* IGNORE */
				}
			}
		}, 9000);
	}
	function stopKeepalive() {
		if (keepalive) clearInterval(keepalive);
		keepalive = null;
	}

	// SPEAK THE SENTENCE AT THE CURRENT (paraIndex, sentIndex); CHAIN TO THE NEXT ON END.
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

		// NATIVE (CAPACITOR) FALLBACK — NO speechSynthesis ON ANDROID WebView. THE TTS PLUGIN HAS NO
		// END-OF-SENTENCE EVENT, SO SPEAK THE WHOLE REMAINDER AS ONE QUEUED CALL AND ADVANCE THE HIGHLIGHT
		// FROM ITS onRangeStart WORD OFFSETS (SEE speakNativeFrom / nativeRange).
		if (!hasWebSpeech()) {
			speakNativeFrom(st.paraIndex, st.sentIndex);
			return;
		}

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
			// NO MATCHING SYSTEM VOICE — HAND THE BROWSER THE LANGUAGE TAG DIRECTLY (e.g. 'ja-JP').
			u.lang = lang;
		}

		// TRACK BOUNDARY SUPPORT SO WE CAN TELL THE SETTINGS DIALOG WHETHER WORD HIGHLIGHTING IS POSSIBLE
		// FOR THIS VOICE.
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
			// 'interrupted'/'canceled' BELONG TO A SUPERSEDED RUN (FILTERED BY gen). A REAL ERROR ON THE
			// LIVE RUN: SKIP THE TROUBLESOME SENTENCE RATHER THAN STALLING THE WHOLE READ.
			if (e.error === 'interrupted' || e.error === 'canceled') return;
			state.update((x) => ({ ...x, sentIndex: x.sentIndex + 1, wordStart: -1, wordEnd: -1 }));
			speakCurrent();
		};

		current = u; // PIN IT (SEE `current` DECLARATION) UNTIL onend/onerror REPLACES OR finish() CLEARS IT
		window.speechSynthesis.speak(u);
	}

	// HARD-INTERRUPT THE CURRENT UTTERANCE AND (RE)START SPEAKING AT A POSITION.
	function startAt(paraIndex: number, sentIndex: number) {
		if (!supported() || !blocks.length) return;
		gen++;
		cancelAll();
		state.update((x) => ({
			...x,
			status: 'playing',
			paraIndex,
			sentIndex,
			wordStart: -1,
			wordEnd: -1,
		}));
		if (hasWebSpeech()) startKeepalive();
		// A MICROTASK GAP AFTER cancel() MAKES THE FOLLOWING speak() RELIABLE IN Chrome.
		setTimeout(() => speakCurrent(), 0);
	}

	function play(paraIndex = 0, sentIndex = 0) {
		startAt(paraIndex, sentIndex);
	}

	function pause() {
		if (!supported() || get(state).status !== 'playing') return;
		if (!hasWebSpeech()) {
			// NATIVE: THE TTS PLUGIN HAS NO PAUSE — STOP THE READ (THE PLAY BUTTON RESTARTS FROM THE
			// CURRENT POSITION VIA startAt). WEB KEEPS THE REAL pause/resume.
			finish();
			return;
		}
		try {
			window.speechSynthesis.pause();
		} catch {
			/* IGNORE */
		}
		state.update((x) => ({ ...x, status: 'paused' }));
	}

	function resume() {
		if (!supported() || get(state).status !== 'paused') return;
		try {
			window.speechSynthesis.resume();
		} catch {
			/* IGNORE */
		}
		state.update((x) => ({ ...x, status: 'playing' }));
	}

	function finish() {
		gen++;
		stopKeepalive();
		current = null;
		if (nativeIdleTimer) {
			clearTimeout(nativeIdleTimer);
			nativeIdleTimer = null;
		}
		cancelAll();
		state.set({ ...IDLE, lang, total: blocks.length });
	}

	function stop() {
		finish();
	}

	// CANCEL WHATEVER TTS ENGINE IS ACTIVE — THE WEB SPEECH SYNTHESIZER AND/OR THE NATIVE PLUGIN.
	function cancelAll() {
		if (hasWebSpeech()) {
			try {
				window.speechSynthesis.cancel();
			} catch {
				/* IGNORE */
			}
		}
		if (hasNativeTts()) {
			import('@capacitor-community/text-to-speech')
				.then(({ TextToSpeech }) => TextToSpeech.stop())
				.catch(() => {});
		}
	}

	// -- NATIVE TTS (CAPACITOR) -- //
	// ANDROID WebView HAS NO Web Speech API. THE @capacitor-community/text-to-speech PLUGIN HAS NO
	// END-OF-SENTENCE EVENT, SO WE SPEAK THE WHOLE REMAINDER AS ONE CALL (queueStrategy Flush) AND MAP ITS
	// onRangeStart WORD OFFSETS BACK ONTO (paraIndex, sentIndex, wordStart) VIA A RUNNING OFFSET TABLE.

	// OFFSET TABLE FOR THE CURRENT NATIVE REMAINDER (BUILT BY speakNativeFrom), PLUS A GEN TIE-BREAK SO A
	// SUPERSEDED RUN'S WORD EVENTS DON'T MOVE THE HIGHLIGHT.
	let nativeSegs: { para: number; sent: number; start: number; len: number }[] = [];
	let nativeGen = 0;
	// THE PLUGIN HAS NO END-OF-SPEECH EVENT — WHEN NO WORD RANGE ARRIVES FOR A WHILE, SPEECH IS DONE:
	// RESET THE WATCHDOG ON EVERY WORD AND FINISH (→ IDLE) AFTER A QUIET GAP.
	let nativeIdleTimer: ReturnType<typeof setTimeout> | null = null;

	function nativeRange(start: number, end: number) {
		if (gen !== nativeGen) return;
		if (nativeIdleTimer) clearTimeout(nativeIdleTimer);
		nativeIdleTimer = setTimeout(() => {
			if (gen === nativeGen && get(state).status === 'playing') finish();
		}, 3000);
		const seg = nativeSegs.find((s) => start >= s.start && start < s.start + s.len);
		if (!seg) return;
		const block = blocks[seg.para];
		const sen = block?.sentences[seg.sent];
		if (!block || !sen) return;
		state.update((x) => ({
			...x,
			paraIndex: seg.para,
			sentIndex: seg.sent,
			sentStart: sen.start,
			sentEnd: sen.end,
			wordStart: sen.start + (start - seg.start),
			wordEnd: sen.start + (end - seg.start),
		}));
	}

	// REGISTER THE WORD-OFFSET LISTENER ONCE (ANDROID EMITS PER-WORD EVENTS; iOS HAS NONE, SO WORD
	// HIGHLIGHTING STAYS OFF THERE AND THE SENTENCE HIGHLIGHT TRACKS THE FIRST SENTENCE OF THE REMAINDER).
	if (hasNativeTts()) {
		import('@capacitor-community/text-to-speech')
			.then(({ TextToSpeech }) =>
				TextToSpeech.addListener('onRangeStart', ({ start, end }) => nativeRange(start, end)),
			)
			.catch(() => {});
	}

	async function speakNativeFrom(paraIndex: number, sentIndex: number) {
		const { TextToSpeech, QueueStrategy } = await import('@capacitor-community/text-to-speech');
		// FLATTEN EVERY SENTENCE FROM THE CURRENT POSITION INTO ONE TEXT + A SEGMENT TABLE.
		const segments: { para: number; sent: number; start: number; len: number }[] = [];
		let text = '';
		for (let p = paraIndex; p < blocks.length; p++) {
			for (let k = p === paraIndex ? sentIndex : 0; k < blocks[p].sentences.length; k++) {
				const sen = blocks[p].sentences[k];
				const t = blocks[p].plain.slice(sen.start, sen.end);
				if (!/\S/.test(t)) continue;
				segments.push({ para: p, sent: k, start: text.length, len: t.length });
				text += (text ? ' ' : '') + t;
			}
		}
		if (!text) {
			finish();
			return;
		}
		nativeSegs = segments;
		nativeGen = gen;
		state.update((x) => ({ ...x, status: 'playing', paraIndex, sentIndex, wordStart: -1, wordEnd: -1 }));
		const s = get(ttsSettings);
		try {
			await TextToSpeech.speak({
				text,
				lang,
				rate: clamp(s.rate, 0.5, 2.5),
				pitch: clamp(s.pitch, 0, 2),
				volume: clamp(s.volume, 0, 1),
				queueStrategy: QueueStrategy.Flush,
			});
		} catch {
			finish();
		}
	}

	// JUMP ONE SENTENCE FORWARD/BACK, CROSSING PARAGRAPH BOUNDARIES.
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

	// START READING FROM THE SENTENCE THAT CONTAINS A GIVEN PLAIN-TEXT OFFSET IN A PARAGRAPH
	// (POWERS CLICK-A-WORD-TO-READ-FROM-HERE).
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

	// LIVE-APPLY VOICE/RATE/PITCH/VOLUME EDITS: RE-SPEAK THE CURRENT SENTENCE SO THE CHANGE IS HEARD
	// IMMEDIATELY RATHER THAN AT THE NEXT SENTENCE.
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
		// KEEP PLAYBACK FROM OUTLIVING THE PAGE.
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
		next,
		prev,
		seekToOffset,
	};
}

export const tts = createEngine();
