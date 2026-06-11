<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { TermDraft, TranslationUsage } from '$lib/types';
	// IMPORTED TYPES
	import type { Phase } from '$lib/components/TranslationStatus.svelte';
	import type { PageData } from './$types';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onDestroy, onMount } from 'svelte';
	// IMPORTED MODULES
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { cjkStack, latinStack } from '$lib/fonts';
	import { getLanguage } from '$lib/languages';
	import { settings, type LayoutMode, type Theme } from '$lib/stores/settings';
	import { isMobile } from '$lib/stores/viewport';
	import { cn } from '$lib/utils/cn';
	import { chapterLabel, stripChapterPrefix, stripLeadingTitle } from '$lib/chapter-label';
	import { renderMarkup } from '$lib/markup';
	import { tts } from '$lib/tts/engine';
	import { ttsSettings, ensureVoices } from '$lib/stores/tts';
	import { ripple } from '$lib/actions/ripple';
	// IMPORTED DEP-COMPONENTS
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Coffee from 'lucide-svelte/icons/coffee';
	import Contrast from 'lucide-svelte/icons/contrast';
	import Clock from 'lucide-svelte/icons/clock';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Keyboard from 'lucide-svelte/icons/keyboard';
	import Languages from 'lucide-svelte/icons/languages';
	import ListOrdered from 'lucide-svelte/icons/list-ordered';
	import Menu from 'lucide-svelte/icons/menu';
	import Minus from 'lucide-svelte/icons/minus';
	import Moon from 'lucide-svelte/icons/moon';
	import MoreHorizontal from 'lucide-svelte/icons/more-horizontal';
	import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
	import Pause from 'lucide-svelte/icons/pause';
	import Play from 'lucide-svelte/icons/play';
	import Plus from 'lucide-svelte/icons/plus';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import SettingsIcon from 'lucide-svelte/icons/settings';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Sun from 'lucide-svelte/icons/sun';
	import Type from 'lucide-svelte/icons/type';
	import Volume2 from 'lucide-svelte/icons/volume-2';
	// IMPORTED COMPONENTS
	import Badge from '$lib/components/ui/Badge.svelte';
	import ChapterList from '$lib/components/ChapterList.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import CostMeter from '$lib/components/CostMeter.svelte';
	import GlossaryPanel from '$lib/components/GlossaryPanel.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SettingsDrawer from '$lib/components/SettingsDrawer.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import SpokenParagraph from '$lib/components/SpokenParagraph.svelte';
	import TocDrawer from '$lib/components/TocDrawer.svelte';
	import TranslationStatus from '$lib/components/TranslationStatus.svelte';
	import TtsBar from '$lib/components/TtsBar.svelte';
	import TtsSettings from '$lib/components/TtsSettings.svelte';

	// -- REQUIRED PROPS -- //

	export let data: PageData;

	// -- TYPES -- //

	type ChapterView = {
		id: number;
		uuid: string;
		bookId: string;
		bookTitle: string;
		sourceType: 'web' | 'epub' | 'txt' | 'manual';
		// THE BOOK'S TRANSLATION DIRECTION — DRIVES FONTS, TTS, READING-TIME, AND THE VIEW-MODE LABELS.
		sourceLang: string;
		targetLang: string;
		seq: number;
		titleSource: string;
		titleTarget: string | null;
		contentSource: string;
		contentTarget: string | null;
		chapterUrl: string | null;
		prevUrl: string | null;
		nextUrl: string | null;
		indexUrl: string | null;
		prevUuid: string | null;
		nextUuid: string | null;
		extractedAt: number | null;
		readProgress: number | null;
	};

	// -- CONSTANTS -- //

	// QUICK CYCLE FOR THE HEADER THEME SWITCH (FULL SET LIVES IN SETTINGS)
	const QUICK_THEMES: Theme[] = ['light', 'sepia', 'dark'];
	const THEME_ICON = { light: Sun, sepia: Coffee, dark: Moon, oled: Moon, contrast: Contrast } as const;
	const scrollKey = (uuid: string) => `xianslate:scroll:${uuid}`;
	// A TERM COUNTS AS "NEW TO THIS CHAPTER" WHEN ITS createdAt IS WITHIN THIS MANY ms OF THE CHAPTER'S
	// extractedAt — i.e. IT WAS ADDED BY *THIS* CHAPTER'S EXTRACTION BATCH (createdAt IS STAMPED A MOMENT
	// BEFORE extractedAt). TERMS CARRIED OVER FROM EARLIER CHAPTERS HAVE A DIFFERENT BATCH TIMESTAMP AND
	// FALL OUTSIDE THIS WINDOW. 60s IS FAR LARGER THAN THE intra-batch GAP YET SMALLER THAN THE TYPICAL
	// SPACING BETWEEN CHAPTER EXTRACTIONS.
	const NEW_TERM_WINDOW = 60 * 1000;
	// CONFIRMATION COPY FOR THE BILLED, NON-TRIVIAL ACTIONS (RE-TRANSLATE / EXTRACT) — BOTH CALL THE MODEL
	const CONFIRM = {
		retranslate: {
			title: 'Re-translate this chapter?',
			message: 'This discards the saved translation and runs the model again, using API credits.',
			confirmLabel: 'Re-translate',
		},
		extract: {
			title: 'Extract glossary terms?',
			message: 'This scans the whole chapter with the model to find new glossary terms, using API credits.',
			confirmLabel: 'Extract terms',
		},
	} as const;

	// -- STATES -- //

	let view: ChapterView = data.view;
	// NOTE: THROUGHOUT THIS FILE THE en* LOCALS HOLD THE TARGET-LANGUAGE TEXT AND THE zh* LOCALS HOLD THE
	// SOURCE-LANGUAGE TEXT (THE NAMES PRE-DATE THE LANGUAGE-AGNOSTIC REFACTOR; THE DATA IS source/target).
	let titleTarget = data.view.titleTarget ?? '';
	let busyNav = false;
	let enText = data.view.contentTarget ?? '';
	let translating = false;
	// IN-FLIGHT TRANSLATION STREAM — ABORTED WHEN NAVIGATING AWAY SO ITS DELTAS DON'T BLEED INTO THE
	// NEXT CHAPTER (THE SERVER JOB KEEPS RUNNING DETACHED AND STILL SAVES THE RESULT).
	let inflight: AbortController | null = null;
	let phase: Phase = data.view.contentTarget ? 'done' : 'idle';
	let extractedCount: number | null = null;
	let extracting = false;
	// WHETHER THIS CHAPTER HAS EVER BEEN AUTO-EXTRACTED — DRIVES "Extract terms" VS "View terms" BEHAVIOR
	let extractedAt: number | null = data.view.extractedAt;
	// "TERMS IN THIS CHAPTER" DIALOG — THE GLOSSARY TERMS PRESENT IN THE BODY (FREE, NO MODEL CALL)
	let termsOpen = false;
	let termsLoading = false;
	let termsUsed: TermDraft[] = [];
	// THIS CHAPTER'S LAST EXTRACTION TIME (SERVER CLOCK) — A TERM IS "NEW TO THIS CHAPTER" WHEN ITS
	// createdAt SITS RIGHT NEXT TO THIS, i.e. IT WAS ADDED BY *THIS* CHAPTER'S EXTRACTION (NOT CARRIED
	// OVER FROM AN EARLIER CHAPTER, WHOSE BATCH HAS A DIFFERENT TIMESTAMP).
	let termsExtractedAt: number | null = null;
	let usage: TranslationUsage | null = null;
	let cached = false;
	let matched = 0;
	let runningCost = 0;
	// DETAILED PIPELINE PROGRESS (DRIVES THE STEP CARD): CHAPTER SCOPE + TERM-SCAN PROGRESS. THE
	// TRANSLATED-PARAGRAPH COUNT IS DERIVED FROM enText REACTIVELY (NO SERVER EVENT NEEDED).
	let totalParas = 0;
	let chars = 0;
	let extractDone = 0;
	let extractTotal = 0;
	let extractFound = 0;
	// WHICH BILLED ACTION IS AWAITING CONFIRMATION (null = NO DIALOG OPEN)
	let confirmAction: 'retranslate' | 'extract' | null = null;
	let settingsOpen = false;
	let glossaryOpen = false;
	let tocOpen = false;
	let ttsSettingsOpen = false;
	// ONCE THE READER HAS USED TTS, RENDER THE SPOKEN PARAGRAPHS AS WORD SPANS (HIGHLIGHT + CLICK-TO-SEEK)
	let ttsStarted = false;
	let progress = 0;
	let sidebarCollapsed = false;
	let shortcutsOpen = false;
	// MOBILE: OVERFLOW ("MORE") ACTION SHEET + AUTO-HIDING CHROME FOR IMMERSIVE READING
	let moreOpen = false;
	let chromeHidden = false;
	let lastScrollY = 0;
	// SUPPRESS SCROLL-SAVE WHILE WE PROGRAMMATICALLY RESTORE A SAVED POSITION
	let restoringScroll = false;
	let scrollSaveTimer: ReturnType<typeof setTimeout> | undefined;
	// READING-PROGRESS PERSISTENCE: chapterMax = THE FURTHEST CONTENT-SEEN FRACTION (0..1) FOR THE CURRENT
	// CHAPTER (MONOTONIC, SEEDED FROM THE STORED VALUE). PERSISTED DEBOUNCED + ON LEAVE SO THE CHAPTER LISTS
	// SHOW A REAL "READ" CHECKMARK (REACHED THE END) — NOT JUST "SITS BEFORE THE CURRENT CHAPTER".
	let chapterMax = data.view.readProgress ?? 0;
	let lastSentProgress = chapterMax;
	let progressSaveTimer: ReturnType<typeof setTimeout> | undefined;
	// FOLLOW THE SPOKEN LINE: TRACK LAST SCROLLED KEY TO AVOID REDUNDANT SCROLL CALLS
	let lastScrollKey = '';
	// PREFETCH: TRACK IN-FLIGHT STATUS AND WHICH CHAPTER WE LAST PREFETCHED FROM
	let prefetching = false;
	let prefetchedFrom: string | null = null;
	let prefetchTimer: ReturnType<typeof setTimeout> | undefined;

	// -- STORES -- //

	// READ-ALOUD ENGINE STATE (DRIVES HIGHLIGHTING + THE HEADER ICON)
	const ttsState = tts.state;

	// -- REACTIVE STATES -- //

	// THE BOOK'S LANGUAGE RECORDS — DRIVE LABELS, FONTS, TTS VOICE, AND READING-SPEED ESTIMATES.
	$: srcLang = getLanguage(view?.sourceLang);
	$: tgtLang = getLanguage(view?.targetLang);
	// CUT A REDUNDANT LEADING TITLE LINE FROM THE SOURCE (AND ANY ALREADY-BAKED-IN TARGET ONE)
	$: zhBody = view ? stripLeadingTitle(view.contentSource, view.titleSource) : '';
	// WHILE STREAMING, SHOW THE RAW TEXT — STRIPPING MID-STREAM WOULD MAKE THE FIRST PARAGRAPH SUDDENLY
	// VANISH THE MOMENT A SECOND ONE ARRIVES. STRIP ONCE SETTLED (CACHED/STORED TEXT IS NOT 'translating').
	// DEFENSIVE: CONVERT ANY LEFTOVER PARAGRAPH MARKER (PILCROW + ANY MANGLED BRACKET FROM THE ⟦-⟯〚〛 FAMILY,
	// e.g. THE TORTOISE-SHELL ⟬) INTO A BLANK LINE, THEN SCRUB ANY STRAY BRACKET A PAST MANGLE BAKED IN
	// WITHOUT A PILCROW — SO EXISTING CHAPTERS DISPLAY CLEANLY WITHOUT A RE-TRANSLATE.
	$: enBody = (translating ? enText : stripLeadingTitle(enText, titleTarget))
		.replace(/[⟦-⟯〚〛]*¶[⟦-⟯〚〛]*/gu, '\n\n')
		.replace(/[⟦-⟯〚〛]/gu, '');
	$: zhParas = zhBody ? zhBody.split(/\n{2,}/).filter(Boolean) : [];
	$: enParas = enBody ? enBody.split(/\n{2,}/).filter(Boolean) : [];
	// PRE-RENDER THE INLINE MARKUP ONCE PER TEXT CHANGE. WITHOUT THIS, {@html renderMarkup(p)} IN THE
	// TEMPLATE RE-PARSES EVERY PARAGRAPH ON EVERY REACTIVE PASS (FONT-SIZE TWEAK, TTS BOUNDARY TICK, …),
	// NOT JUST WHEN THE TEXT ACTUALLY CHANGES.
	$: enHtml = enParas.map((p) => renderMarkup(p));
	// STACKED VIEW: PAIR PARAGRAPHS BY POSITION. EXACT WHEN COUNTS MATCH; BEST-EFFORT (TAIL SHOWS
	// SOLO) WHEN THE TRANSLATION MERGED/SPLIT A FEW — STILL PER-PARAGRAPH (SOURCE THEN TARGET).
	$: interleaved = Array.from({ length: Math.max(zhParas.length, enParas.length) }, (_, i) => ({
		i,
		zh: zhParas[i] ?? null,
		en: enParas[i] ?? null,
	}));
	// ON THE ORIGINAL (SOURCE-ONLY) VIEW, SHOW THE RAW TITLE; OTHERWISE PREFER THE TRANSLATED TITLE.
	$: displayTitle = stripChapterPrefix(
		$settings.layout === 'source' ? view?.titleSource || '' : titleTarget || view?.titleSource || '',
	);
	// HIDE THE SOURCE SUBTITLE IN THE TARGET-ONLY AND SOURCE-ONLY VIEWS
	$: showZhTitle =
		!!titleTarget &&
		$settings.layout !== 'source' &&
		$settings.layout !== 'target' &&
		titleTarget !== view?.titleSource;
	// SMART CHAPTER LABEL FROM THE TITLE (NOT THE ROW POSITION)
	$: chLabel = view ? chapterLabel(view.titleSource, view.titleTarget) : ({ kind: 'plain' } as const);
	$: chapterText =
		chLabel.kind === 'chapter'
			? `Chapter ${chLabel.number}`
			: chLabel.kind === 'special'
				? chLabel.tag
				: `Chapter ${(view?.seq ?? 0) + 1}`;
	// CHAPTER NUMBER PREFIXED ONTO THE TITLE (E.G. "Chapter 5: The Duel")
	$: headingTitle = displayTitle ? `${chapterText}: ${displayTitle}` : chapterText;
	// VIEW-MODE OPTIONS — LABELLED BY THE BOOK'S OWN LANGUAGES. DROP BILINGUAL ON MOBILE (NO ROOM FOR TWO
	// COLUMNS; STACKED COVERS THE SAME NEED).
	$: layouts = [
		{ id: 'target', label: tgtLang.name },
		{ id: 'sidebyside', label: 'Bilingual' },
		{ id: 'interleaved', label: 'Stacked' },
		{ id: 'source', label: 'Original' },
	] as { id: LayoutMode; label: string }[];
	$: visibleLayouts = $isMobile ? layouts.filter((l) => l.id !== 'sidebyside') : layouts;
	// ESTIMATED READING TIME — FROM EACH LANGUAGE'S OWN SPEED (WORDS/MIN FOR SPACE-DELIMITED, CHARS/MIN
	// OTHERWISE). 0 = NOT YET TRANSLATED/EMPTY.
	$: readMinutes = (() => {
		const estimate = (paras: string[], lang: typeof tgtLang) => {
			const units = lang.wordDelimited
				? paras.join(' ').trim().split(/\s+/).filter(Boolean).length
				: paras.join('').length;
			return units ? Math.max(1, Math.round(units / lang.readUnitsPerMin)) : 0;
		};
		if (enParas.length > 0 && $settings.layout !== 'source') return estimate(enParas, tgtLang);
		return estimate(zhParas, srcLang);
	})();
	$: fontStyle =
		`font-family:${latinStack($settings.latinFont)},${cjkStack($settings.cjkFont)};` +
		`font-size:${$settings.fontSizePx}px;line-height:${$settings.lineHeight};` +
		`letter-spacing:${$settings.letterSpacingEm}em;text-align:${$settings.align};`;
	$: pStyle = `margin-bottom:${$settings.paragraphSpacingEm}em;text-indent:${$settings.indent ? '2em' : '0'};`;
	$: readingWidthCh = $settings.layout === 'sidebyside' ? $settings.measureCh * 2 + 6 : $settings.measureCh;
	// WIDTH IS IN ch — SET THE READING FONT/SIZE ON THE SAME CONTAINER SO ch MATCHES THE ACTUAL TEXT
	$: containerStyle =
		`max-width:${readingWidthCh}ch;` +
		`font-size:${$settings.fontSizePx}px;` +
		`font-family:${latinStack($settings.latinFont)},${cjkStack($settings.cjkFont)};`;
	$: canPrev = !!(view && (view.prevUuid || view.prevUrl));
	$: canNext = !!(view && (view.nextUuid || view.nextUrl));
	// ANY BILLED PIPELINE WORK IN FLIGHT — DISABLES THE Re-translate / Terms ACTIONS SO THEY CAN'T RACE.
	$: processing = translating || extracting;
	// PREPARE UPCOMING CHAPTER(S) IN THE BACKGROUND WHENEVER THE CURRENT CHAPTER CHANGES
	$: if (view) schedulePrefetch(view.uuid);
	// READ THE TARGET TEXT WHEN IT EXISTS AND WE'RE NOT IN THE SOURCE-ONLY VIEW; OTHERWISE READ THE SOURCE.
	$: spokenIsTarget = enParas.length > 0 && $settings.layout !== 'source';
	$: spokenLang = spokenIsTarget ? tgtLang.ttsLang : srcLang.ttsLang;
	$: spokenParas = spokenIsTarget ? enParas : zhParas;
	// WHICH RENDERED PARAGRAPHS GET WORD-SPAN TREATMENT (HIGHLIGHT + CLICK-TO-SEEK)
	$: enSpoken = ttsStarted && spokenIsTarget;
	$: zhSpoken = ttsStarted && !spokenIsTarget;
	// SHARED HIGHLIGHT PROPS SPREAD ONTO EVERY SpokenParagraph (active-ness is per-paragraph)
	$: hl = {
		sentStart: $ttsState.sentStart,
		sentEnd: $ttsState.sentEnd,
		wordStart: $ttsState.wordStart,
		wordEnd: $ttsState.wordEnd,
		highlightSentence: $ttsSettings.highlight,
		highlightWord: $ttsSettings.highlightWord,
	};
	$: ttsActive = $ttsState.status !== 'idle';
	// COPY FOR THE OPEN CONFIRM DIALOG — FALL BACK TO retranslate WHILE CLOSED SO THE OUTRO HAS STABLE TEXT
	$: confirmCfg = confirmAction ? CONFIRM[confirmAction] : CONFIRM.retranslate;

	// -- REACTIVE STATEMENTS -- //

	// MOBILE IS TOO NARROW FOR THE SIDE-BY-SIDE COLUMNS — FALL BACK TO STACKED THE MOMENT BILINGUAL IS ACTIVE
	$: if (browser && $isMobile && $settings.layout === 'sidebyside') $settings.layout = 'interleaved';
	// KEEP THE ENGINE'S SENTENCE MODEL IN SYNC WITH WHAT'S ON SCREEN (NO-OP WHILE SPEAKING)
	$: if (browser) tts.load(spokenParas, spokenLang);
	// FOLLOW THE SPOKEN LINE: SCROLL ON SENTENCE CHANGE ONLY (NOT EVERY WORD), AND ONLY WHEN OFF-SCREEN
	$: if (browser && $ttsState.status === 'playing' && $ttsSettings.autoScroll && $ttsState.paraIndex >= 0) {
		const key = `${$ttsState.paraIndex}:${$ttsState.sentIndex}`;
		if (key !== lastScrollKey) {
			lastScrollKey = key;
			scrollToActive($ttsState.paraIndex);
		}
	}

	// -- FUNCTIONS -- //

	// SYNC LOCAL STATE FROM THE SSR-LOADED CHAPTER (AFTER NAVIGATING TO A NEW CHAPTER)
	function syncFromData() {
		// CANCEL ANY STREAM STILL RUNNING FOR THE CHAPTER WE'RE LEAVING
		inflight?.abort();
		inflight = null;
		translating = false;
		view = data.view;
		enText = view.contentTarget ?? '';
		titleTarget = view.titleTarget ?? '';
		usage = null;
		cached = false;
		matched = 0;
		extractedCount = null;
		totalParas = 0;
		chars = 0;
		extractDone = 0;
		extractTotal = 0;
		extractFound = 0;
		extractedAt = view.extractedAt;
		termsOpen = false;
		termsUsed = [];
		// SEED THIS CHAPTER'S READING-PROGRESS MAX FROM THE STORED VALUE SO IT NEVER REGRESSES ON REVISIT.
		clearTimeout(progressSaveTimer);
		chapterMax = view.readProgress ?? 0;
		lastSentProgress = chapterMax;
		phase = view.contentTarget ? 'done' : 'idle';
		// REAL-TIME: AUTO-TRANSLATE A CHAPTER THAT HASN'T BEEN TRANSLATED YET
		if (!view.contentTarget) translate(false);
	}

	async function fetchByUrl(url: string, dir?: 'prev' | 'next') {
		busyNav = true;
		try {
			const res = await fetch('/api/fetch', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				// ANCHOR = CURRENT CHAPTER (RIGHT POSITION); targetBookId = CURRENT BOOK SO A FETCHED
				// NEIGHBOR STAYS IN THIS BOOK — INCLUDING MANUAL BOOKS BUILT FROM SCRAPED URLS
				body: JSON.stringify({ url, fromChapterId: view?.id, dir, targetBookId: view?.bookId }),
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Fetch failed');
			const v: ChapterView = await res.json();
			goto(`/book/${v.bookId}/${v.uuid}/`, { noScroll: true });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not fetch that chapter.');
		} finally {
			busyNav = false;
		}
	}

	// INTELLIGENT PREV/NEXT: RE-RESOLVE THE NEIGHBOR FROM THE SERVER AT CLICK TIME SO A CHAPTER DELETED
	// SINCE THIS PAGE LOADED IS SKIPPED — THE SERVER RETURNS THE NEAREST REMAINING CHAPTER (GAP-TOLERANT)
	// INSTEAD OF NAVIGATING INTO A 404. FALLS BACK TO THE CACHED POINTERS IF THE LOOKUP FAILS.
	async function go(dir: 'prev' | 'next') {
		if (!view || busyNav) return;
		busyNav = true;
		try {
			let fresh = (await getChapterView(view.uuid)) ?? view;
			let uuid = dir === 'prev' ? fresh.prevUuid : fresh.nextUuid;
			let url = dir === 'prev' ? fresh.prevUrl : fresh.nextUrl;
			// SELF-HEAL: NO KNOWN NEIGHBOR IN THIS DIRECTION ON A WEB CHAPTER → RE-READ THE SOURCE PAGE TO
			// REFRESH ITS NAV LINKS. COVERS THE FORMER "LATEST" CHAPTER ONCE A NEWER ONE IS PUBLISHED AND
			// A PREVIOUSLY MIS-SCRAPED next/prev THAT WAS REJECTED AS GOING THE WRONG DIRECTION.
			if (!uuid && !url && fresh.chapterUrl) {
				const refreshed = await refreshNav(fresh.uuid);
				if (refreshed) {
					fresh = refreshed;
					uuid = dir === 'prev' ? fresh.prevUuid : fresh.nextUuid;
					url = dir === 'prev' ? fresh.prevUrl : fresh.nextUrl;
				}
			}
			if (uuid) await goto(`/book/${fresh.bookId}/${uuid}/`, { noScroll: true });
			else if (url) await fetchByUrl(url, dir);
			else toast.error(dir === 'prev' ? 'This is the first chapter.' : 'This is the last chapter.');
		} finally {
			busyNav = false;
		}
	}

	// RE-READ THE CURRENT CHAPTER'S SOURCE PAGE TO REFRESH ITS prev/next LINKS (RETURNS THE UPDATED VIEW).
	async function refreshNav(uuid: string): Promise<ChapterView | null> {
		try {
			const r = await fetch('/api/chapter/refresh', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uuid }),
			});
			return r.ok ? await r.json() : null;
		} catch {
			return null;
		}
	}

	// WHILE READING, QUIETLY PREPARE THE NEXT CHAPTER(S) SO 'NEXT' IS INSTANT: DOWNLOAD UPCOMING
	// CHAPTERS (AND OPTIONALLY WARM THEIR TRANSLATIONS). FIRE-AND-FORGET, BAILS IF YOU NAVIGATE AWAY.
	async function getChapterView(uuid: string): Promise<ChapterView | null> {
		try {
			const r = await fetch(`/api/chapter?id=${uuid}`);
			return r.ok ? await r.json() : null;
		} catch {
			return null;
		}
	}

	async function fetchNeighbor(url: string, fromChapterId: number): Promise<ChapterView | null> {
		try {
			const r = await fetch('/api/fetch', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url, fromChapterId, dir: 'next', targetBookId: view?.bookId }),
			});
			return r.ok ? await r.json() : null;
		} catch {
			return null;
		}
	}

	async function warmTranslate(chapterId: number) {
		// STARTS THE DETACHED SERVER JOB (TRANSLATE + CACHE), THEN RELEASES THE CONNECTION ONCE THE JOB
		// IS CONFIRMED RUNNING — IT FINISHES SERVER-SIDE REGARDLESS. THE SIDEBAR POLLS FOR THE BADGE.
		const ctrl = new AbortController();
		try {
			const res = await fetch('/api/translate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ chapterId, autoExtract: $settings.autoExtract }),
				signal: ctrl.signal,
			});
			await res.body?.getReader().read(); // FIRST CHUNK → JOB IS RUNNING
		} catch {
			// IGNORE — BACKGROUND WARM-UP IS BEST-EFFORT
		} finally {
			ctrl.abort();
		}
	}

	async function runPrefetch(fromUuid: string) {
		const n = $settings.prefetch;
		if (!view || prefetching || n <= 0) return;
		prefetching = true;
		try {
			let cur = view;
			for (let i = 0; i < n; i++) {
				if (view?.uuid !== fromUuid) return; // NAVIGATED AWAY — STOP THE CHAIN
				let nextV: ChapterView | null = null;
				if (cur.nextUuid) {
					nextV = await getChapterView(cur.nextUuid);
				} else if (cur.nextUrl) {
					nextV = await fetchNeighbor(cur.nextUrl, cur.id);
					// REFLECT THE NEW NEIGHBOR ON THE ON-SCREEN CHAPTER SO 'NEXT' BECOMES A PURE NAVIGATION
					if (nextV && view?.uuid === fromUuid) view = { ...view, nextUuid: nextV.uuid };
				} else {
					break;
				}
				if (!nextV) break;
				if ($settings.prefetchTranslate && !nextV.contentTarget) void warmTranslate(nextV.id);
				cur = nextV;
			}
		} finally {
			prefetching = false;
		}
	}

	function schedulePrefetch(uuid: string) {
		if (!browser || prefetchedFrom === uuid) return;
		prefetchedFrom = uuid;
		clearTimeout(prefetchTimer);
		// SMALL DELAY SO THE CURRENT CHAPTER'S OWN FETCH/TRANSLATE GETS PRIORITY FIRST
		prefetchTimer = setTimeout(() => runPrefetch(uuid), 1200);
	}

	async function translate(force = false) {
		if (!view || translating) return;
		// SUPERSEDE ANY PRIOR STREAM AND BIND THIS RUN TO ITS OWN ABORT CONTROLLER
		inflight?.abort();
		const ctrl = new AbortController();
		inflight = ctrl;
		translating = true;
		phase = 'preparing';
		extractedCount = null;
		totalParas = 0;
		chars = 0;
		extractDone = 0;
		extractTotal = 0;
		extractFound = 0;
		enText = '';
		usage = null;
		cached = false;
		try {
			const res = await fetch('/api/translate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ chapterId: view.id, force, autoExtract: $settings.autoExtract }),
				signal: ctrl.signal,
			});
			if (!res.ok || !res.body) throw new Error('Translation request failed.');
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				// THIS RUN WAS SUPERSEDED (USER NAVIGATED AWAY) — STOP APPLYING ITS OUTPUT
				if (ctrl.signal.aborted || inflight !== ctrl) return;
				buf += decoder.decode(value, { stream: true });
				const blocks = buf.split('\n\n');
				buf = blocks.pop() ?? '';
				for (const block of blocks) {
					// AN SSE BLOCK IS EITHER A "data: {…}" EVENT OR A COMMENT HEARTBEAT (": ping") THE SERVER
					// SENDS TO KEEP THE CONNECTION ALIVE DURING THE LONG EXTRACT/TITLE STAGE. ONLY PARSE THE
					// FORMER — A COMMENT LINE IS NOT JSON AND WOULD THROW.
					const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
					if (!dataLine) continue;
					const line = dataLine.slice(5).trim();
					if (!line) continue;
					const msg = JSON.parse(line);
					if (msg.type === 'delta') {
						enText += msg.text;
						// CACHE HITS ARRIVE AS A SINGLE FULL-TEXT DELTA — KEEP THE 'cached' PHASE
						if (phase !== 'cached') phase = 'streaming';
					} else if (msg.type === 'replace') {
						// FULL-TEXT CORRECTION (SOURCE-SCRIPT-LEAK REPAIR) — SWAP THE WHOLE BODY FOR THE CLEANED VERSION
						enText = msg.text;
					} else if (msg.type === 'title') {
						titleTarget = msg.text;
						if (view) view.titleTarget = msg.text;
					} else if (msg.type === 'prepare') {
						totalParas = msg.paragraphs;
						chars = msg.chars;
					} else if (msg.type === 'stage') {
						if (msg.stage === 'extracting') phase = 'extracting';
					} else if (msg.type === 'extract_progress') {
						extractDone = msg.done;
						extractTotal = msg.total;
						extractFound = msg.terms;
					} else if (msg.type === 'extracted') {
						extractedCount = msg.added;
						// THE PIPELINE'S AUTO-EXTRACT JUST FINISHED — MARK THE CHAPTER EXTRACTED SO THE
						// "Extract terms" CONTROL FLIPS TO "View terms" WITHOUT A RELOAD.
						if (msg.extractedAt) {
							extractedAt = msg.extractedAt;
							if (view) view.extractedAt = msg.extractedAt;
						}
					} else if (msg.type === 'meta') {
						matched = msg.matched;
						phase = msg.cached ? 'cached' : 'translating';
					} else if (msg.type === 'done') {
						usage = msg.usage;
						cached = msg.cached;
						matched = msg.matched;
						phase = 'done';
						if (!msg.cached && usage) runningCost += usage.costUsd;
						if (view) view.contentTarget = enText;
					} else if (msg.type === 'error') {
						throw new Error(msg.message);
					}
				}
			}
		} catch (e) {
			// NAVIGATED AWAY MID-STREAM → SILENT (THE SERVER JOB STILL FINISHES + SAVES)
			if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
			phase = 'error';
			toast.error(e instanceof Error ? e.message : 'Translation failed.');
		} finally {
			// ONLY THE CURRENT OWNER CLEARS THE FLAGS (A SUPERSEDED RUN MUST NOT TOUCH THE NEW ONE)
			if (inflight === ctrl) {
				translating = false;
				inflight = null;
			}
		}
	}

	async function extractGlossary() {
		if (!view || extracting) return;
		extracting = true;
		const tid = toast.loading('Extracting glossary terms…');
		try {
			const res = await fetch('/api/extract', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ chapterId: view.id }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'Extraction failed');
			// MARK EXTRACTED SO THE BUTTON FLIPS TO "View terms" AND WON'T RE-BILL ON THE NEXT CLICK
			extractedAt = Date.now();
			if (view) view.extractedAt = extractedAt;
			toast.success(`Found ${data.extracted} terms (+${data.added} new)`, { id: tid });
			// IF THE TERMS DIALOG IS OPEN (RE-EXTRACT FROM INSIDE IT), REFRESH THE LIST WITH THE NEW MATCHES
			if (termsOpen) await viewTerms();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Extraction failed.', { id: tid });
		} finally {
			extracting = false;
		}
	}

	// CLICK ROUTER FOR THE EXTRACT CONTROL: AN ALREADY-EXTRACTED CHAPTER OPENS THE (FREE) TERMS DIALOG;
	// AN UN-EXTRACTED ONE CONFIRMS THE BILLED EXTRACTION FIRST.
	function onExtractClick() {
		if (extractedAt) viewTerms();
		else confirmAction = 'extract';
	}

	// LOAD + SHOW THE GLOSSARY TERMS PRESENT IN THIS CHAPTER (THE SET THE TRANSLATOR USES) — NO MODEL CALL
	async function viewTerms() {
		if (!view) return;
		termsOpen = true;
		termsLoading = true;
		try {
			const res = await fetch(`/api/extract?chapterId=${view.id}`);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Could not load terms');
			const d = await res.json();
			termsUsed = d.terms ?? [];
			termsExtractedAt = d.extractedAt ?? null;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not load the chapter terms.');
			termsOpen = false;
		} finally {
			termsLoading = false;
		}
	}

	// RUN THE CONFIRMED ACTION, THEN CLEAR THE PENDING STATE (CLOSES THE DIALOG)
	function runConfirm() {
		const action = confirmAction;
		confirmAction = null;
		if (action === 'retranslate') translate(true);
		else if (action === 'extract') extractGlossary();
	}

	function cycleTheme() {
		const i = QUICK_THEMES.indexOf($settings.theme);
		const next = QUICK_THEMES[(i + 1) % QUICK_THEMES.length] ?? 'sepia';
		$settings.theme = next;
	}

	function setSidebar(collapsed: boolean) {
		sidebarCollapsed = collapsed;
		if (browser) localStorage.setItem('xianslate:sidebar', collapsed ? '1' : '0');
	}

	// READ-ALOUD VIA THE TTS ENGINE (SENTENCE-BY-SENTENCE, WITH LIVE HIGHLIGHTING)
	// HEADER BUTTON: START FROM THE TOP WHEN IDLE, ELSE PAUSE/RESUME.
	function toggleSpeak() {
		if (!tts.supported()) {
			toast.error('Text-to-speech is not supported in this browser.');
			return;
		}
		const status = $ttsState.status;
		if (status === 'playing') {
			tts.pause();
		} else if (status === 'paused') {
			tts.resume();
		} else {
			if (!spokenParas.length) {
				toast.error('Nothing to read yet — translate the chapter first.');
				return;
			}
			ttsStarted = true;
			ensureVoices();
			tts.play(0, 0);
		}
	}

	// CLICK A WORD IN A SPOKEN PARAGRAPH → READ FROM THAT SENTENCE.
	function onTtsSeek(e: CustomEvent<{ index: number; offset: number }>) {
		ttsStarted = true;
		ensureVoices();
		tts.seekToOffset(e.detail.index, e.detail.offset);
	}

	// KEEP THE SPOKEN LINE ON SCREEN — PREFER THE LIVE WORD, FALL BACK TO THE PARAGRAPH.
	function scrollToActive(paraIndex: number) {
		requestAnimationFrame(() => {
			const word = document.querySelector('.tts-word') as HTMLElement | null;
			const el = word ?? document.getElementById(`tts-p-${paraIndex}`);
			if (!el) return;
			const r = el.getBoundingClientRect();
			const vh = window.innerHeight;
			if (r.top < vh * 0.15 || r.bottom > vh * 0.85) {
				el.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
		});
	}

	function selectChapter(uuid: string) {
		tocOpen = false;
		goto(`/book/${view.bookId}/${uuid}/`, { noScroll: true });
	}

	function onScroll() {
		const h = document.documentElement;
		const y = h.scrollTop;
		const max = h.scrollHeight - h.clientHeight;
		progress = max > 0 ? Math.min(100, (y / max) * 100) : 0;
		// HOW MUCH OF THE CHAPTER HAS NOW BEEN SEEN: THE FRACTION FROM THE TOP DOWN TO THE VIEWPORT'S BOTTOM.
		// REACHES 1 AT THE END (AND IMMEDIATELY FOR A CHAPTER THAT FITS ON ONE SCREEN). MONOTONIC — ONLY GROWS.
		const seen = h.scrollHeight > 0 ? Math.min(1, (y + h.clientHeight) / h.scrollHeight) : 0;
		if (!restoringScroll && seen > chapterMax) {
			chapterMax = seen;
			scheduleProgressSave();
		}
		// IMMERSIVE READING (MOBILE): HIDE THE BARS WHEN SCROLLING DOWN INTO THE TEXT, REVEAL ON SCROLL-UP.
		// SKIP WHILE RESTORING A SAVED POSITION OR WHILE READ-ALOUD IS DRIVING THE SCROLL.
		if (!restoringScroll && $ttsState.status !== 'playing') {
			const dy = y - lastScrollY;
			if (y < 120) chromeHidden = false;
			else if (dy > 8) chromeHidden = true;
			else if (dy < -8) chromeHidden = false;
		}
		lastScrollY = y;
		if (!restoringScroll) scheduleScrollSave();
	}

	// PERSIST READING PROGRESS TO THE SERVER (DEBOUNCED) — POWERS THE LISTS' "READ" CHECKMARK + PROGRESS BAR.
	function scheduleProgressSave() {
		clearTimeout(progressSaveTimer);
		progressSaveTimer = setTimeout(sendProgress, 1500);
	}

	function sendProgress() {
		if (!browser || !view) return;
		// ONLY WRITE ON A MEANINGFUL INCREASE — AVOIDS A DB WRITE ON EVERY SCROLL TICK.
		if (chapterMax <= lastSentProgress + 0.005) return;
		lastSentProgress = chapterMax;
		fetch(`/api/chapters/${view.uuid}/progress`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ progress: chapterMax }),
			keepalive: true,
		}).catch(() => {
			// BEST-EFFORT — A FAILED PROGRESS WRITE IS HARMLESS (THE NEXT SCROLL RETRIES)
		});
	}

	// FLUSH THE FINAL MAX FOR A CHAPTER WHEN LEAVING IT — sendBeacon SURVIVES NAVIGATION / TAB CLOSE.
	function flushProgress(uuid: string, p: number) {
		if (!browser || p <= lastSentProgress + 0.001) return;
		lastSentProgress = p;
		try {
			const blob = new Blob([JSON.stringify({ progress: p })], { type: 'application/json' });
			navigator.sendBeacon(`/api/chapters/${uuid}/progress`, blob);
		} catch {
			// IGNORE — BEST-EFFORT
		}
	}

	// REMEMBER HOW FAR DOWN EACH CHAPTER YOU WERE (AS A RATIO, SO IT SURVIVES FONT/LAYOUT CHANGES) AND
	// RESTORE IT ON RETURN — SO "RESUME" DROPS YOU EXACTLY WHERE YOU STOPPED, NOT JUST AT THE CHAPTER TOP.
	function scheduleScrollSave() {
		clearTimeout(scrollSaveTimer);
		scrollSaveTimer = setTimeout(() => {
			if (!browser || !view) return;
			const h = document.documentElement;
			const max = h.scrollHeight - h.clientHeight;
			const ratio = max > 0 ? h.scrollTop / max : 0;
			try {
				if (ratio > 0.01) localStorage.setItem(scrollKey(view.uuid), ratio.toFixed(4));
				else localStorage.removeItem(scrollKey(view.uuid));
			} catch {
				// IGNORE QUOTA ERRORS
			}
		}, 350);
	}

	function restoreScroll(uuid: string) {
		if (!browser) return;
		let ratio = 0;
		try {
			ratio = Number(localStorage.getItem(scrollKey(uuid)) ?? '0') || 0;
		} catch {
			ratio = 0;
		}
		restoringScroll = true;
		const done = () => {
			restoringScroll = false;
		};
		// CONTENT (AND THUS PAGE HEIGHT) MAY STILL BE SETTLING — APPLY OVER A FEW FRAMES, THEN RELEASE.
		const apply = (tries: number) => {
			if (!browser) return done();
			const h = document.documentElement;
			const max = h.scrollHeight - h.clientHeight;
			window.scrollTo(0, ratio > 0 ? ratio * max : 0);
			if (tries > 0) requestAnimationFrame(() => apply(tries - 1));
			else setTimeout(done, 60);
		};
		requestAnimationFrame(() => apply(3));
	}

	// QUICK READING-SIZE ADJUST (HEADER A− / A+ AND THE − / + KEYS); FULL CONTROL LIVES IN SETTINGS
	function bumpFont(delta: number) {
		$settings.fontSizePx = Math.min(34, Math.max(12, $settings.fontSizePx + delta));
	}

	// FLUSH READING PROGRESS WHEN THE TAB IS HIDDEN / CLOSED (THE MOST RELIABLE "I'M DONE HERE" SIGNAL).
	function onPageHide() {
		if (view) flushProgress(view.uuid, chapterMax);
	}

	function onKey(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		// LET ? CLOSE/OPEN THE CHEAT SHEET; ESC CLOSES IT
		if (e.key === '?') shortcutsOpen = !shortcutsOpen;
		else if (e.key === 'Escape' && shortcutsOpen) shortcutsOpen = false;
		else if (e.key === 'ArrowLeft' && canPrev) go('prev');
		else if (e.key === 'ArrowRight' && canNext) go('next');
		else if (e.key === 's') settingsOpen = !settingsOpen;
		else if (e.key === 'c') tocOpen = !tocOpen;
		else if (e.key === 'd') cycleTheme();
		else if (e.key === '[') setSidebar(!sidebarCollapsed);
		else if (e.key === 't') translate();
		else if (e.key === 'p') toggleSpeak();
		else if (e.key === '-' || e.key === '_') bumpFont(-1);
		else if (e.key === '+' || e.key === '=') bumpFont(1);
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		if (browser) sidebarCollapsed = localStorage.getItem('xianslate:sidebar') === '1';
		window.addEventListener('keydown', onKey);
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('pagehide', onPageHide);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') onPageHide();
		});
		ensureVoices();
		// RESTORE WHERE YOU LEFT OFF IN AN ALREADY-TRANSLATED CHAPTER (UNTRANSLATED ONES START AT THE TOP).
		if (view.contentTarget) restoreScroll(view.uuid);
		// REAL-TIME: AUTO-TRANSLATE THE INITIAL (SSR-LOADED) CHAPTER IF NOT YET TRANSLATED
		if (!view.contentTarget) translate(false);
	});
	onDestroy(() => {
		inflight?.abort();
		clearTimeout(prefetchTimer);
		clearTimeout(scrollSaveTimer);
		clearTimeout(progressSaveTimer);
		// PERSIST THE FINAL READ POSITION FOR THIS CHAPTER BEFORE THE COMPONENT GOES AWAY.
		if (view) flushProgress(view.uuid, chapterMax);
		tts.stop();
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('pagehide', onPageHide);
		}
	});
	// ON NAVIGATION TO A NEW CHAPTER, SvelteKit RE-RUNS load → SYNC LOCAL STATE FROM data
	afterNavigate(() => {
		if (data.view.uuid !== view.uuid) {
			// PERSIST THE CHAPTER WE'RE LEAVING BEFORE view SWITCHES, SO ITS "READ" STATE IS RECORDED.
			flushProgress(view.uuid, chapterMax);
			tts.stop(); // DON'T LET THE PREVIOUS CHAPTER KEEP READING INTO THE NEW ONE
			syncFromData();
			chromeHidden = false; // ALWAYS REVEAL THE BARS ON A FRESH CHAPTER
			lastScrollY = 0;
			if (view.contentTarget) restoreScroll(view.uuid);
			else window.scrollTo(0, 0);
		}
	});
</script>

<svelte:head><title>{displayTitle || 'Reader'} — Xianslate</title></svelte:head>

<!-- READER ROOT: THEME FROM LAYOUT; CONTENT SHIFTED RIGHT TO CLEAR THE FIXED SIDEBAR ON DESKTOP -->
<div class={cn('min-h-screen transition-[padding] duration-200 ease-out', !sidebarCollapsed && 'lg:pl-72')}>
	<!-- PERSISTENT CHAPTER SIDEBAR (DESKTOP) — FIXED; SLIDES OUT WHEN COLLAPSED, CONTENT SHIFTS VIA lg:pl-72 -->
	{#if view}
		<aside
			class={cn(
				'fixed left-0 top-0 z-20 hidden h-screen w-72 flex-col border-r border-black/[0.06] bg-black/[0.02] transition-transform duration-200 ease-out dark:border-white/[0.045] dark:bg-white/[0.02] lg:flex',
				sidebarCollapsed && 'lg:-translate-x-full',
			)}
		>
			<div
				class="flex shrink-0 items-center gap-1 border-b border-black/[0.06] px-2 py-2 text-sm dark:border-white/[0.045]"
			>
				<a
					href="/"
					use:ripple
					class="flex min-w-0 flex-1 items-center gap-2 px-1 font-semibold"
					title="Library"
				>
					<ArrowLeft size={15} class="shrink-0 opacity-60" /><span class="truncate">{view.bookTitle}</span>
				</a>
				<button
					use:ripple
					on:click={() => setSidebar(true)}
					class="rounded p-1 opacity-60 hover:opacity-100"
					title="Collapse ([)"
					aria-label="Collapse sidebar"><ChevronLeft size={16} /></button
				>
			</div>
			<div class="min-h-0 flex-1">
				<ChapterList
					bookId={view.bookId}
					currentUuid={view.uuid}
					on:select={(e) => selectChapter(e.detail.uuid)}
				/>
			</div>
		</aside>
	{/if}

	<!-- SCROLL PROGRESS BAR -->
	<div class="fixed inset-x-0 top-0 z-30 h-0.5 bg-transparent">
		<!-- RUNTIME-DYNAMIC PROGRESS WIDTH — CANNOT BE A TAILWIND CLASS -->
		<div class="h-full bg-sky-500 transition-[width] duration-150" style="width:{progress}%"></div>
	</div>

	<!-- STICKY TOP BAR — SLIDES AWAY ON MOBILE WHEN SCROLLING INTO THE TEXT (IMMERSIVE), STAYS ON DESKTOP -->
	<header
		class={cn(
			'sticky top-0 z-20 border-b border-black/[0.06] backdrop-blur transition-transform duration-300 ease-out dark:border-white/[0.045]',
			$settings.theme === 'light' ? 'bg-white/70' : 'bg-black/20',
			chromeHidden && '-translate-y-full sm:translate-y-0',
		)}
	>
		<!-- ALIGN HEADER WIDTH TO THE READING COLUMN -->
		<!-- RUNTIME-DYNAMIC CONTAINER STYLE: FONT STACK, FONT SIZE, AND ch-BASED MAX-WIDTH FROM SETTINGS -->
		<div class="mx-auto flex items-center gap-2 px-3 py-2.5 text-sm sm:px-6" style={containerStyle}>
			<a
				href="/"
				use:ripple
				class="shrink-0 rounded-md p-2 opacity-70 hover:opacity-100"
				title="Library"
				aria-label="Library"><ArrowLeft size={18} /></a
			>
			{#if view}<span class="min-w-0 flex-1 truncate font-medium opacity-70 sm:font-normal sm:opacity-60"
					>{view.bookTitle}</span
				>{/if}
			<!-- MOBILE: A SINGLE "MORE" BUTTON OPENS AN ACTIONS SHEET (THE FULL CLUSTER IS DESKTOP-ONLY) -->
			<button
				use:ripple
				on:click={() => (moreOpen = true)}
				class="-mr-1 shrink-0 rounded-md p-2 opacity-70 hover:opacity-100 sm:hidden"
				title="More"
				aria-label="More actions"><MoreHorizontal size={20} /></button
			>
			<div class="hidden shrink-0 items-center gap-0.5 sm:flex">
				<button
					use:ripple
					on:click={cycleTheme}
					class="rounded-md p-1.5 opacity-70 hover:opacity-100"
					title="Theme (d)"
					aria-label="Theme"
				>
					<svelte:component this={THEME_ICON[$settings.theme]} size={16} />
				</button>
				<!-- QUICK FONT SIZE (− / +); FULL TYPOGRAPHY CONTROLS LIVE IN SETTINGS -->
				<div class="hidden items-center rounded-md sm:flex">
					<button
						use:ripple
						on:click={() => bumpFont(-1)}
						disabled={$settings.fontSizePx <= 12}
						class="rounded-l-md py-1.5 pl-1.5 pr-1 opacity-70 hover:opacity-100 disabled:opacity-30"
						title="Smaller text (−)"
						aria-label="Smaller text"><Minus size={15} /></button
					>
					<button
						use:ripple
						on:click={() => bumpFont(1)}
						disabled={$settings.fontSizePx >= 34}
						class="rounded-r-md py-1.5 pl-1 pr-1.5 opacity-70 hover:opacity-100 disabled:opacity-30"
						title="Larger text (+)"
						aria-label="Larger text"><Plus size={15} /></button
					>
				</div>
				<button
					use:ripple
					on:click={() => (tocOpen = true)}
					class="rounded-md p-1.5 opacity-70 hover:opacity-100 lg:hidden"
					title="Contents (c)"
					aria-label="Contents"><Menu size={17} /></button
				>
				<button
					use:ripple
					on:click={() => setSidebar(!sidebarCollapsed)}
					class="hidden rounded-md p-1.5 opacity-70 hover:opacity-100 lg:inline-flex"
					title="Toggle chapters ([)"
					aria-label="Toggle chapters"><PanelLeftClose size={17} /></button
				>
				<!-- READ-ALOUD: ONE GROUPED CONTROL — play/pause + a caret for voice & speed settings -->
				<div
					class={cn(
						'flex items-center rounded-md',
						$ttsState.status !== 'idle' && 'bg-sky-500/10 text-sky-500',
					)}
				>
					<button
						use:ripple
						on:click={toggleSpeak}
						class={cn(
							'rounded-l-md py-1.5 pl-1.5 pr-1 hover:opacity-100',
							$ttsState.status !== 'idle' ? 'opacity-100' : 'opacity-70',
						)}
						title={$ttsState.status === 'playing'
							? 'Pause reading (p)'
							: $ttsState.status === 'paused'
								? 'Resume reading (p)'
								: 'Read aloud (p)'}
						aria-label="Read aloud"
					>
						{#if $ttsState.status === 'playing'}<Pause
								size={16}
							/>{:else if $ttsState.status === 'paused'}<Play size={16} />{:else}<Volume2
								size={16}
							/>{/if}
					</button>
					<button
						use:ripple
						on:click={() => (ttsSettingsOpen = true)}
						class="rounded-r-md py-1.5 pl-0.5 pr-1.5 opacity-60 hover:opacity-100"
						title="Voice & speed"
						aria-label="Read-aloud settings"><ChevronDown size={13} /></button
					>
				</div>
				<a
					href="/book/{view?.bookId}/manage/"
					use:ripple
					class="rounded-md p-1.5 opacity-70 hover:opacity-100"
					title="Manage chapters"
					aria-label="Manage chapters"><ListOrdered size={16} /></a
				>
				<button
					use:ripple
					on:click={() => (glossaryOpen = true)}
					class="rounded-md p-1.5 opacity-70 hover:opacity-100"
					title="Glossary"
					aria-label="Glossary"><Languages size={16} /></button
				>
				<button
					use:ripple
					on:click={() => (shortcutsOpen = true)}
					class="hidden rounded-md p-1.5 opacity-70 hover:opacity-100 sm:inline-flex"
					title="Keyboard shortcuts (?)"
					aria-label="Keyboard shortcuts"><Keyboard size={16} /></button
				>
				<button
					use:ripple
					on:click={() => (settingsOpen = true)}
					class="rounded-md p-1.5 opacity-70 hover:opacity-100"
					title="Settings (s)"
					aria-label="Settings"><SettingsIcon size={16} /></button
				>
			</div>
		</div>
	</header>

	<!-- RUNTIME-DYNAMIC CONTAINER STYLE: ch-BASED MAX-WIDTH AND FONT SETTINGS FROM SETTINGS STORE -->
	<div class="pb-bottombar mx-auto px-4 py-8 sm:px-6 sm:pb-8" style={containerStyle}>
		{#if view}
			<!-- TITLE -->
			<header class="mb-6">
				<h1 class="text-2xl font-bold leading-snug sm:text-3xl">{headingTitle}</h1>
				{#if showZhTitle}<p class="mt-1 text-sm opacity-50">{view.titleSource}</p>{/if}
				<!-- META: READING TIME + ORIGINAL SOURCE URL (WEB CHAPTERS ONLY) -->
				{#if readMinutes > 0 || view.chapterUrl}
					<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
						{#if readMinutes > 0}
							<span class="inline-flex items-center gap-1 opacity-50"><Clock size={12} /> {readMinutes} min read</span>
						{/if}
						{#if view.chapterUrl}
							<!-- LINK OUT TO THE ORIGINAL CHAPTER PAGE -->
							<a
								href={view.chapterUrl}
								target="_blank"
								rel="noopener noreferrer"
								use:ripple
								class="inline-flex min-w-0 max-w-full items-center gap-1 text-sky-600 hover:underline dark:text-sky-300"
								title={view.chapterUrl}
							>
								<ExternalLink size={12} class="shrink-0" />
								<span class="truncate">{view.chapterUrl}</span>
							</a>
						{/if}
					</div>
				{/if}
				<!-- LIVE STATE WHILE TEXT IS ALREADY STREAMING IN (THE FULL STEP CARD SHOWS BEFORE ANY TEXT) -->
				{#if translating && enParas.length > 0}
					<div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
						<TranslationStatus
							variant="chip"
							{phase}
							{matched}
							showExtract={$settings.autoExtract}
							extracted={extractedCount}
							paragraphs={totalParas}
							translatedParas={enParas.length}
						/>
					</div>
				{/if}
			</header>

			<!-- ACTION BAR -->
			<div
				class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-black/[0.06] pb-3 text-sm dark:border-white/[0.045]"
			>
				<!-- PREV CHAPTER (WIDE VIEW) — SIMPLE ARROW PINNED TO THE LEFT EDGE OF THE ACTION ROW -->
				<button
					use:ripple
					on:click={() => go('prev')}
					disabled={!canPrev || busyNav}
					class="hidden shrink-0 rounded-lg border border-black/10 p-1.5 opacity-70 transition-colors hover:opacity-100 disabled:opacity-30 dark:border-white/[0.06] sm:inline-flex"
					title="Previous chapter"
					aria-label="Previous chapter"><ChevronLeft size={16} /></button
				>
				<!-- VIEW MODE: FULL-WIDTH SEGMENTED CONTROL ON MOBILE, COMPACT INLINE ON DESKTOP -->
				<div
					class="flex w-full overflow-hidden rounded-lg border border-black/[0.12] text-xs dark:border-white/[0.08] sm:inline-flex sm:w-auto"
				>
					{#each visibleLayouts as l (l.id)}
						<button
							use:ripple
							on:click={() => ($settings.layout = l.id)}
							class={cn(
								'flex-1 px-2.5 py-1.5 transition-colors sm:flex-none sm:py-1',
								$settings.layout === l.id ? 'bg-sky-600 text-white' : 'opacity-70 hover:opacity-100',
							)}>{l.label}</button
						>
					{/each}
				</div>
				<!-- SECONDARY ACTIONS — INLINE ON DESKTOP, MOVED INTO THE "MORE" SHEET ON MOBILE -->
				<button
					use:ripple
					on:click={() => (confirmAction = 'retranslate')}
					disabled={processing}
					class="hidden items-center gap-1 opacity-70 hover:opacity-100 disabled:opacity-40 sm:inline-flex"
					title="Translate again, ignoring cache"><RefreshCw size={14} /> Re-translate</button
				>
				<button
					use:ripple
					on:click={onExtractClick}
					disabled={processing}
					class="hidden items-center gap-1 opacity-70 hover:opacity-100 disabled:opacity-40 sm:inline-flex"
					title={extractedAt
						? 'See the glossary terms in this chapter'
						: 'Scan this chapter for new glossary terms'}
				>
					<Sparkles size={14} />
					{extracting ? 'Extracting…' : extractedAt ? 'View terms' : 'Extract terms'}
				</button>
				<button
					use:ripple
					on:click={() => (glossaryOpen = true)}
					class="hidden items-center gap-1 opacity-70 hover:opacity-100 sm:inline-flex"
					><Languages size={14} /> Glossary</button
				>
				<div class="ml-auto"><CostMeter {usage} {cached} {matched} {runningCost} /></div>
				<!-- NEXT CHAPTER (WIDE VIEW) — SIMPLE ARROW PINNED TO THE RIGHT EDGE OF THE ACTION ROW -->
				<button
					use:ripple
					on:click={() => go('next')}
					disabled={!canNext || busyNav}
					class="hidden shrink-0 rounded-lg border border-black/10 p-1.5 opacity-70 transition-colors hover:opacity-100 disabled:opacity-30 dark:border-white/[0.06] sm:inline-flex"
					title="Next chapter"
					aria-label="Next chapter"><ChevronRight size={16} /></button
				>
			</div>

			<!-- PROCESSING STATE: STEP CARD + SKELETON SHOWN BEFORE THE FIRST TRANSLATED TEXT ARRIVES -->
			{#if translating && enParas.length === 0 && $settings.layout !== 'source'}
				<div class="mb-8 space-y-5">
					<TranslationStatus
						{phase}
						{matched}
						showExtract={$settings.autoExtract}
						extracted={extractedCount}
						paragraphs={totalParas}
						{chars}
						translatedParas={enParas.length}
						{extractDone}
						{extractTotal}
						{extractFound}
					/>
					<!-- SIDE-BY-SIDE SHOWS ITS SKELETON IN THE ENGLISH COLUMN INSTEAD -->
					{#if $settings.layout !== 'sidebyside'}<Skeleton lines={7} />{/if}
				</div>
			{/if}

			<!-- CONTENT -->
			<!-- RUNTIME-DYNAMIC FONT STYLE: FONT FAMILY, SIZE, LINE-HEIGHT, LETTER-SPACING, AND ALIGNMENT FROM SETTINGS -->
			<article style={fontStyle}>
				{#if $settings.layout === 'source'}
					{#each zhParas as p, i (i)}
						{#if zhSpoken}
							<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
							<p style={pStyle} id={`tts-p-${i}`}>
								<SpokenParagraph
									{...hl}
									text={p}
									index={i}
									active={ttsActive && $ttsState.paraIndex === i}
									on:seek={onTtsSeek}
								/>
							</p>
						{:else}
							<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
							<p style={pStyle}>{p}</p>
						{/if}
					{/each}
				{:else if $settings.layout === 'target'}
					<!-- EMPTY STATE IS HANDLED BY THE STEP CARD + SKELETON ABOVE -->
					{#each enParas as p, i (i)}
						{#if enSpoken}
							<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
							<p style={pStyle} id={`tts-p-${i}`}>
								<SpokenParagraph
									{...hl}
									text={p}
									index={i}
									active={ttsActive && $ttsState.paraIndex === i}
									on:seek={onTtsSeek}
								/>
							</p>
						{:else}
							<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkup() ESCAPES THEN RE-ALLOWS ONLY A BARE INLINE-TAG WHITELIST -->
							<p style={pStyle}>{@html enHtml[i]}</p>
						{/if}
					{/each}
				{:else if $settings.layout === 'interleaved'}
					<!-- PER-PARAGRAPH: EACH CHINESE PARAGRAPH FOLLOWED BY ITS ENGLISH, PAIRED BY POSITION -->
					{#each interleaved as pair (pair.i)}
						{#if pair.zh}
							<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
							<p style={pStyle} class="opacity-60">{pair.zh}</p>
						{/if}
						{#if pair.en}
							{#if enSpoken}
								<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
								<p style={pStyle} id={`tts-p-${pair.i}`}>
									<SpokenParagraph
										{...hl}
										text={pair.en}
										index={pair.i}
										active={ttsActive && $ttsState.paraIndex === pair.i}
										on:seek={onTtsSeek}
									/>
								</p>
							{:else}
								<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkup() -->
								<p style={pStyle}>{@html enHtml[pair.i] ?? ''}</p>
							{/if}
						{/if}
					{/each}
				{:else}
					<!-- BILINGUAL: EACH GRID ROW IS ONE PARAGRAPH PAIR (CHINESE | ENGLISH), TOP-ALIGNED SO
					     LINKED PARAGRAPHS START AT THE SAME POSITION. STACKS ON MOBILE. -->
					<div class="grid grid-cols-1 items-start gap-x-8 sm:grid-cols-2">
						{#each interleaved as pair (pair.i)}
							<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
							<p style={pStyle} class="opacity-70">{pair.zh ?? ''}</p>
							{#if pair.en && enSpoken}
								<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
								<p style={pStyle} id={`tts-p-${pair.i}`}>
									<SpokenParagraph
										{...hl}
										text={pair.en}
										index={pair.i}
										active={ttsActive && $ttsState.paraIndex === pair.i}
										on:seek={onTtsSeek}
									/>
								</p>
							{:else}
								<!-- RUNTIME-DYNAMIC PARAGRAPH SPACING AND INDENT FROM SETTINGS -->
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkup() -->
								<p style={pStyle}>
									{#if pair.en}{@html enHtml[pair.i] ?? ''}{/if}
								</p>
							{/if}
						{/each}
					</div>
				{/if}
			</article>

			<!-- BOTTOM NAV (DESKTOP — MOBILE USES THE FIXED THUMB BAR BELOW) -->
			<nav
				class="mt-12 hidden items-center justify-between gap-2 border-t border-black/[0.06] pt-5 dark:border-white/[0.045] sm:flex"
			>
				<button
					use:ripple
					on:click={() => go('prev')}
					disabled={!canPrev || busyNav}
					class="hover:bg-current/5 inline-flex items-center gap-1 rounded-lg border border-black/10 px-4 py-2 text-sm disabled:opacity-30 dark:border-white/[0.06]"
					><ChevronLeft size={16} /> Prev</button
				>
				<span class="text-xs opacity-50">{chLabel.kind === 'chapter' ? `#${chLabel.number}` : chapterText}</span
				>
				<button
					use:ripple
					on:click={() => go('next')}
					disabled={!canNext || busyNav}
					class="hover:bg-current/5 inline-flex items-center gap-1 rounded-lg border border-black/10 px-4 py-2 text-sm disabled:opacity-30 dark:border-white/[0.06]"
					>{busyNav ? '…' : 'Next'} <ChevronRight size={16} /></button
				>
			</nav>
		{:else}
			<p class="opacity-60">No chapter selected.</p>
		{/if}
	</div>
</div>

<!-- FIXED THUMB-REACHABLE BOTTOM BAR (MOBILE ONLY). HIDES WITH THE CHROME ON SCROLL, AND STEPS ASIDE
     FOR THE READ-ALOUD TRANSPORT BAR WHILE LISTENING. -->
{#if view}
	<nav
		class={cn(
			'bottom-bar-safe fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-black/[0.06] pt-1 backdrop-blur transition-transform duration-300 ease-out dark:border-white/[0.045] sm:hidden',
			$settings.theme === 'light' ? 'bg-white/85' : 'bg-black/40',
			(chromeHidden || $ttsState.status !== 'idle') && 'translate-y-full',
		)}
		aria-label="Reader controls"
	>
		<button
			use:ripple
			on:click={() => go('prev')}
			disabled={!canPrev || busyNav}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium opacity-80 active:opacity-100 disabled:opacity-25"
			aria-label="Previous chapter"><ChevronLeft size={22} /> Prev</button
		>
		<button
			use:ripple
			on:click={() => (tocOpen = true)}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium opacity-80 active:opacity-100"
			aria-label="Contents"><Menu size={22} /> Contents</button
		>
		<button
			use:ripple
			on:click={() => (settingsOpen = true)}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium opacity-80 active:opacity-100"
			aria-label="Reading settings"><Type size={22} /> Aa</button
		>
		<button
			use:ripple
			on:click={toggleSpeak}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium opacity-80 active:opacity-100"
			aria-label="Read aloud"><Volume2 size={22} /> Listen</button
		>
		<button
			use:ripple
			on:click={() => go('next')}
			disabled={!canNext || busyNav}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium opacity-80 active:opacity-100 disabled:opacity-25"
			aria-label="Next chapter"><ChevronRight size={22} /> {busyNav ? '…' : 'Next'}</button
		>
	</nav>
{/if}

<!-- READ-ALOUD: FLOATING TRANSPORT BAR + SETTINGS DIALOG -->
<TtsBar on:settings={() => (ttsSettingsOpen = true)} />
<TtsSettings open={ttsSettingsOpen} lang={spokenLang} on:close={() => (ttsSettingsOpen = false)} />

<!-- DRAWERS -->
<SettingsDrawer open={settingsOpen} on:close={() => (settingsOpen = false)} />
{#if view}
	<TocDrawer
		bookId={view.bookId}
		currentUuid={view.uuid}
		open={tocOpen}
		on:close={() => (tocOpen = false)}
		on:select={(e) => selectChapter(e.detail.uuid)}
	/>
{/if}

<!-- GLOSSARY DIALOG -->
<Modal
	open={glossaryOpen}
	title="Book glossary"
	size="xl"
	bodyClass="flex min-h-0 flex-col overflow-hidden px-5 py-0"
	on:close={() => (glossaryOpen = false)}
>
	{#if view}
		<GlossaryPanel
			scope="book"
			bookId={view.bookId}
			bookTitle={view.bookTitle}
			surface="bg-white dark:bg-slate-900"
		/>
	{/if}
</Modal>

<!-- CONFIRM BILLED ACTIONS (RE-TRANSLATE / EXTRACT) BEFORE THEY CALL THE MODEL -->
<ConfirmDialog
	open={confirmAction !== null}
	variant="default"
	title={confirmCfg.title}
	message={confirmCfg.message}
	confirmLabel={confirmCfg.confirmLabel}
	on:confirm={runConfirm}
	on:cancel={() => (confirmAction = null)}
/>

<!-- TERMS IN THIS CHAPTER — THE GLOSSARY ENTRIES PRESENT IN THE BODY (FREE LOOKUP, NO MODEL CALL) -->
<Modal
	open={termsOpen}
	title="Terms in this chapter"
	size="lg"
	bodyClass="px-0 py-0"
	on:close={() => (termsOpen = false)}
>
	<!-- SUMMARY BAR: COUNT + RE-EXTRACT — STICKY ABOVE THE SCROLLING LIST -->
	<div
		class="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-5 py-2.5 dark:border-slate-700 dark:bg-slate-900"
	>
		<span class="text-xs opacity-60">
			{termsLoading
				? 'Loading…'
				: `${termsUsed.length} ${termsUsed.length === 1 ? 'term' : 'terms'} appear in this chapter`}
		</span>
		<!-- RE-EXTRACT IS BILLED — ROUTES THROUGH THE CONFIRM DIALOG, THEN REFRESHES THIS LIST -->
		<button
			use:ripple
			on:click={() => (confirmAction = 'extract')}
			disabled={processing}
			class="ml-auto inline-flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1 text-xs opacity-70 transition-colors hover:opacity-100 disabled:opacity-40 dark:border-white/[0.06]"
			title="Scan the chapter again for new terms (uses API credits)"
			><RefreshCw size={13} /> {extracting ? 'Extracting…' : 'Re-extract'}</button
		>
	</div>
	<!-- TERM LIST -->
	<div class="px-5 py-3">
		{#if termsLoading}
			<Skeleton lines={6} />
		{:else if termsUsed.length === 0}
			<p class="py-10 text-center text-sm opacity-50">No glossary terms appear in this chapter yet.</p>
		{:else}
			<ul class="divide-y divide-black/[0.06] dark:divide-white/[0.045]">
				{#each termsUsed as t (t.source)}
					<!-- ONE TERM: SOURCE → TARGET, OPTIONAL GENDER BADGE, CONTEXT NOTE BELOW -->
					<li class="flex flex-col gap-1 py-2.5">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span class="text-[15px] font-medium">{t.source}</span>
							<span class="opacity-30">→</span>
							<span class="text-sky-600 dark:text-sky-300">{t.target}</span>
							<!-- FLAG TERMS THIS CHAPTER'S OWN EXTRACTION ADDED (createdAt NEXT TO THIS CHAPTER'S extractedAt),
							     NOT ONES CARRIED OVER FROM EARLIER CHAPTERS -->
							{#if termsExtractedAt != null && t.createdAt != null && Math.abs(t.createdAt - termsExtractedAt) < NEW_TERM_WINDOW}
								<Badge variant="emerald">New</Badge>
							{/if}
							{#if t.gender === 'masculine'}
								<Badge variant="sky">masculine</Badge>
							{:else if t.gender === 'feminine'}
								<Badge variant="rose">feminine</Badge>
							{/if}
						</div>
						{#if t.context}<p class="text-xs leading-relaxed opacity-55">{t.context}</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	<svelte:fragment slot="footer">
		<!-- JUMP TO THE FULL, EDITABLE BOOK GLOSSARY -->
		<button
			use:ripple
			on:click={() => {
				termsOpen = false;
				glossaryOpen = true;
			}}
			class="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:underline dark:text-sky-300"
			><Languages size={13} /> Open full glossary</button
		>
	</svelte:fragment>
</Modal>

<!-- KEYBOARD SHORTCUTS CHEAT SHEET (PRESS ?) -->
<Modal open={shortcutsOpen} title="Keyboard shortcuts" size="sm" on:close={() => (shortcutsOpen = false)}>
	<ul class="flex flex-col gap-2 text-sm">
		{#each [['←  /  →', 'Previous / next chapter'], ['T', 'Translate (re-stream)'], ['P', 'Read aloud — play / pause'], ['−  /  +', 'Smaller / larger text'], ['D', 'Cycle theme'], ['S', 'Open settings'], ['C', 'Open contents'], ['[', 'Toggle the chapter sidebar'], ['?', 'Show this help']] as [keys, desc] (keys)}
			<li class="flex items-center justify-between gap-4">
				<span class="opacity-70">{desc}</span>
				<kbd
					class="shrink-0 rounded border border-black/15 bg-black/[0.04] px-2 py-0.5 font-mono text-xs dark:border-white/15 dark:bg-white/[0.06]"
					>{keys}</kbd
				>
			</li>
		{/each}
	</ul>
</Modal>

<!-- MOBILE "MORE" ACTIONS SHEET — HOUSES THE SECONDARY ACTIONS THAT ARE INLINE ON DESKTOP -->
{#if view}
	<Modal open={moreOpen} title="Actions" size="sm" on:close={() => (moreOpen = false)}>
		<div class="flex flex-col">
			<button
				use:ripple
				on:click={() => {
					moreOpen = false;
					confirmAction = 'retranslate';
				}}
				disabled={processing}
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm disabled:opacity-40"
			>
				<RefreshCw size={18} class="opacity-70" /> Re-translate
			</button>
			<button
				use:ripple
				on:click={() => {
					moreOpen = false;
					onExtractClick();
				}}
				disabled={processing}
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm disabled:opacity-40"
			>
				<Sparkles size={18} class="opacity-70" />
				{extracting ? 'Extracting…' : extractedAt ? 'View terms' : 'Extract terms'}
			</button>
			<button
				use:ripple
				on:click={() => {
					moreOpen = false;
					glossaryOpen = true;
				}}
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
			>
				<Languages size={18} class="opacity-70" /> Book glossary
			</button>
			<a
				href="/book/{view.bookId}/manage/"
				use:ripple
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
			>
				<ListOrdered size={18} class="opacity-70" /> Manage chapters
			</a>
			<button
				use:ripple
				on:click={() => {
					moreOpen = false;
					ttsSettingsOpen = true;
				}}
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
			>
				<Volume2 size={18} class="opacity-70" /> Voice &amp; speed
			</button>
		</div>
	</Modal>
{/if}
