<script lang="ts">
	// IMPORTED DEP-TYPES
	import type { TermCategory, TermDraft } from '$lib/types';
	// IMPORTED TYPES
	import type { Phase } from '$lib/components/TranslationStatus.svelte';
	import type { PageData } from './$types';
	// IMPORTED DEP-MODULES
	import { toast } from 'svelte-sonner';
	import { onDestroy, onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	// IMPORTED MODULES
	import { apiFetch } from '$lib/api';
	import { streamSse } from '$lib/sse';
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { cjkStack, latinStack } from '$lib/fonts';
	import { getLanguage, isMonolingual } from '$lib/languages';
	import {
		settings,
		THEME_BAR,
		THEME_PANEL,
		THEME_PANEL_BORDER,
		type LayoutMode,
		type Theme,
	} from '$lib/stores/settings';
	import { currentUser } from '$lib/stores/auth';
	import { isMobile } from '$lib/stores/viewport';
	import { cn } from '$lib/utils/cn';
	import { chapterLabel, stripChapterPrefix, stripLeadingTitle } from '$lib/chapter-label';
	import { renderMarkupWithTerms, renderTermsPlain } from '$lib/markup';
	import { tts } from '$lib/tts/engine';
	import { ttsSettings, ensureVoices } from '$lib/stores/tts';
	import { ripple } from '$lib/actions/ripple';
	import { scrollLock } from '$lib/actions/scrollLock';
	// IMPORTED DEP-COMPONENTS
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import BarChart3 from 'lucide-svelte/icons/bar-chart-3';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import Check from 'lucide-svelte/icons/check';
	import Circle from 'lucide-svelte/icons/circle';
	import Coffee from 'lucide-svelte/icons/coffee';
	import Contrast from 'lucide-svelte/icons/contrast';
	import Clock from 'lucide-svelte/icons/clock';
	import Copy from 'lucide-svelte/icons/copy';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Keyboard from 'lucide-svelte/icons/keyboard';
	import Languages from 'lucide-svelte/icons/languages';
	import ListOrdered from 'lucide-svelte/icons/list-ordered';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import Menu from 'lucide-svelte/icons/menu';
	import Moon from 'lucide-svelte/icons/moon';
	import MoonStar from 'lucide-svelte/icons/moon-star';
	import MoreHorizontal from 'lucide-svelte/icons/more-horizontal';
	import PanelLeftOpen from 'lucide-svelte/icons/panel-left-open';
	import Pause from 'lucide-svelte/icons/pause';
	import Play from 'lucide-svelte/icons/play';
	import Plus from 'lucide-svelte/icons/plus';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import Search from 'lucide-svelte/icons/search';
	import SettingsIcon from 'lucide-svelte/icons/settings';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Sun from 'lucide-svelte/icons/sun';
	import Type from 'lucide-svelte/icons/type';
	import Volume2 from 'lucide-svelte/icons/volume-2';
	import X from 'lucide-svelte/icons/x';
	// IMPORTED COMPONENTS
	import AccountMenu from '$lib/components/AccountMenu.svelte';
	import AddChapterDialog from '$lib/components/AddChapterDialog.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import ChapterList from '$lib/components/ChapterList.svelte';
	import ChapterStats from '$lib/components/ChapterStats.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import GlossaryPanel from '$lib/components/GlossaryPanel.svelte';
	import InkDivider from '$lib/components/ui/InkDivider.svelte';
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

	// THE NON-STANDARD (BUT WIDELY-SUPPORTED) window.find — NOT IN THE TS DOM LIB, SO WE TYPE IT OURSELVES.
	type NativeFind = (text: string, caseSensitive?: boolean, backwards?: boolean, wrapAround?: boolean) => boolean;

	// -- CONSTANTS -- //

	// HEADER THEME SWITCH CYCLES THE FULL 5-THEME SET (LIGHT GROUP → PROGRESSIVELY DARKER)
	const QUICK_THEMES: Theme[] = ['light', 'sepia', 'dark', 'oled', 'contrast'];
	const THEME_ICON = { light: Sun, sepia: Coffee, dark: Moon, oled: MoonStar, contrast: Contrast } as const;
	// CATEGORY LABEL + ACCENT (ARBITRARY HEX — NON-STANDARD PALETTE) FOR THE READER'S TERM CHIPS.
	const CATEGORY_META: Record<TermCategory, { label: string; color: string }> = {
		character: { label: 'Character', color: '#e0567a' },
		location: { label: 'Location', color: '#3aa17e' },
		organization: { label: 'Organization', color: '#a4793a' },
		technique: { label: 'Technique', color: '#6d6fe0' },
		item: { label: 'Item', color: '#c9913a' },
		realm: { label: 'Realm', color: '#9a59c9' },
		creature: { label: 'Creature', color: '#c75b3a' },
		title: { label: 'Title', color: '#3a8fc9' },
		concept: { label: 'Concept', color: '#5a8a3a' },
		other: { label: 'Other', color: '#8a8f99' },
	};
	const scrollKey = (uuid: string) => `xianslate:scroll:${uuid}`;
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
	// CHAPTER-FETCH OVERLAY: NAVIGATING TO A NEIGHBOUR THAT ISN'T IMPORTED YET (e.g. A SLOW JS-RENDER SOURCE)
	// SHOWS A FULL-SCREEN PROGRESS SCREEN INSTEAD OF FREEZING ON THE CURRENT PAGE — CANCELABLE + RETRYABLE.
	let fetchingChapter = false;
	let fetchingDir: 'prev' | 'next' = 'next';
	let fetchError = '';
	let fetchElapsed = 0; // SECONDS SINCE THE FETCH STARTED — DRIVES THE REASSURING STAGE TEXT
	let fetchTimer: ReturnType<typeof setInterval> | undefined;
	// ABORTS THE IN-FLIGHT NEIGHBOUR FETCH / NAV-REFRESH WHEN THE READER CANCELS OR STARTS ANOTHER NAVIGATION.
	let navAbort: AbortController | null = null;
	let enText = data.view.contentTarget ?? '';
	let translating = false;
	// IN-FLIGHT TRANSLATION STREAM — ABORTED WHEN NAVIGATING AWAY SO ITS DELTAS DON'T BLEED INTO THE
	// NEXT CHAPTER (THE SERVER JOB KEEPS RUNNING DETACHED AND STILL SAVES THE RESULT).
	let inflight: AbortController | null = null;
	let phase: Phase = data.view.contentTarget ? 'done' : 'idle';
	let extractedCount: number | null = null;
	let extracting = false;
	// "TERMS IN THIS CHAPTER" DIALOG — THE GLOSSARY TERMS PRESENT IN THE BODY (FREE, NO MODEL CALL)
	let termsOpen = false;
	let termsLoading = false;
	let termsUsed: TermDraft[] = [];
	// SOURCES (TERM KEYS) THAT FIRST APPEAR IN THIS CHAPTER — ABSENT FROM EVERY EARLIER CHAPTER. DRIVES THE
	// "New" BADGE. COMPUTED SERVER-SIDE BY APPEARANCE (DETERMINISTIC), NOT BY ANY EXTRACTION TIMESTAMP.
	let termsNew = new Set<string>();
	// BOLD-TERM HIGHLIGHTING (OFF BY DEFAULT, $settings.boldTerms): WHICH CHAPTER'S TERMS ARE LOADED — A FREE
	// LOOKUP SHARED WITH THE "TERMS IN THIS CHAPTER" DIALOG — PLUS THE TERM SHOWN IN THE TAP-FOR-DETAILS DIALOG.
	let termsLoadedFor: string | null = null;
	let termDetailOpen = false;
	let activeTerm: TermDraft | null = null;
	let matched = 0;
	// DETAILED PIPELINE PROGRESS (DRIVES THE STEP CARD): CHAPTER SCOPE + TERM-SCAN PROGRESS. THE
	// TRANSLATED-PARAGRAPH COUNT IS DERIVED FROM enText REACTIVELY (NO SERVER EVENT NEEDED).
	let totalParas = 0;
	let chars = 0;
	let extractDone = 0;
	let extractTotal = 0;
	let extractFound = 0;
	// RE-EXTRACT PROGRESS DIALOG — STREAMS chunk X/Y + A LIVE FOUND COUNT FROM /api/extract (SSE).
	let extractOpen = false;
	let extractPhase: 'scanning' | 'done' | 'error' = 'scanning';
	let extractAdded = 0;
	let extractError = '';
	let extractToken = 0; // SUPERSEDES A RUNNING SCAN'S UI UPDATES ON NAVIGATION
	// WHICH BILLED ACTION IS AWAITING CONFIRMATION (null = NO DIALOG OPEN)
	let confirmAction: 'retranslate' | 'extract' | null = null;
	let settingsOpen = false;
	let glossaryOpen = false;
	let statsOpen = false;
	let tocOpen = false;
	let ttsSettingsOpen = false;
	// ONCE THE READER HAS USED TTS, RENDER THE SPOKEN PARAGRAPHS AS WORD SPANS (HIGHLIGHT + CLICK-TO-SEEK)
	let ttsStarted = false;
	let progress = 0;
	let sidebarCollapsed = false;
	let shortcutsOpen = false;
	// IN-READER FIND: A LIGHTWEIGHT BAR DRIVEN BY THE NATIVE window.find() — NO MARKUP CHANGES, SO IT NEVER
	// DISTURBS THE TERM-HIGHLIGHTING / TRANSLATION RENDER. ESPECIALLY USEFUL ON MOBILE/CAPACITOR (NO BROWSER
	// FIND UI). HIDDEN ENTIRELY WHERE window.find IS UNAVAILABLE.
	let findOpen = false;
	let findQuery = '';
	let findInput: HTMLInputElement;
	let findSupported = false;
	// THE PROSE CONTAINER — REFERENCED ONLY TO COUNT MATCHES (READ-ONLY textContent).
	let articleEl: HTMLElement;
	// MOBILE: OVERFLOW ("MORE") ACTION SHEET + AUTO-HIDING CHROME FOR IMMERSIVE READING
	let moreOpen = false;
	// "ADD CHAPTER" DIALOG (PASTE / URL / EPUB / TXT) — APPENDS TO THIS BOOK FROM ANY SOURCE, NOT JUST THE
	// SCRAPED NEXT URL. LETS A READER GROW A MANUAL/IMPORTED BOOK FROM WITHIN THE READER.
	let addChapterOpen = false;
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
	// PREFETCH SERIALIZATION: A GATE THAT RESOLVES ONCE THE CURRENT CHAPTER'S GLOSSARY EXTRACTION HAS
	// SETTLED. EXTRACTION IS ADDITIVE AND SHARED PER BOOK, SO WARMING A NEIGHBOR BEFORE THIS CHAPTER'S
	// TERMS ARE PERSISTED WOULD RE-EXTRACT THE SAME NAMES INCONSISTENTLY — PREFETCH AWAITS THIS FIRST.
	let extractionGate: Promise<void> = Promise.resolve();
	// THE BOOK TITLE (TOPBAR + SIDEBAR) IS TRANSLATED LAZILY — THE LIBRARY DOES THIS, BUT A BOOK OPENED
	// STRAIGHT INTO THE READER NEVER WOULD, SO ITS NAME STAYED ON THE SOURCE TITLE UNTIL A REFRESH. REMEMBER
	// THE RESOLVED TITLE PER BOOK SO WE POST ONCE AND RE-APPLY IT ACROSS IN-BOOK CHAPTER NAVIGATION (WHERE
	// syncFromData RESETS view.bookTitle TO THE SSR VALUE, STILL THE SOURCE NAME UNTIL THE DB PERSISTS).
	let bookTitleResolved: { bookId: string; title: string } | null = null;

	// -- STORES -- //

	// READ-ALOUD ENGINE STATE (DRIVES HIGHLIGHTING + THE HEADER ICON)
	const ttsState = tts.state;

	// -- REACTIVE STATES -- //

	// THE BOOK'S LANGUAGE RECORDS — DRIVE LABELS, FONTS, TTS VOICE, AND READING-SPEED ESTIMATES.
	$: srcLang = getLanguage(view?.sourceLang);
	$: tgtLang = getLanguage(view?.targetLang);
	// "READ IN ORIGINAL" BOOKS (targetLang = 'none') ARE MONOLINGUAL: NEVER TRANSLATED, ALWAYS SHOWN AS THE
	// SOURCE TEXT, WITH THE TRANSLATE / COST / VIEW-MODE CONTROLS HIDDEN. THE APP IS THEN JUST A NICE READER.
	$: monolingual = isMonolingual(view?.targetLang);
	// THE SCRIPT DIRECTION OF WHAT'S ON SCREEN — RTL FOR ARABIC/HEBREW/URDU SO THE PROSE LAYS OUT CORRECTLY.
	$: readingDir = (monolingual || $settings.layout === 'source' ? srcLang : tgtLang).rtl ? 'rtl' : 'ltr';
	// CUT A REDUNDANT LEADING TITLE LINE FROM THE SOURCE (AND ANY ALREADY-BAKED-IN TARGET ONE)
	$: zhBody = view ? stripLeadingTitle(view.contentSource, view.titleSource) : '';
	// WHILE STREAMING, SHOW THE RAW TEXT — STRIPPING MID-STREAM WOULD MAKE THE FIRST PARAGRAPH SUDDENLY
	// VANISH THE MOMENT A SECOND ONE ARRIVES. STRIP ONCE SETTLED (CACHED/STORED TEXT IS NOT 'translating').
	// DEFENSIVE: CONVERT ANY LEFTOVER PARAGRAPH TAG (PILCROW + ITS PARAGRAPH NUMBER + ANY MANGLED BRACKET FROM
	// THE ⟦-⟯〚〛 FAMILY, e.g. THE TORTOISE-SHELL ⟬ — NUMBERED ⟦¶5⟧ OR THE LEGACY BARE ⟦¶⟧) INTO A BLANK LINE,
	// THEN SCRUB ANY STRAY BRACKET A PAST MANGLE BAKED IN WITHOUT A PILCROW — SO EXISTING CHAPTERS DISPLAY
	// CLEANLY WITHOUT A RE-TRANSLATE.
	$: enBody = (translating ? enText : stripLeadingTitle(enText, titleTarget))
		.replace(/[⟦-⟯〚〛]*¶\d*[⟦-⟯〚〛]*/gu, '\n\n')
		.replace(/[⟦-⟯〚〛]/gu, '');
	$: zhParas = zhBody ? zhBody.split(/\n{2,}/).filter(Boolean) : [];
	$: enParas = enBody ? enBody.split(/\n{2,}/).filter(Boolean) : [];
	// BOLD-TERM HIGHLIGHTING: ON ONLY WHEN THE TOGGLE IS SET AND THIS CHAPTER HAS GLOSSARY TERMS. termMap LETS
	// A TAPPED TERM LOOK UP ITS FULL DETAILS; targetTerms/sourceTerms ARE THE SURFACE STRINGS TO BOLD IN THE
	// TRANSLATION VS THE ORIGINAL TEXT (BOTH KEYED BACK TO THE TERM source).
	$: highlightOn = $settings.boldTerms && termsUsed.length > 0;
	$: termMap = new Map(termsUsed.map((t) => [t.source, t]));
	$: targetTerms = highlightOn ? termsUsed.map((t) => ({ match: t.target, id: t.source })) : [];
	$: sourceTerms = highlightOn ? termsUsed.map((t) => ({ match: t.source, id: t.source })) : [];
	// PRE-RENDER THE INLINE MARKUP (+ TERM HIGHLIGHTS) ONCE PER TEXT/TERM CHANGE. WITHOUT THIS, {@html …} IN
	// THE TEMPLATE RE-PARSES EVERY PARAGRAPH ON EVERY REACTIVE PASS (FONT-SIZE TWEAK, TTS BOUNDARY TICK, …),
	// NOT JUST WHEN THE TEXT OR TERMS ACTUALLY CHANGE. WITH THE TOGGLE OFF BOTH HELPERS FALL BACK TO PLAIN
	// MARKUP / ESCAPING (EMPTY TERM LIST), SO THE SOURCE PATH STAYS SAFE TO RENDER VIA {@html} EITHER WAY.
	$: enHtml = enParas.map((p) => renderMarkupWithTerms(p, targetTerms, tgtLang.wordDelimited));
	$: zhHtml = zhParas.map((p) => renderTermsPlain(p, sourceTerms, srcLang.wordDelimited));
	// STACKED VIEW: PAIR PARAGRAPHS BY POSITION. EXACT WHEN COUNTS MATCH; BEST-EFFORT (TAIL SHOWS
	// SOLO) WHEN THE TRANSLATION MERGED/SPLIT A FEW — STILL PER-PARAGRAPH (SOURCE THEN TARGET).
	$: interleaved = Array.from({ length: Math.max(zhParas.length, enParas.length) }, (_, i) => ({
		i,
		zh: zhParas[i] ?? null,
		en: enParas[i] ?? null,
	}));
	// ON THE ORIGINAL (SOURCE-ONLY) VIEW, SHOW THE RAW TITLE; OTHERWISE PREFER THE TRANSLATED TITLE.
	$: displayTitle = stripChapterPrefix(
		monolingual || $settings.layout === 'source' ? view?.titleSource || '' : titleTarget || view?.titleSource || '',
	);
	// HIDE THE SOURCE SUBTITLE IN THE TARGET-ONLY AND SOURCE-ONLY VIEWS (AND ALWAYS FOR MONOLINGUAL BOOKS)
	$: showZhTitle =
		!monolingual &&
		!!titleTarget &&
		$settings.layout !== 'source' &&
		$settings.layout !== 'target' &&
		titleTarget !== view?.titleSource;
	// SMART CHAPTER LABEL FROM THE TITLE (NOT THE ROW POSITION)
	$: chLabel = view ? chapterLabel(view.titleSource, view.titleTarget) : ({ kind: 'plain' } as const);
	// A CHAPTER COUNTS AS READ ONCE SCROLLED ~TO THE END (0.9 MATCHES THE MANAGE PAGE THRESHOLD).
	$: chapterDone = chapterMax >= 0.9;
	$: chapterText =
		chLabel.kind === 'chapter'
			? `Chapter ${chLabel.number}`
			: chLabel.kind === 'special'
				? chLabel.tag
				: `Chapter ${(view?.seq ?? 0) + 1}`;
	// CHAPTER NUMBER PREFIXED ONTO THE TITLE (E.G. "Chapter 5: The Duel"). IN THE ORIGINAL (SOURCE-ONLY)
	// VIEW — AND FOR READ-IN-ORIGINAL BOOKS — SHOW THE SOURCE TITLE VERBATIM (IT ALREADY CARRIES ITS OWN
	// "第N章" PREFIX) SO IT STAYS FULLY IN THE SOURCE LANGUAGE INSTEAD OF MIXING AN ENGLISH "Chapter N:"
	// PREFIX WITH THE ORIGINAL TITLE BODY.
	$: headingTitle =
		monolingual || $settings.layout === 'source'
			? view?.titleSource || chapterText
			: displayTitle
				? `${chapterText}: ${displayTitle}`
				: chapterText;
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
		`letter-spacing:${$settings.letterSpacingEm}em;text-align:${$settings.align};` +
		`overflow-wrap:break-word;`;
	$: pStyle = `margin-bottom:${$settings.paragraphSpacingEm}em;text-indent:${$settings.indent ? '2em' : '0'};`;
	$: readingWidthCh =
		!monolingual && $settings.layout === 'sidebyside' ? $settings.measureCh * 2 + 6 : $settings.measureCh;
	// WIDTH IS IN ch — SET THE READING FONT/SIZE ON THE SAME CONTAINER SO ch MATCHES THE ACTUAL TEXT
	$: containerStyle =
		`max-width:${readingWidthCh}ch;` +
		`font-size:${$settings.fontSizePx}px;` +
		`font-family:${latinStack($settings.latinFont)},${cjkStack($settings.cjkFont)};`;
	$: canPrev = !!(view && (view.prevUuid || view.prevUrl));
	$: canNext = !!(view && (view.nextUuid || view.nextUrl));
	// REASSURING STAGE TEXT WHILE FETCHING A NEIGHBOUR — TIME-BASED, SINCE THE SERVER FETCH IS A SINGLE CALL
	// WITH NO GRANULAR PROGRESS. LETS A SLOW JS-RENDER FETCH READ AS ACTIVE WORK, NOT A FREEZE.
	$: fetchStage =
		fetchElapsed < 2
			? 'Reaching the source site…'
			: fetchElapsed < 5
				? 'Loading the chapter page…'
				: fetchElapsed < 9
					? 'Rendering & parsing the chapter…'
					: 'Still working — this source is slow…';
	// ANY BILLED PIPELINE WORK IN FLIGHT — DISABLES THE Re-translate ACTION SO IT CAN'T RACE.
	$: processing = translating || extracting;
	// VIEW TERMS IS DISABLED ONLY WHILE THE TERM SET IS STILL BEING DETERMINED — THE PIPELINE'S PREPARE /
	// QUEUE / EXTRACT-&-MATCH STAGES (PHASES BEFORE THE 'meta' EVENT), OR A MANUAL RE-EXTRACT. ONCE TRANSLATION
	// PASSES THE TERMS STAGE AND STARTS STREAMING THE BODY THE TERMS ARE FINAL, SO IT RE-ENABLES THEN — NO NEED
	// TO WAIT FOR THE WHOLE TRANSLATION TO FINISH.
	$: termsPending =
		extracting || (translating && (phase === 'preparing' || phase === 'waiting' || phase === 'extracting'));
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
	// ENSURE THE BOOK TITLE IS TRANSLATED FOR THE TOPBAR + SIDEBAR (ONCE PER BOOK; THE SERVER IS IDEMPOTENT)
	$: if (browser && view) ensureBookTitle(view.bookId);
	// BOLD-TERM HIGHLIGHTING: LOAD THE CHAPTER'S GLOSSARY TERMS (FREE LOOKUP) AS SOON AS THE TOGGLE IS ON SO
	// THEY CAN BE BOLDED — RUNS ONCE PER CHAPTER (loadChapterTerms CLAIMS termsLoadedFor BEFORE awaiting).
	$: if (browser && $settings.boldTerms && view && termsLoadedFor !== view.uuid) loadChapterTerms();
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
		// ARRIVED AT THE NEW CHAPTER — TEAR DOWN ANY LINGERING FETCH OVERLAY FROM THE NAVIGATION THAT BROUGHT US.
		stopFetch();
		busyNav = false;
		view = data.view;
		enText = view.contentTarget ?? '';
		titleTarget = view.titleTarget ?? '';
		matched = 0;
		extractedCount = null;
		totalParas = 0;
		chars = 0;
		extractDone = 0;
		extractTotal = 0;
		extractFound = 0;
		// SUPERSEDE ANY IN-FLIGHT SCAN'S UI UPDATES AND CLOSE ITS DIALOG ON NAVIGATION — THE SERVER STILL
		// FINISHES + SAVES; ONLY THE LIVE UI FOR THE CHAPTER WE'RE LEAVING IS DROPPED.
		extractToken++;
		extractOpen = false;
		extracting = false;
		termsOpen = false;
		termsUsed = [];
		termsNew = new Set();
		termsLoadedFor = null;
		termDetailOpen = false;
		activeTerm = null;
		// SEED THIS CHAPTER'S READING-PROGRESS MAX FROM THE STORED VALUE SO IT NEVER REGRESSES ON REVISIT.
		clearTimeout(progressSaveTimer);
		chapterMax = view.readProgress ?? 0;
		lastSentProgress = chapterMax;
		phase = view.contentTarget ? 'done' : 'idle';
		// RESET THE EXTRACTION GATE FOR THE NEW CHAPTER — translate() BELOW REOPENS IT WHEN THIS CHAPTER WILL
		// EXTRACT; AN ALREADY-TRANSLATED CHAPTER (NO translate CALL) KEEPS THE RESOLVED GATE SO PREFETCH RUNS.
		extractionGate = Promise.resolve();
		// REAL-TIME: AUTO-TRANSLATE A CHAPTER THAT HASN'T BEEN TRANSLATED YET
		if (!view.contentTarget) translate(false);
	}

	// CHAPTER-FETCH OVERLAY CONTROLS — START THE PROGRESS SCREEN + ITS ELAPSED-TIME TICKER, STOP/RESET IT, OR
	// CANCEL THE IN-FLIGHT NAVIGATION ENTIRELY (ABORTS THE SERVER FETCH AND STAYS ON THE CURRENT CHAPTER).
	function startFetch(dir: 'prev' | 'next') {
		fetchingDir = dir;
		fetchError = '';
		fetchElapsed = 0;
		fetchingChapter = true;
		clearInterval(fetchTimer);
		fetchTimer = setInterval(() => (fetchElapsed += 1), 1000);
	}
	function stopFetch() {
		fetchingChapter = false;
		fetchError = '';
		clearInterval(fetchTimer);
	}
	function cancelFetch() {
		navAbort?.abort();
		stopFetch();
		busyNav = false;
	}
	function retryFetch() {
		go(fetchingDir);
	}

	// FETCH A NOT-YET-IMPORTED NEIGHBOUR CHAPTER, THEN NAVIGATE TO IT. THROWS ON FAILURE SO go() CAN SHOW THE
	// ERROR IN THE OVERLAY WITH A RETRY (RATHER THAN A TOAST THAT VANISHES). HONOURS THE ABORT SIGNAL.
	async function fetchByUrl(url: string, dir: 'prev' | 'next', signal?: AbortSignal) {
		const res = await apiFetch('/api/fetch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			// ANCHOR = CURRENT CHAPTER (RIGHT POSITION); targetBookId = CURRENT BOOK SO A FETCHED NEIGHBOR STAYS
			// IN THIS BOOK — INCLUDING MANUAL BOOKS BUILT FROM SCRAPED URLS.
			body: JSON.stringify({ url, fromChapterId: view?.id, dir, targetBookId: view?.bookId }),
			signal,
		});
		if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Could not fetch that chapter.');
		const v: ChapterView = await res.json();
		if (signal?.aborted) return;
		await goto(`/app/book/${v.bookId}/${v.uuid}/`, { noScroll: true });
	}

	// INTELLIGENT PREV/NEXT: RE-RESOLVE THE NEIGHBOR FROM THE SERVER AT CLICK TIME SO A CHAPTER DELETED
	// SINCE THIS PAGE LOADED IS SKIPPED — THE SERVER RETURNS THE NEAREST REMAINING CHAPTER (GAP-TOLERANT)
	// INSTEAD OF NAVIGATING INTO A 404. FALLS BACK TO THE CACHED POINTERS IF THE LOOKUP FAILS.
	async function go(dir: 'prev' | 'next') {
		if (!view || busyNav) return;
		busyNav = true;
		fetchError = '';
		// SUPERSEDE ANY PRIOR NAVIGATION AND BIND THIS ONE TO A FRESH ABORT CONTROLLER (CANCEL / RE-CLICK).
		navAbort?.abort();
		const ctrl = new AbortController();
		navAbort = ctrl;
		const signal = ctrl.signal;
		try {
			let fresh = (await getChapterView(view.uuid, signal)) ?? view;
			if (signal.aborted) return;
			let uuid = dir === 'prev' ? fresh.prevUuid : fresh.nextUuid;
			let url = dir === 'prev' ? fresh.prevUrl : fresh.nextUrl;
			// SELF-HEAL: NO KNOWN NEIGHBOR IN THIS DIRECTION ON A WEB CHAPTER → RE-READ THE SOURCE PAGE TO
			// REFRESH ITS NAV LINKS (CAN BE A SLOW JS-RENDER FETCH — SHOW THE PROGRESS OVERLAY MEANWHILE).
			// COVERS THE FORMER "LATEST" CHAPTER ONCE A NEWER ONE IS PUBLISHED AND A PREVIOUSLY MIS-SCRAPED LINK.
			if (!uuid && !url && fresh.chapterUrl) {
				startFetch(dir);
				const refreshed = await refreshNav(fresh.uuid, signal);
				if (signal.aborted) return;
				if (refreshed) {
					fresh = refreshed;
					uuid = dir === 'prev' ? fresh.prevUuid : fresh.nextUuid;
					url = dir === 'prev' ? fresh.prevUrl : fresh.nextUrl;
				}
			}
			if (uuid) {
				stopFetch();
				await goto(`/app/book/${fresh.bookId}/${uuid}/`, { noScroll: true });
			} else if (url) {
				// NOT YET IMPORTED → FETCH IT BEHIND THE PROGRESS OVERLAY, THEN NAVIGATE.
				startFetch(dir);
				await fetchByUrl(url, dir, signal);
			} else {
				stopFetch();
				toast.error(dir === 'prev' ? 'This is the first chapter.' : 'This is the last chapter.');
			}
		} catch (e) {
			// CANCELLED → SILENT. A REAL FAILURE WHILE THE OVERLAY IS UP STAYS ON-SCREEN WITH A RETRY; ELSE TOAST.
			if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
			if (fetchingChapter) {
				fetchError = e instanceof Error ? e.message : 'Could not load that chapter.';
				clearInterval(fetchTimer);
			} else {
				toast.error(e instanceof Error ? e.message : 'Could not load that chapter.');
			}
		} finally {
			busyNav = false;
			// KEEP THE OVERLAY UP ONLY TO SHOW AN ERROR + RETRY; OTHERWISE CLEAR IT.
			if (!fetchError) stopFetch();
		}
	}

	// RE-READ THE CURRENT CHAPTER'S SOURCE PAGE TO REFRESH ITS prev/next LINKS (RETURNS THE UPDATED VIEW).
	async function refreshNav(uuid: string, signal?: AbortSignal): Promise<ChapterView | null> {
		try {
			const r = await apiFetch('/api/chapter/refresh', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uuid }),
				signal,
			});
			return r.ok ? await r.json() : null;
		} catch {
			return null;
		}
	}

	// WHILE READING, QUIETLY PREPARE THE NEXT CHAPTER(S) SO 'NEXT' IS INSTANT: DOWNLOAD UPCOMING
	// CHAPTERS (AND OPTIONALLY WARM THEIR TRANSLATIONS). FIRE-AND-FORGET, BAILS IF YOU NAVIGATE AWAY.
	async function getChapterView(uuid: string, signal?: AbortSignal): Promise<ChapterView | null> {
		try {
			const r = await apiFetch(`/api/chapter?id=${uuid}`, { signal });
			return r.ok ? await r.json() : null;
		} catch {
			return null;
		}
	}

	async function fetchNeighbor(url: string, fromChapterId: number): Promise<ChapterView | null> {
		try {
			const r = await apiFetch('/api/fetch', {
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
		// STARTS THE DETACHED SERVER JOB (TRANSLATE + CACHE), THEN READS THE STREAM ONLY UNTIL THIS CHAPTER'S
		// GLOSSARY EXTRACTION HAS SETTLED BEFORE RELEASING THE CONNECTION — THE JOB FINISHES SERVER-SIDE
		// REGARDLESS. WAITING FOR EXTRACTION (NOT JUST THE FIRST BYTE) SERIALIZES TERM-BUILDING SO THE NEXT
		// PREFETCHED CHAPTER EXTRACTS AGAINST THIS ONE'S PERSISTED TERMS INSTEAD OF RACING IT. THE SIDEBAR
		// POLLS FOR THE BADGE. NOTHING TO WARM FOR A READ-IN-ORIGINAL BOOK — READ `view` DIRECTLY (NOT THE
		// LAGGING REACTIVE).
		if (!view || isMonolingual(view.targetLang)) return;
		const ctrl = new AbortController();
		try {
			// STOP AT THE FIRST SIGNAL THAT THE EXTRACT STAGE IS SETTLED: THE `extracted` EVENT, OR `meta`
			// (ALWAYS EMITTED PAST THE EXTRACT STAGE — COVERS A CACHE HIT / ALREADY-EXTRACTED CHAPTER).
			await streamSse(
				'/api/translate',
				{ chapterId, autoExtract: $settings.autoExtract, model: $settings.model },
				(msg) =>
					msg.type === 'extracted' || msg.type === 'meta' || msg.type === 'done' || msg.type === 'error'
						? 'stop'
						: undefined,
				ctrl.signal,
			);
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
			// SERIALIZE GLOSSARY EXTRACTION: DON'T WARM THE FIRST NEIGHBOR UNTIL THE CURRENT CHAPTER'S OWN
			// EXTRACTION HAS SETTLED, SO ITS NEW TERMS ARE PERSISTED BEFORE THE NEIGHBOR EXTRACTS AGAINST THEM.
			if ($settings.prefetchTranslate) await extractionGate;
			if (view?.uuid !== fromUuid) return; // NAVIGATED AWAY WHILE WAITING ON THE CURRENT EXTRACTION
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
				// WARM THIS NEIGHBOR AND WAIT FOR ITS EXTRACTION BEFORE MOVING ON, SO THE NEXT CHAPTER IN THE
				// CHAIN EXTRACTS AGAINST THIS ONE'S PERSISTED TERMS — NO PARALLEL EXTRACTION, NO TERM COLLISION.
				if ($settings.prefetchTranslate && !nextV.contentTarget) {
					await warmTranslate(nextV.id);
					if (view?.uuid !== fromUuid) return; // NAVIGATED AWAY DURING THE WARM
				}
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

	// TRANSLATE THE BOOK TITLE (NOVEL NAME) FOR THE TOPBAR + SIDEBAR THE SAME WAY THE LIBRARY DOES. THE POST IS
	// IDEMPOTENT — IT RETURNS THE STORED titleTarget WITHOUT RE-BILLING ONCE TRANSLATED — SO WE RUN IT ONCE PER
	// BOOK AND THEN KEEP view.bookTitle PINNED TO THE RESULT (syncFromData RESETS IT TO THE SSR SOURCE NAME ON
	// EACH IN-BOOK CHAPTER NAVIGATION UNTIL THE DB HAS PERSISTED THE TARGET TITLE). READ-IN-ORIGINAL BOOKS HAVE
	// NO TRANSLATION DIRECTION — READ view.targetLang DIRECTLY (THE `monolingual` REACTIVE CAN STILL BE STALE).
	async function ensureBookTitle(bookId: string) {
		if (!view || isMonolingual(view.targetLang)) return;
		// ALREADY RESOLVED THIS BOOK — JUST RE-APPLY THE TARGET TITLE IF A NAVIGATION RESET IT TO THE SOURCE NAME
		if (bookTitleResolved?.bookId === bookId) {
			if (view.bookTitle !== bookTitleResolved.title) view.bookTitle = bookTitleResolved.title;
			return;
		}
		// CLAIM THE BOOK BEFORE THE await SO CONCURRENT REACTIVE PASSES DON'T DOUBLE-POST
		bookTitleResolved = { bookId, title: view.bookTitle };
		try {
			const res = await apiFetch(`/api/books/${bookId}`, { method: 'POST' });
			if (!res.ok) return;
			const { titleTarget } = await res.json();
			// IGNORE A RESPONSE THAT LANDED AFTER A CROSS-BOOK NAVIGATION
			if (titleTarget && view?.bookId === bookId) {
				bookTitleResolved = { bookId, title: titleTarget };
				view.bookTitle = titleTarget;
			}
		} catch {
			// IGNORE — KEEP THE SOURCE TITLE (BEST-EFFORT)
		}
	}

	// OPEN A FRESH EXTRACTION GATE FOR A TRANSLATION RUN THAT MAY EXTRACT, RETURNING ITS RESOLVER SO THE
	// RUN SETTLES EXACTLY ITS OWN GATE (A SUPERSEDED RUN MUST NOT RESOLVE THE NEXT CHAPTER'S GATE).
	function openExtractionGate(): () => void {
		let settle: () => void = () => {};
		extractionGate = new Promise<void>((resolve) => {
			settle = () => resolve();
		});
		return settle;
	}

	async function translate(force = false) {
		// MONOLINGUAL ("READ IN ORIGINAL") BOOKS ARE NEVER TRANSLATED — GUARD EVERY ENTRY POINT (AUTO-RUN,
		// THE 't' SHORTCUT, RE-TRANSLATE) IN ONE PLACE. READ FROM `view` DIRECTLY (NOT THE REACTIVE
		// `monolingual`): syncFromData() SETS view AND CALLS translate() SYNCHRONOUSLY, BEFORE THE REACTIVE
		// PASS REFRESHES `monolingual` — SO ON A WARM CROSS-BOOK NAVIGATION THE DERIVED VALUE IS STILL STALE.
		if (!view || translating || isMonolingual(view.targetLang)) return;
		// SUPERSEDE ANY PRIOR STREAM AND BIND THIS RUN TO ITS OWN ABORT CONTROLLER
		inflight?.abort();
		const ctrl = new AbortController();
		inflight = ctrl;
		translating = true;
		// OPEN THE EXTRACTION GATE FOR THIS RUN — PREFETCH WON'T WARM A NEIGHBOR UNTIL THIS CHAPTER'S
		// GLOSSARY EXTRACTION HAS SETTLED (RELEASED ON THE `extracted`/`meta` EVENT, OR IN finally BELOW).
		const settleGate = openExtractionGate();
		phase = 'preparing';
		extractedCount = null;
		totalParas = 0;
		chars = 0;
		extractDone = 0;
		extractTotal = 0;
		extractFound = 0;
		enText = '';
		try {
			await streamSse(
				'/api/translate',
				{ chapterId: view.id, force, autoExtract: $settings.autoExtract, model: $settings.model },
				(msg) => {
					// THIS RUN WAS SUPERSEDED (USER NAVIGATED AWAY) — STOP APPLYING ITS OUTPUT
					if (ctrl.signal.aborted || inflight !== ctrl) return 'stop';
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
						// QUEUED BEHIND AN EARLIER CHAPTER'S EXTRACTION — THE LOADING CARD SHOWS "WAITING…" AND
						// AUTO-ADVANCES WHEN THE SERVER RELEASES (NO REFRESH; THE DETACHED JOB STREAMS WHEN READY).
						if (msg.stage === 'waiting') phase = 'waiting';
						else if (msg.stage === 'extracting') phase = 'extracting';
						// POST-STREAM PARAGRAPH RE-ALIGNMENT / SOURCE-LEAK REPAIR — SHOWS "ALIGNING…" SO THE FROZEN
						// LIVE COUNT (e.g. 328/330) DOESN'T LOOK STUCK WHILE THE NON-STREAMED RE-TRANSLATE RUNS.
						else if (msg.stage === 'finalizing') phase = 'finalizing';
					} else if (msg.type === 'extract_progress') {
						extractDone = msg.done;
						extractTotal = msg.total;
						extractFound = msg.terms;
					} else if (msg.type === 'extracted') {
						extractedCount = msg.added;
						// EXTRACTION FINISHED + PERSISTED — RELEASE ANY PREFETCH WARM WAITING TO EXTRACT NEXT.
						settleGate();
						// THE PIPELINE'S AUTO-EXTRACT JUST FINISHED — MARK THE CHAPTER EXTRACTED SO THE
						// "Extract terms" CONTROL FLIPS TO "View terms" WITHOUT A RELOAD.
						if (msg.extractedAt && view) view.extractedAt = msg.extractedAt;
						// AUTO-EXTRACT ADDED NEW TERMS → THE CACHED "terms in this chapter" SET (LOADED EARLY FOR
						// BOLD-TERM HIGHLIGHTING) IS NOW STALE. INVALIDATE IT SO A LATER "View terms" RE-FETCHES, AND
						// REFRESH NOW IF THE DIALOG IS OPEN OR THE TEXT IS SHOWING BOLDED TERMS — SO THE LIST AND
						// HIGHLIGHTS PICK UP THE NEW MATCHES WITHOUT A RELOAD (MIRRORS THE MANUAL extractGlossary() PATH).
						if (msg.added > 0) {
							termsLoadedFor = null;
							if (termsOpen || $settings.boldTerms) void loadChapterTerms();
						}
					} else if (msg.type === 'meta') {
						matched = msg.matched;
						// meta IS EMITTED PAST THE EXTRACT STAGE IN EVERY PATH — SETTLE THE GATE FOR CHAPTERS THAT
						// SKIP EXTRACTION (CACHE HIT / ALREADY EXTRACTED), WHERE NO `extracted` EVENT EVER ARRIVES.
						settleGate();
						phase = msg.cached ? 'cached' : 'translating';
					} else if (msg.type === 'done') {
						matched = msg.matched;
						phase = 'done';
						if (view) view.contentTarget = enText;
					} else if (msg.type === 'error') {
						throw new Error(msg.message);
					}
					return undefined;
				},
				ctrl.signal,
			);
		} catch (e) {
			// NAVIGATED AWAY MID-STREAM → SILENT (THE SERVER JOB STILL FINISHES + SAVES)
			if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
			phase = 'error';
			toast.error(e instanceof Error ? e.message : 'Translation failed.');
		} finally {
			// RELEASE THE EXTRACTION GATE NO MATTER HOW THIS RUN ENDED — A STREAM THAT ERRORS OR IS ABORTED
			// BEFORE `meta` MUST NOT LEAVE PREFETCH WAITING FOREVER. SETTLES THIS RUN'S OWN GATE ONLY.
			settleGate();
			// ONLY THE CURRENT OWNER CLEARS THE FLAGS (A SUPERSEDED RUN MUST NOT TOUCH THE NEW ONE)
			if (inflight === ctrl) {
				translating = false;
				inflight = null;
			}
		}
	}

	// RE-EXTRACT THE CHAPTER'S GLOSSARY TERMS, STREAMING LIVE PROGRESS INTO THE EXTRACT DIALOG (chunk X/Y · N
	// terms found). THE SERVER COMPLETES + SAVES EVEN IF THE READER NAVIGATES AWAY; extractToken DROPS STALE UI.
	async function extractGlossary() {
		if (!view || extracting) return;
		const token = ++extractToken;
		const chapterId = view.id;
		extracting = true;
		extractPhase = 'scanning';
		extractDone = 0;
		extractTotal = 0;
		extractFound = 0;
		extractAdded = 0;
		extractError = '';
		// CLOSE THE "Terms in this chapter" DIALOG (RE-EXTRACT IS LAUNCHED FROM IT) SO THE PROGRESS DIALOG TAKES OVER.
		termsOpen = false;
		extractOpen = true;
		try {
			await streamSse('/api/extract', { chapterId, model: $settings.model }, (msg) => {
				if (token !== extractToken) return 'stop'; // NAVIGATED AWAY — STOP UPDATING THE OLD CHAPTER'S DIALOG
				if (msg.type === 'progress') {
					extractDone = msg.done ?? 0;
					extractTotal = msg.total ?? 0;
					extractFound = msg.terms ?? 0;
				} else if (msg.type === 'done') {
					extractFound = msg.extracted ?? extractFound;
					extractAdded = msg.added ?? 0;
					extractedCount = msg.added ?? 0;
					extractPhase = 'done';
					if (msg.extractedAt && view) view.extractedAt = msg.extractedAt;
					// REFRESH THE CACHED TERM SET + HIGHLIGHTS SO THE NEW MATCHES SHOW WITHOUT A RELOAD.
					termsLoadedFor = null;
					if (termsOpen || $settings.boldTerms) void loadChapterTerms();
					return 'stop';
				} else if (msg.type === 'error') {
					throw new Error(msg.message ?? 'Extraction failed');
				}
				return undefined;
			});
		} catch (e) {
			if (token === extractToken) {
				extractPhase = 'error';
				extractError = e instanceof Error ? e.message : 'Extraction failed.';
			}
		} finally {
			if (token === extractToken) extracting = false;
		}
	}

	// LOAD THE GLOSSARY TERMS PRESENT IN THIS CHAPTER (THE SET THE TRANSLATOR USES) — A FREE LOOKUP, NO MODEL
	// CALL. SHARED BY THE "TERMS IN THIS CHAPTER" DIALOG AND THE BOLD-TERM HIGHLIGHTING; RUNS ONCE PER CHAPTER.
	async function loadChapterTerms() {
		if (!view || termsLoadedFor === view.uuid) return;
		const uuid = view.uuid;
		// CLAIM THE CHAPTER BEFORE awaiting SO CONCURRENT REACTIVE PASSES (TOGGLE + DIALOG) DON'T DOUBLE-FETCH
		termsLoadedFor = uuid;
		termsLoading = true;
		try {
			const res = await apiFetch(`/api/extract?chapterId=${view.id}`);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Could not load terms');
			const d = await res.json();
			if (view?.uuid !== uuid) return; // NAVIGATED AWAY MID-FETCH
			termsUsed = d.terms ?? [];
			termsNew = new Set(d.newSources ?? []);
		} catch (e) {
			termsLoadedFor = null; // ALLOW A RETRY
			// ONLY SURFACE THE ERROR WHEN THE DIALOG IS WAITING ON IT; THE BACKGROUND HIGHLIGHT LOAD FAILS QUIETLY
			if (termsOpen) {
				toast.error(e instanceof Error ? e.message : 'Could not load the chapter terms.');
				termsOpen = false;
			}
		} finally {
			termsLoading = false;
		}
	}

	// OPEN THE "TERMS IN THIS CHAPTER" DIALOG (LOADS LAZILY; REUSES THE CACHED SET IF ALREADY LOADED)
	function viewTerms() {
		termsOpen = true;
		loadChapterTerms();
	}

	// TAP A BOLDED TERM IN THE TEXT → SHOW ITS TRANSLATION + NOTES
	function openTermDetail(source: string | null) {
		const t = source ? termMap.get(source) : undefined;
		if (!t) return;
		activeTerm = t;
		termDetailOpen = true;
	}

	// DELEGATE CLICKS / KEYS FROM THE BOLDED TERM SPANS RENDERED INSIDE THE {@html} PROSE (THEY CAN'T HOST A
	// SVELTE use:ripple / on:click DIRECTLY). RESOLVES THE NEAREST [data-term] AND OPENS ITS DETAILS DIALOG.
	function termClicks(node: HTMLElement) {
		const open = (e: Event) => {
			const el = (e.target as HTMLElement | null)?.closest('[data-term]');
			if (!el) return;
			if (e.type === 'keydown') {
				const k = (e as KeyboardEvent).key;
				if (k !== 'Enter' && k !== ' ') return;
				e.preventDefault();
			}
			openTermDetail(el.getAttribute('data-term'));
		};
		node.addEventListener('click', open);
		node.addEventListener('keydown', open);
		return {
			destroy() {
				node.removeEventListener('click', open);
				node.removeEventListener('keydown', open);
			},
		};
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
		goto(`/app/book/${view.bookId}/${uuid}/`, { noScroll: true });
	}

	// AFTER ADDING CHAPTER(S) FROM THE READER (PASTE / URL / EPUB / TXT): JUMP TO THE FIRST NEW CHAPTER SO
	// THE READER IMMEDIATELY SHOWS IT (THE LOAD RE-RUNS AND THE SIDEBAR REFRESHES ON THE NAVIGATION).
	function onChapterAdded(e: CustomEvent<{ firstUuid: string | null; count: number }>) {
		addChapterOpen = false;
		if (e.detail.firstUuid && view) goto(`/app/book/${view.bookId}/${e.detail.firstUuid}/`, { noScroll: true });
	}

	function onScroll() {
		// WHILE A DRAWER/MODAL IS OPEN THE SCROLL-LOCK PINS THE BODY AND THE PAGE REPORTS scrollTop:0. IGNORE
		// THOSE SYNTHETIC EVENTS — OTHERWISE WE'D PERSIST "top of page" AND LOSE THE READER'S SAVED POSITION.
		if (document.documentElement.classList.contains('scroll-locked')) return;
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
		apiFetch(`/api/chapters/${view.uuid}/progress`, {
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

	// MARK THIS CHAPTER READ (→ 1) OR UNREAD (→ 0). A DIRECT, NON-MONOTONIC WRITE VIA THE BOOK READ
	// ENDPOINT (THE PER-CHAPTER PROGRESS ENDPOINT IS MONOTONIC AND CAN'T LOWER IT). RESET THE LOCAL
	// TRACKER SO IT STAYS IN SYNC AND DOES NOT IMMEDIATELY RE-RAISE A JUST-UNREAD CHAPTER.
	async function setChapterRead(read: boolean) {
		if (!view) return;
		const value = read ? 1 : 0;
		chapterMax = value;
		lastSentProgress = value;
		view.readProgress = value;
		try {
			const res = await apiFetch(`/api/books/${view.bookId}/read`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uuid: view.uuid, scope: 'this', read }),
			});
			if (!res.ok) throw new Error();
			toast.success(read ? 'Marked as read' : 'Marked as unread');
		} catch {
			toast.error('Could not update read status.');
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
				// IGNORE STORAGE ERRORS (PRIVATE MODE / QUOTA)
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
		$settings.fontSizePx = Math.min(30, Math.max(13, $settings.fontSizePx + delta));
	}

	// FLUSH READING PROGRESS WHEN THE TAB IS HIDDEN / CLOSED (THE MOST RELIABLE "I'M DONE HERE" SIGNAL).
	function onPageHide() {
		if (view) flushProgress(view.uuid, chapterMax);
	}

	// NAMED SO onDestroy CAN REMOVE IT — AN ANONYMOUS visibilitychange HANDLER WOULD LEAK (AND PIN A STALE
	// view / chapterMax CLOSURE) ON EVERY ENTER / LEAVE OF THE READER ROUTE.
	function onVisibility() {
		if (document.visibilityState === 'hidden') onPageHide();
	}

	function onKey(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		// LET ? CLOSE/OPEN THE CHEAT SHEET; ESC CLOSES IT
		if (e.key === '?') shortcutsOpen = !shortcutsOpen;
		else if (e.key === 'Escape' && shortcutsOpen) shortcutsOpen = false;
		else if (e.key === 'Escape' && findOpen) closeFind();
		else if (e.key === 'Escape' && fetchingChapter) cancelFetch();
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
		else if (e.key === '/') {
			// OPEN THE IN-READER FIND BAR (PREVENT FIREFOX'S NATIVE QUICK-FIND FROM STEALING THE KEY).
			e.preventDefault();
			openFind();
		} else if (e.key === 'y') copyChapter();
	}

	// COPY THE CHAPTER TEXT TO THE CLIPBOARD — THE TRANSLATION WHEN THERE IS ONE, ELSE THE SOURCE.
	async function copyChapter() {
		const text = !monolingual && enText.trim() ? enText : (view?.contentSource ?? '');
		if (!text.trim()) {
			toast.error('Nothing to copy yet.');
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			toast.success('Chapter copied to clipboard.');
		} catch {
			toast.error('Couldn’t copy — clipboard access was blocked.');
		}
	}

	function openFind() {
		if (!findSupported) return;
		findOpen = true;
		// FOCUS THE INPUT ONCE IT'S IN THE DOM.
		setTimeout(() => findInput?.focus(), 0);
	}

	function closeFind() {
		findOpen = false;
		findQuery = '';
		// DROP THE SELECTION window.find() LEFT BEHIND.
		window.getSelection()?.removeAllRanges();
	}

	// JUMP TO THE NEXT/PREVIOUS MATCH VIA THE NATIVE FINDER (CASE-INSENSITIVE, WRAPPING).
	function findNext(backwards = false) {
		const q = findQuery.trim();
		const find = (window as unknown as { find?: NativeFind }).find;
		if (!q || !find) return;
		if (!find(q, false, backwards, true)) toast('No matches.');
	}

	// COUNT OCCURRENCES IN THE RENDERED PROSE (READ-ONLY) FOR THE "N matches" HINT.
	function countMatches(q: string): number {
		const needle = q.trim().toLowerCase();
		if (!needle || !articleEl) return 0;
		const hay = (articleEl.textContent ?? '').toLowerCase();
		let n = 0;
		let idx = hay.indexOf(needle);
		while (idx !== -1) {
			n++;
			idx = hay.indexOf(needle, idx + needle.length);
		}
		return n;
	}

	// -- LIFECYCLES -- //

	onMount(() => {
		if (browser) sidebarCollapsed = localStorage.getItem('xianslate:sidebar') === '1';
		// FEATURE-DETECT THE NATIVE FINDER ONCE — GATES THE IN-READER FIND CONTROL.
		findSupported = typeof (window as unknown as { find?: NativeFind }).find === 'function';
		window.addEventListener('keydown', onKey);
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('pagehide', onPageHide);
		document.addEventListener('visibilitychange', onVisibility);
		ensureVoices();
		// RESTORE WHERE YOU LEFT OFF IN AN ALREADY-TRANSLATED CHAPTER (UNTRANSLATED ONES START AT THE TOP).
		if (view.contentTarget) restoreScroll(view.uuid);
		// REAL-TIME: AUTO-TRANSLATE THE INITIAL (SSR-LOADED) CHAPTER IF NOT YET TRANSLATED
		if (!view.contentTarget) translate(false);
	});
	onDestroy(() => {
		inflight?.abort();
		navAbort?.abort();
		clearInterval(fetchTimer);
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
			document.removeEventListener('visibilitychange', onVisibility);
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
			else {
				// FRESH (UNTRANSLATED) CHAPTER: JUMP TO THE TOP, BUT SUPPRESS THE PROGRESS TRACKER FOR THAT
				// SYNTHETIC SCROLL — A NOT-YET-TRANSLATED CHAPTER IS SHORT, SO `seen` WOULD HIT 1 AND MARK IT
				// FULLY READ THE INSTANT YOU OPEN IT. RELEASE ONCE THE EVENT SETTLES (MIRRORS restoreScroll).
				restoringScroll = true;
				window.scrollTo(0, 0);
				setTimeout(() => (restoringScroll = false), 60);
			}
		}
	});
</script>

<svelte:head><title>{headingTitle || 'Reader'} — Xianslate</title></svelte:head>

<!-- READER ROOT: THEME FROM LAYOUT; CONTENT SHIFTED RIGHT TO CLEAR THE FIXED SIDEBAR ON DESKTOP -->
<!-- SHOW CHAPTERS — FIXED AT THE VIEWPORT'S LEFT EDGE (DESKTOP ONLY, AND ONLY WHILE THE SIDEBAR IS COLLAPSED).
     IT LIVES IN THE THIN lg:pl-12 RAIL THE COLLAPSED LAYOUT RESERVES BELOW, AND SITS OUTSIDE THE ROOT SO THE
     pl SHIFT NEVER MOVES IT — SO IT CAN'T COLLIDE WITH THE BACK BUTTON IN THE CENTRED CONTAINER. -->
{#if view && sidebarCollapsed}
	<button
		use:ripple
		on:click={() => setSidebar(false)}
		class="fixed left-2 top-2.5 z-30 hidden rounded-md p-2 opacity-70 hover:opacity-100 lg:inline-flex"
		title="Show chapters ([)"
		aria-label="Show chapters"><PanelLeftOpen size={18} /></button
	>
{/if}
<!-- WHEN COLLAPSED, KEEP A THIN LEFT RAIL (lg:pl-12) FOR THE FIXED TOGGLE ABOVE; WHEN OPEN, CLEAR THE w-72 SIDEBAR -->
<div class={cn('min-h-screen transition-[padding] duration-200 ease-out', sidebarCollapsed ? 'lg:pl-12' : 'lg:pl-72')}>
	<!-- PERSISTENT CHAPTER SIDEBAR (DESKTOP) — FIXED; SLIDES OUT WHEN COLLAPSED, CONTENT SHIFTS VIA lg:pl-72 -->
	{#if view}
		<aside
			class={cn(
				'fixed left-0 top-0 z-20 hidden h-screen w-72 flex-col border-r border-black/[0.06] bg-black/[0.02] transition-transform duration-200 ease-out dark:border-white/[0.045] dark:bg-white/[0.02] lg:flex',
				sidebarCollapsed && 'lg:-translate-x-full',
			)}
		>
			<div
				class="flex shrink-0 items-center gap-1 border-b border-black/[0.06] px-2 py-2.5 text-sm dark:border-white/[0.045]"
			>
				<a
					href="/app/"
					use:ripple
					class="flex min-w-0 flex-1 items-center gap-2 px-1 font-semibold"
					title="Library"
				>
					<ArrowLeft size={15} class="shrink-0 opacity-60" /><span class="truncate py-0.5 leading-normal"
						>{view.bookTitle}</span
					>
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
		<div class="h-full bg-[#c0392b] transition-[width] duration-150" style="width:{progress}%"></div>
	</div>

	<!-- STICKY TOP BAR — SLIDES AWAY ON MOBILE WHEN SCROLLING INTO THE TEXT (IMMERSIVE), STAYS ON DESKTOP -->
	<header
		class={cn(
			'sticky top-0 z-20 border-b border-black/[0.06] backdrop-blur transition-transform duration-300 ease-out dark:border-white/[0.045]',
			THEME_BAR[$settings.theme],
			chromeHidden && '-translate-y-full sm:translate-y-0',
		)}
	>
		<!-- ALIGN HEADER WIDTH TO THE READING COLUMN -->
		<!-- RUNTIME-DYNAMIC CONTAINER STYLE: FONT STACK, FONT SIZE, AND ch-BASED MAX-WIDTH FROM SETTINGS -->
		<div class="mx-auto flex items-center gap-2 px-3 py-2.5 text-sm sm:px-6" style={containerStyle}>
			<a
				href="/app/"
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
				<!-- FONT SIZE LIVES IN SETTINGS NOW (THE HEADER −/+ CLASHED WITH THE "ADD CHAPTER" +); THE −/+ KEYS
				     STILL ADJUST IT. -->
				<button
					use:ripple
					on:click={() => (tocOpen = true)}
					class="rounded-md p-1.5 opacity-70 hover:opacity-100 lg:hidden"
					title="Contents (c)"
					aria-label="Contents"><Menu size={17} /></button
				>
				<!-- READ-ALOUD: ONE GROUPED CONTROL — play/pause + a caret for voice & speed settings -->
				<div
					class={cn(
						'flex items-center rounded-md',
						$ttsState.status !== 'idle' && 'bg-[#c0392b]/10 text-[#c0392b]',
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
				<button
					use:ripple
					on:click={() => (addChapterOpen = true)}
					class="rounded-md p-1.5 opacity-70 hover:opacity-100"
					title="Add chapter (paste / URL / EPUB / TXT)"
					aria-label="Add chapter"><Plus size={16} /></button
				>
				<a
					href="/app/book/{view?.bookId}/manage/"
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
					on:click={() => (statsOpen = true)}
					class="rounded-md p-1.5 opacity-70 hover:opacity-100"
					title="Chapter statistics"
					aria-label="Chapter statistics"><BarChart3 size={16} /></button
				>
				{#if findSupported}
					<button
						use:ripple
						on:click={() => (findOpen ? closeFind() : openFind())}
						class={cn(
							'rounded-md p-1.5 hover:opacity-100',
							findOpen ? 'text-[#c0392b] opacity-100' : 'opacity-70',
						)}
						title="Find in chapter (/)"
						aria-label="Find in chapter"><Search size={16} /></button
					>
				{/if}
				{#if !monolingual}
					<button
						use:ripple
						on:click={copyChapter}
						class="rounded-md p-1.5 opacity-70 hover:opacity-100"
						title="Copy translation (y)"
						aria-label="Copy translation"><Copy size={16} /></button
					>
				{/if}
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
			<!-- ACCOUNT — PLAIN PROFILE ICON OPENS THE POPOVER (SETTINGS / ADMIN / SIGN OUT) -->
			<AccountMenu user={$currentUser} plain />
		</div>
	</header>

	<!-- IN-READER FIND BAR — NATIVE window.find() UNDER THE HOOD; OPENED WITH "/" OR THE HEADER/MORE CONTROL -->
	{#if findOpen}
		<div
			role="search"
			transition:fade={{ duration: 120 }}
			class={cn(
				'fixed left-1/2 top-2.5 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-xl border px-2 py-1.5 shadow-lg',
				THEME_PANEL[$settings.theme],
				THEME_PANEL_BORDER[$settings.theme],
			)}
		>
			<Search size={15} class="ml-1 shrink-0 opacity-50" />
			<input
				bind:this={findInput}
				bind:value={findQuery}
				on:keydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						findNext(e.shiftKey);
					} else if (e.key === 'Escape') {
						e.preventDefault();
						closeFind();
					}
				}}
				type="text"
				placeholder="Find in chapter…"
				aria-label="Find in chapter"
				class="w-40 bg-transparent text-sm outline-none placeholder:opacity-40 sm:w-56"
			/>
			{#if findQuery.trim()}
				<span class="shrink-0 px-1 text-xs tabular-nums opacity-50">{countMatches(findQuery)}</span>
			{/if}
			<button
				use:ripple
				on:click={() => findNext(true)}
				class="rounded-md p-1 opacity-70 hover:opacity-100"
				aria-label="Previous match"><ChevronUp size={16} /></button
			>
			<button
				use:ripple
				on:click={() => findNext(false)}
				class="rounded-md p-1 opacity-70 hover:opacity-100"
				aria-label="Next match"><ChevronDown size={16} /></button
			>
			<button
				use:ripple
				on:click={closeFind}
				class="rounded-md p-1 opacity-70 hover:opacity-100"
				aria-label="Close find"><X size={16} /></button
			>
		</div>
	{/if}

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
							<span class="inline-flex items-center gap-1 opacity-50"
								><Clock size={12} /> {readMinutes} min read</span
							>
						{/if}
						{#if view.chapterUrl}
							<!-- LINK OUT TO THE ORIGINAL CHAPTER PAGE -->
							<a
								href={view.chapterUrl}
								target="_blank"
								rel="noopener noreferrer"
								use:ripple
								class="inline-flex min-w-0 max-w-full items-center gap-1 text-[#b23a2e] hover:underline dark:text-[#e08a63]"
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
				{#if monolingual}
					<!-- READ-IN-ORIGINAL: NO TRANSLATION CONTROLS — JUST A QUIET BADGE + PREV/NEXT -->
					<span class="inline-flex items-center gap-1.5 text-xs opacity-50"
						><BookOpen size={13} /> Reading in {srcLang.name}</span
					>
					<div class="ml-auto"></div>
				{:else}
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
									$settings.layout === l.id
										? 'bg-[#b23a2e] text-white'
										: 'opacity-70 hover:opacity-100',
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
					<!-- VIEW TERMS — FREE LOOKUP OF THE GLOSSARY TERMS IN THIS CHAPTER. NO MANUAL "EXTRACT" CONTROL:
					     THE TRANSLATE PIPELINE AUTO-EXTRACTS (RE-SCAN LIVES INSIDE THE TERMS DIALOG). DISABLED ONLY
					     WHILE THE TERMS ARE STILL BEING SCANNED / MATCHED — RE-ENABLES ONCE THE PIPELINE PASSES THAT
					     STAGE, EVEN IF THE BODY IS STILL STREAMING. -->
					<button
						use:ripple
						on:click={viewTerms}
						disabled={termsPending}
						class="hidden items-center gap-1 opacity-70 hover:opacity-100 disabled:opacity-40 sm:inline-flex"
						title={termsPending
							? 'Available once term scanning finishes'
							: 'See the glossary terms in this chapter'}><Sparkles size={14} /> View terms</button
					>
					<button
						use:ripple
						on:click={() => (glossaryOpen = true)}
						class="hidden items-center gap-1 opacity-70 hover:opacity-100 sm:inline-flex"
						><Languages size={14} /> Glossary</button
					>
					<div class="ml-auto"></div>
				{/if}
				<!-- MARK THIS CHAPTER READ / UNREAD (LIKE THE MANAGE PAGE) -->
				<button
					use:ripple
					on:click={() => setChapterRead(!chapterDone)}
					class="hidden items-center gap-1 opacity-70 hover:opacity-100 sm:inline-flex"
					title={chapterDone ? 'Mark this chapter as unread' : 'Mark this chapter as read'}
				>
					{#if chapterDone}<Circle size={14} /> Mark unread{:else}<Check size={14} /> Mark read{/if}
				</button>
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
					<!-- ONLY THE TARGET-ONLY VIEW IS BLANK WHILE TRANSLATING — STACKED AND BILINGUAL ALREADY SHOW THE
					     SOURCE TEXT BELOW, SO A SKELETON THERE JUST PUSHES IT DOWN WITH A HUGE EMPTY GAP -->
					{#if $settings.layout === 'target'}<Skeleton lines={7} />{/if}
				</div>
			{/if}

			<!-- CONTENT -->
			<!-- RUNTIME-DYNAMIC FONT STYLE: FONT FAMILY, SIZE, LINE-HEIGHT, LETTER-SPACING, AND ALIGNMENT FROM SETTINGS -->
			<article bind:this={articleEl} dir={readingDir} style={fontStyle} use:termClicks>
				{#if monolingual || $settings.layout === 'source'}
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
							<!-- ORIGINAL TEXT — GLOSSARY TERMS BOLDED + TAPPABLE WHEN ENABLED, PLAIN ESCAPED TEXT OTHERWISE -->
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderTermsPlain() ESCAPES THE TEXT; ONLY GLOSSARY-TERM SPANS ARE ADDED -->
							<p style={pStyle}>{@html zhHtml[i]}</p>
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
							<!-- ORIGINAL TEXT — GLOSSARY TERMS BOLDED WHEN ENABLED (SEE zhHtml) -->
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderTermsPlain() ESCAPES; ONLY GLOSSARY-TERM SPANS ARE ADDED -->
							<p style={pStyle} class="opacity-60">{@html zhHtml[pair.i] ?? ''}</p>
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
							<!-- ORIGINAL TEXT — GLOSSARY TERMS BOLDED WHEN ENABLED (SEE zhHtml) -->
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderTermsPlain() ESCAPES; ONLY GLOSSARY-TERM SPANS ARE ADDED -->
							<p style={pStyle} class="opacity-70">{@html zhHtml[pair.i] ?? ''}</p>
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
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkup() (empty string when this row has no translation yet) -->
								<p style={pStyle}>{@html enHtml[pair.i] ?? ''}</p>
							{/if}
						{/each}
					</div>
				{/if}
			</article>

			<!-- INK-WASH CHAPTER-END ORNAMENT (水墨) -->
			<InkDivider class="my-10" />

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
			THEME_BAR[$settings.theme],
			(chromeHidden || $ttsState.status !== 'idle') && 'translate-y-full',
		)}
		aria-label="Reader controls"
	>
		<button
			use:ripple
			on:click={() => go('prev')}
			disabled={!canPrev || busyNav}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium opacity-80 active:opacity-100 disabled:opacity-25"
			aria-label="Previous chapter"><ChevronLeft size={22} /> Prev</button
		>
		<button
			use:ripple
			on:click={() => (tocOpen = true)}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium opacity-80 active:opacity-100"
			aria-label="Contents"><Menu size={22} /> Contents</button
		>
		<button
			use:ripple
			on:click={() => (settingsOpen = true)}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium opacity-80 active:opacity-100"
			aria-label="Reading settings"><Type size={22} /> Aa</button
		>
		<button
			use:ripple
			on:click={toggleSpeak}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium opacity-80 active:opacity-100"
			aria-label="Read aloud"><Volume2 size={22} /> Listen</button
		>
		<button
			use:ripple
			on:click={() => go('next')}
			disabled={!canNext || busyNav}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium opacity-80 active:opacity-100 disabled:opacity-25"
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
	<!-- ADD A CHAPTER FROM ANY SOURCE (PASTE / URL / EPUB / TXT) WITHOUT LEAVING THE READER -->
	<AddChapterDialog
		bookId={view.bookId}
		open={addChapterOpen}
		on:close={() => (addChapterOpen = false)}
		on:added={onChapterAdded}
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
			chapterId={view.id}
			surface={THEME_PANEL[$settings.theme]}
		/>
	{/if}
</Modal>

<!-- CHAPTER STATISTICS — CONTENT METRICS, TRANSLATION COST/TOKENS, GLOSSARY, AND TIMELINE (READ-ONLY) -->
<ChapterStats open={statsOpen} uuid={view?.uuid ?? null} on:close={() => (statsOpen = false)} />

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

<!-- RE-EXTRACT PROGRESS — STREAMS LIVE SCAN PROGRESS (chunk X/Y · N terms found) FROM /api/extract (SSE) -->
<Modal open={extractOpen} title="Extract glossary terms" size="sm" on:close={() => (extractOpen = false)}>
	{#if extractPhase === 'scanning'}
		<!-- SCANNING: SPINNER + PROGRESS BAR + LIVE COUNTS -->
		<div class="flex flex-col gap-4 py-1">
			<div class="flex items-center gap-2.5 text-sm">
				<span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#c0392b] border-t-transparent"
				></span>
				<span>Scanning the chapter with DeepSeek…</span>
			</div>
			<!-- PROGRESS BAR — WIDTH IS RUNTIME-DYNAMIC (style EXCEPTION); A THIN SLIVER SHOWS BEFORE THE FIRST CHUNK -->
			<div class="h-2 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
				<div
					class="h-full rounded-full bg-[#c0392b] transition-all duration-300"
					style="width: {extractTotal > 0 ? Math.round((extractDone / extractTotal) * 100) : 8}%"
				></div>
			</div>
			<p class="text-center text-xs opacity-60">
				<span class="tabular-nums">{extractFound}</span>
				{extractFound === 1 ? 'term' : 'terms'} found
			</p>
		</div>
	{:else if extractPhase === 'done'}
		<!-- DONE -->
		<div class="flex flex-col items-center gap-2 py-3 text-center">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-lg font-bold text-emerald-600 dark:text-emerald-300"
			>
				✓
			</div>
			<p class="text-sm">
				Found <span class="font-semibold tabular-nums">{extractFound}</span>
				{extractFound === 1 ? 'term' : 'terms'} —
				<span class="font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">{extractAdded}</span> new
				added.
			</p>
			{#if extractAdded === 0}
				<p class="text-xs opacity-50">Every term in this chapter was already in your glossary.</p>
			{/if}
		</div>
	{:else}
		<!-- ERROR -->
		<div class="flex flex-col items-center gap-2 py-3 text-center">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/15 text-lg font-bold text-rose-600 dark:text-rose-300"
			>
				!
			</div>
			<p class="text-sm">{extractError}</p>
		</div>
	{/if}
	<svelte:fragment slot="footer">
		{#if extractPhase === 'scanning'}
			<span class="text-xs opacity-50">Uses API credits · may take a few seconds…</span>
		{:else if extractPhase === 'done'}
			<button
				use:ripple
				on:click={() => (extractOpen = false)}
				class="rounded-lg border border-black/10 px-3 py-1.5 text-sm transition-colors hover:bg-black/[0.03] dark:border-white/[0.08] dark:hover:bg-white/[0.04]"
				>Close</button
			>
			<button
				use:ripple
				on:click={() => {
					extractOpen = false;
					viewTerms();
				}}
				class="inline-flex items-center gap-1.5 rounded-lg bg-[#b23a2e] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#c0392b]"
				><Sparkles size={14} /> View terms</button
			>
		{:else}
			<button
				use:ripple
				on:click={() => (extractOpen = false)}
				class="rounded-lg border border-black/10 px-3 py-1.5 text-sm transition-colors hover:bg-black/[0.03] dark:border-white/[0.08] dark:hover:bg-white/[0.04]"
				>Close</button
			>
			<button
				use:ripple
				on:click={extractGlossary}
				class="inline-flex items-center gap-1.5 rounded-lg bg-[#b23a2e] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#c0392b]"
				><RefreshCw size={14} /> Try again</button
			>
		{/if}
	</svelte:fragment>
</Modal>

<!-- TERMS IN THIS CHAPTER — THE GLOSSARY ENTRIES PRESENT IN THE BODY (FREE LOOKUP, NO MODEL CALL) -->
<Modal
	open={termsOpen}
	title="Terms in this chapter"
	size="lg"
	bodyClass="px-0 py-0"
	on:close={() => (termsOpen = false)}
>
	<!-- SUMMARY BAR: COUNT + RE-EXTRACT — STICKY ABOVE THE SCROLLING LIST. OPAQUE PANEL SURFACE FROM THE
	     CENTRALISED THEME MAP (WAS A HARDCODED white / slate-900 BAR THAT IGNORED sepia/oled/contrast) -->
	<div
		class={cn(
			'sticky top-0 z-10 flex items-center gap-2 border-b px-5 py-2.5',
			THEME_PANEL[$settings.theme],
			THEME_PANEL_BORDER[$settings.theme],
		)}
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
							<!-- PINNED (HIGH-PRIORITY) MARKER -->
							{#if t.pinned}<span class="text-amber-500" title="Pinned — prioritised in translation"
									>★</span
								>{/if}
							<span class="text-[15px] font-medium">{t.source}</span>
							<span class="opacity-30">→</span>
							<span class="text-[#b23a2e] dark:text-[#e08a63]">{t.target}</span>
							<!-- CATEGORY CHIP — COLOUR IS DATA-DRIVEN PER CATEGORY (RUNTIME style EXCEPTION) -->
							{#if t.category}
								<span
									class="rounded-full border px-1.5 py-0.5 text-[11px]"
									style="color: {CATEGORY_META[t.category].color}; border-color: {CATEGORY_META[
										t.category
									].color}66;">{CATEGORY_META[t.category].label}</span
								>
							{/if}
							<!-- FLAG TERMS THAT FIRST APPEAR IN THIS CHAPTER (ABSENT FROM EVERY EARLIER CHAPTER),
							     NOT ONES CARRIED OVER FROM EARLIER CHAPTERS -->
							{#if termsNew.has(t.source)}
								<Badge variant="emerald">New</Badge>
							{/if}
							{#if t.gender === 'masculine'}
								<Badge variant="sky">Masculine</Badge>
							{:else if t.gender === 'feminine'}
								<Badge variant="rose">Feminine</Badge>
							{/if}
						</div>
						{#if t.context}<p class="text-xs leading-relaxed opacity-55">{t.context}</p>{/if}
						<!-- ALTERNATE SOURCE FORMS -->
						{#if t.aliases?.length}<p class="text-xs opacity-40">also: {t.aliases.join(', ')}</p>{/if}
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
			class="inline-flex items-center gap-1.5 text-xs text-[#b23a2e] hover:underline dark:text-[#e08a63]"
			><Languages size={13} /> Open full glossary</button
		>
	</svelte:fragment>
</Modal>

<!-- GLOSSARY TERM DETAILS — OPENED BY TAPPING A BOLDED TERM IN THE TEXT (BOLD-TERM HIGHLIGHTING) -->
<Modal open={termDetailOpen} title="Glossary term" size="sm" on:close={() => (termDetailOpen = false)}>
	{#if activeTerm}
		<div class="flex flex-col gap-3">
			<!-- SOURCE → TARGET (PINNED MARKER LEADS) -->
			<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				{#if activeTerm.pinned}<span class="text-amber-500" title="Pinned — prioritised in translation">★</span
					>{/if}
				<span class="text-lg font-semibold">{activeTerm.source}</span>
				<span class="opacity-30">→</span>
				<span class="text-lg text-[#b23a2e] dark:text-[#e08a63]">{activeTerm.target}</span>
			</div>
			<!-- BADGES: CATEGORY + NEW TO THIS CHAPTER + GENDER -->
			{#if activeTerm.category || termsNew.has(activeTerm.source) || activeTerm.gender !== 'neuter'}
				<div class="flex flex-wrap items-center gap-1.5">
					<!-- CATEGORY CHIP — COLOUR IS DATA-DRIVEN PER CATEGORY (RUNTIME style EXCEPTION) -->
					{#if activeTerm.category}
						<span
							class="rounded-full border px-2 py-0.5 text-xs"
							style="color: {CATEGORY_META[activeTerm.category].color}; border-color: {CATEGORY_META[
								activeTerm.category
							].color}66;">{CATEGORY_META[activeTerm.category].label}</span
						>
					{/if}
					{#if termsNew.has(activeTerm.source)}<Badge variant="emerald">New</Badge>{/if}
					{#if activeTerm.gender === 'masculine'}<Badge variant="sky">Masculine</Badge>
					{:else if activeTerm.gender === 'feminine'}<Badge variant="rose">Feminine</Badge>{/if}
				</div>
			{/if}
			<!-- DESCRIPTION: WHAT THE TERM IS -->
			{#if activeTerm.context}
				<p class="text-sm leading-relaxed opacity-70">{activeTerm.context}</p>
			{:else}
				<p class="text-sm opacity-40">No description yet.</p>
			{/if}
			<!-- ALTERNATE SOURCE FORMS -->
			{#if activeTerm.aliases?.length}
				<p class="text-xs opacity-50">Also appears as: {activeTerm.aliases.join(', ')}</p>
			{/if}
		</div>
	{/if}
	<svelte:fragment slot="footer">
		<!-- JUMP TO THE FULL, EDITABLE BOOK GLOSSARY -->
		<button
			use:ripple
			on:click={() => {
				termDetailOpen = false;
				glossaryOpen = true;
			}}
			class="inline-flex items-center gap-1.5 text-xs text-[#b23a2e] hover:underline dark:text-[#e08a63]"
			><Languages size={13} /> Open full glossary</button
		>
	</svelte:fragment>
</Modal>

<!-- KEYBOARD SHORTCUTS CHEAT SHEET (PRESS ?) -->
<Modal open={shortcutsOpen} title="Keyboard shortcuts" size="sm" on:close={() => (shortcutsOpen = false)}>
	<ul class="flex flex-col gap-2 text-sm">
		{#each [['←  /  →', 'Previous / next chapter'], ['T', 'Translate (re-stream)'], ['P', 'Read aloud — play / pause'], ['/', 'Find in chapter'], ['Y', 'Copy translation'], ['−  /  +', 'Smaller / larger text'], ['D', 'Cycle theme'], ['S', 'Open settings'], ['C', 'Open contents'], ['[', 'Toggle the chapter sidebar'], ['?', 'Show this help']] as [keys, desc] (keys)}
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
			{#if !monolingual}
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
						viewTerms();
					}}
					disabled={termsPending}
					class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm disabled:opacity-40"
				>
					<Sparkles size={18} class="opacity-70" /> View terms
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
			{/if}
			{#if findSupported}
				<button
					use:ripple
					on:click={() => {
						moreOpen = false;
						openFind();
					}}
					class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
				>
					<Search size={18} class="opacity-70" /> Find in chapter
				</button>
			{/if}
			{#if !monolingual}
				<button
					use:ripple
					on:click={() => {
						moreOpen = false;
						copyChapter();
					}}
					class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
				>
					<Copy size={18} class="opacity-70" /> Copy translation
				</button>
			{/if}
			<button
				use:ripple
				on:click={() => {
					moreOpen = false;
					setChapterRead(!chapterDone);
				}}
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
			>
				{#if chapterDone}<Circle size={18} class="opacity-70" /> Mark as unread{:else}<Check
						size={18}
						class="opacity-70"
					/> Mark as read{/if}
			</button>
			<button
				use:ripple
				on:click={() => {
					moreOpen = false;
					addChapterOpen = true;
				}}
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
			>
				<Plus size={18} class="opacity-70" /> Add chapter
			</button>
			<a
				href="/app/book/{view.bookId}/manage/"
				use:ripple
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
			>
				<ListOrdered size={18} class="opacity-70" /> Manage chapters
			</a>
			<button
				use:ripple
				on:click={() => {
					moreOpen = false;
					statsOpen = true;
				}}
				class="hover:bg-current/5 flex items-center gap-3 rounded-lg px-2 py-3 text-left text-sm"
			>
				<BarChart3 size={18} class="opacity-70" /> Chapter statistics
			</button>
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

<!-- TOP NAVIGATION PROGRESS BAR — A THIN ACCENT STRIP WHILE A NEIGHBOUR IS BEING RESOLVED / FETCHED, SO EVERY
     Prev/Next READS AS ACTIVE EVEN ON A FAST HOP. -->
{#if busyNav}
	<!-- THE STRIP — linear-gradient() WITH THREE STOPS CANNOT BE EXPRESSED AS A TAILWIND CLASS (SEE STYLE RULE) -->
	<div
		class="fixed inset-x-0 top-0 z-[60] h-0.5 animate-pulse"
		style="background: linear-gradient(to right, transparent, #c0392b, transparent);"
	></div>
{/if}

<!-- CHAPTER-FETCH OVERLAY — A FULL-SCREEN PROGRESS / ERROR SCREEN WHILE A NOT-YET-IMPORTED NEIGHBOUR IS
     FETCHED (CAN TAKE SECONDS ON A JS-RENDERED SOURCE). REPLACES THE OLD "FROZEN PAGE + DIMMED BUTTON" FEEL.
     use:scrollLock FREEZES THE PAGE BEHIND IT (MATCHES THE Modal DIALOG TEMPLATE — NO SCROLLABLE BODY). -->
{#if fetchingChapter}
	<div
		use:scrollLock
		role="dialog"
		aria-modal="true"
		transition:fade={{ duration: 150 }}
		class="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
	>
		<div
			class={cn(
				'w-full max-w-sm rounded-2xl border p-6 text-center shadow-2xl',
				THEME_PANEL[$settings.theme],
				THEME_PANEL_BORDER[$settings.theme],
			)}
		>
			{#if fetchError}
				<!-- FETCH FAILED — OFFER RETRY / CANCEL INSTEAD OF A VANISHING TOAST -->
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500"
				>
					<AlertTriangle size={22} />
				</div>
				<h2 class="text-base font-semibold">Couldn't load that chapter</h2>
				<p class="mt-1.5 text-sm opacity-60">{fetchError}</p>
				<div class="mt-5 flex items-center justify-center gap-2">
					<button
						use:ripple
						on:click={cancelFetch}
						class="rounded-lg border border-black/10 px-3.5 py-1.5 text-sm opacity-70 transition-colors hover:opacity-100 dark:border-white/[0.08]"
						>Cancel</button
					>
					<button
						use:ripple
						on:click={retryFetch}
						class="inline-flex items-center gap-1.5 rounded-lg bg-[#b23a2e] px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#c0392b]"
						><RefreshCw size={14} /> Try again</button
					>
				</div>
			{:else}
				<!-- FETCH IN PROGRESS — DIRECTION-AWARE TITLE + TIME-BASED STAGE TEXT + CANCEL -->
				<Loader2 size={34} class="mx-auto animate-spin text-[#c0392b]" />
				<h2 class="mt-4 text-base font-semibold">
					Loading the {fetchingDir === 'prev' ? 'previous' : 'next'} chapter…
				</h2>
				<p class="mt-1.5 text-sm opacity-60">{fetchStage}</p>
				<button
					use:ripple
					on:click={cancelFetch}
					class="mt-5 rounded-lg border border-black/10 px-3.5 py-1.5 text-xs opacity-60 transition-colors hover:opacity-100 dark:border-white/[0.08]"
					>Cancel</button
				>
			{/if}
		</div>
	</div>
{/if}
