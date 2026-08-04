// IMPORTED ENVS
import { browser } from '$app/environment';
// IMPORTED DEP-MODULES
import { writable } from 'svelte/store';
// IMPORTED MODULES
import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG } from '$lib/languages';

// -- TYPES -- //

export type Theme = 'light' | 'sepia' | 'dark' | 'oled' | 'contrast';
// READING LAYOUT: 'target' = TRANSLATION ONLY, 'source' = ORIGINAL ONLY, plus the two bilingual views.
// (THESE WERE 'en'/'zh' BEFORE THE APP BECAME LANGUAGE-AGNOSTIC — load() MIGRATES THE OLD VALUES.)
export type LayoutMode = 'sidebyside' | 'interleaved' | 'target' | 'source';
export type Align = 'left' | 'justify';

export interface ReaderSettings {
	version: number;
	latinFont: string;
	cjkFont: string;
	fontSizePx: number;
	lineHeight: number;
	letterSpacingEm: number;
	paragraphSpacingEm: number;
	measureCh: number;
	align: Align;
	indent: boolean;
	// BOLD MATCHED GLOSSARY TERMS IN THE READER, TAPPABLE FOR A DETAILS POPUP (OFF BY DEFAULT)
	boldTerms: boolean;
	theme: Theme;
	layout: LayoutMode;
	// PIPELINE: AUTO-EXTRACT + SAVE GLOSSARY TERMS ONCE PER CHAPTER BEFORE TRANSLATING
	autoExtract: boolean;
	// PREFETCH: HOW MANY UPCOMING CHAPTERS TO DOWNLOAD AHEAD WHILE READING (0 = OFF)
	prefetch: number;
	// ALSO WARM THEIR TRANSLATIONS (FRONT-LOADS DEEPSEEK COST FOR INSTANT NEXT)
	prefetchTranslate: boolean;
	// GLOBAL DEFAULT TRANSLATION DIRECTION FOR NEWLY FETCHED/IMPORTED BOOKS (PER-BOOK OVERRIDES AT CREATION)
	newBookSourceLang: string;
	newBookTargetLang: string;
	// THE GLOBAL DEEPSEEK MODEL THE TRANSLATE/EXTRACT PIPELINE USES (flash = fast/cheap, pro = best). SENT
	// WITH EVERY TRANSLATE/EXTRACT REQUEST; THE SERVER VALIDATES IT AGAINST ITS ALLOWLIST.
	model: string;
}

// CLIENT-FACING MODEL CHOICES FOR THE GLOBAL PICKER. THE IDS MIRROR THE SERVER DEFAULTS IN
// $lib/server/deepseek (resolveModel VALIDATES WHATEVER THE CLIENT SENDS, SO A STALE ID IS SAFE).
export const TRANSLATION_MODELS: { id: string; label: string; blurb: string }[] = [
	{ id: 'deepseek-v4-flash', label: 'Flash', blurb: 'Fast & economical — great for everyday reading' },
	{ id: 'deepseek-v4-pro', label: 'Pro', blurb: 'Higher-quality prose — slower, costs more' },
];

// -- CONSTANTS -- //

// BUMP version WHEN DEFAULTS CHANGE — TRIGGERS A ONE-TIME MIGRATION OF SAVED SETTINGS
export const DEFAULTS: ReaderSettings = {
	version: 6,
	latinFont: 'literata',
	cjkFont: 'noto-serif-tc',
	fontSizePx: 19,
	lineHeight: 1.85,
	letterSpacingEm: 0,
	paragraphSpacingEm: 1,
	measureCh: 90,
	align: 'left',
	indent: false,
	boldTerms: false,
	theme: 'sepia',
	layout: 'target',
	autoExtract: true,
	prefetch: 1,
	prefetchTranslate: false,
	newBookSourceLang: DEFAULT_SOURCE_LANG,
	newBookTargetLang: DEFAULT_TARGET_LANG,
	model: 'deepseek-v4-flash',
};

const KEY = 'xianslate:settings';

// COOKIE LETS THE SERVER RENDER THE CORRECT THEME ON FIRST PAINT (NO FLICKER)
export const THEME_COOKIE = 'xs_theme';

const DARK_THEMES: Theme[] = ['dark', 'oled', 'contrast'];

// SINGLE SOURCE OF TRUTH FOR THEME SURFACE COLOURS — APPLIED APP-WIDE AT THE LAYOUT ROOT
// WUXIA ART DIRECTION (SEE DESIGN_VISION.md): WARM INK ON PAPER (light/sepia) AND WARM OFF-WHITE ON WARM
// LACQUER / TRUE BLACK (dark/oled/contrast). THE OLD COOL slate-400 BODY WAS TOO LOW-CONTRAST AND TOO COLD
// FOR LONG-FORM READING — REPLACED WITH A WARM OFF-WHITE THAT READS COMFORTABLY AND PASSES AA.
export const THEME_CLASS: Record<Theme, string> = {
	light: 'bg-[#fbfaf7] text-[#2b2320]',
	sepia: 'bg-[#f4ecd8] text-[#5b4636]',
	dark: 'bg-[#13100c] text-[#d8cfc2]',
	oled: 'bg-black text-[#d8cfc2]',
	contrast: 'bg-black text-white',
};

// ROOT BACKGROUND PER THEME — KEEPS BROWSER CHROME, SCROLLBARS, AND OVERSCROLL IN SYNC
export const THEME_BG: Record<Theme, string> = {
	light: '#fbfaf7',
	sepia: '#f4ecd8',
	dark: '#13100c',
	oled: '#000000',
	contrast: '#000000',
};

// OPAQUE ELEVATED SURFACE FOR OVERLAYS (MODALS, BOTTOM SHEETS, DRAWERS). UNLIKE PAGE CARDS — WHICH USE
// TRANSLUCENT TINTS (bg-black/[0.02]) THAT LAYER OVER THE THEME BG — A FLOATING PANEL MUST BE OPAQUE (YOU
// CAN'T SEE PAGE TEXT THROUGH A DROPDOWN). SO EACH THEME GETS ITS OWN SOLID PANEL COLOUR THAT SITS ONE
// STEP ABOVE ITS PAGE BACKGROUND, PLUS A FOREGROUND TUNED FOR DIALOG CONTRAST. THIS KEEPS OVERLAYS INSIDE
// THE 5-THEME WORLD INSTEAD OF COLLAPSING TO A COLD WHITE / SLATE PLANE (SEE GUIDELINE: A COMPONENT THAT
// NEEDS ITS OWN SURFACE SHOULD PREFER THE CENTRALISED THEME MAP).
export const THEME_PANEL: Record<Theme, string> = {
	light: 'bg-white text-[#2b2320]',
	sepia: 'bg-[#fbf6ea] text-[#5b4636]',
	dark: 'bg-[#211c15] text-[#e6ded2]',
	oled: 'bg-[#0c0b0a] text-[#e6ded2]',
	contrast: 'bg-black text-white',
};

// POPOVERS / DROPDOWN MENUS — ONE ELEVATION HIGHER THAN A PANEL (THEY OFTEN OPEN ON TOP OF ONE)
export const THEME_POPOVER: Record<Theme, string> = {
	light: 'bg-white text-[#2b2320]',
	sepia: 'bg-[#fdf9f0] text-[#5b4636]',
	dark: 'bg-[#2a231a] text-[#e6ded2]',
	oled: 'bg-[#161310] text-[#e6ded2]',
	contrast: 'bg-[#050505] text-white',
};

// BORDER FOR ELEVATED OVERLAYS — A SOFT TINT ON MOST THEMES, A WARM HAIRLINE ON SEPIA, AND A BRIGHT,
// CRISP EDGE ON contrast (WHERE THE WHOLE POINT IS MAXIMUM SEPARATION).
export const THEME_PANEL_BORDER: Record<Theme, string> = {
	light: 'border-black/10',
	sepia: 'border-[#e2d4b5]',
	dark: 'border-white/10',
	oled: 'border-white/[0.12]',
	contrast: 'border-white/40',
};

// TRANSLUCENT CHROME BARS (READER TOP/BOTTOM BAR, STICKY HEADERS) — SIT OVER backdrop-blur AND THE THEME BG.
// REPLACES THE OLD BINARY `theme === 'light' ? 'bg-white/70' : 'bg-black/20'` SO sepia/oled/contrast EACH GET
// A CORRECT, IN-WORLD TINT INSTEAD OF COLLAPSING TO ONE COLD PLANE.
export const THEME_BAR: Record<Theme, string> = {
	light: 'bg-white/70',
	sepia: 'bg-[#f4ecd8]/72',
	dark: 'bg-[#13100c]/70',
	oled: 'bg-black/55',
	contrast: 'bg-black/80',
};

// BRAND PALETTE — THE WUXIA ART DIRECTION (SEE DESIGN_VISION.md). CINNABAR REPLACES THE OLD sky ACCENT.
// COMPLETE LITERAL CLASS STRINGS SO TAILWIND'S CONTENT SCANNER PICKS THEM UP FROM THIS .ts FILE.
// CINNABAR 朱砂 — THE PRIMARY ACTION ACCENT (BUTTONS, LINKS, SELECTED STATES, PROGRESS, SEALS).
export const ACCENT_SOLID = 'bg-[#b23a2e] text-white hover:bg-[#c0392b]';
// CINNABAR TEXT / ICON ACCENT — ONE STEP BRIGHTER ON THE DARK GROUP FOR CONTRAST.
export const ACCENT_TEXT = 'text-[#b23a2e] dark:text-[#e08a63]';
// CINNABAR TINTED FILL FOR ACTIVE / SELECTED PILLS.
export const ACCENT_SOFT = 'bg-[#b23a2e]/12 text-[#b23a2e] dark:text-[#e08a63]';
// CINNABAR FOCUS RING.
export const ACCENT_RING = 'focus:ring-2 focus:ring-[#b23a2e]/40';
// JADE 青 — SUCCESS / "READ" / CONSISTENT STATE.
export const JADE_TEXT = 'text-[#4f7a64] dark:text-[#83b39a]';
export const JADE_SOFT = 'bg-[#5b8a72]/14 text-[#4f7a64] dark:text-[#83b39a]';
// AGED GOLD 赤金 — PREMIUM (PROFOUND MODEL, HIGHER REALMS).
export const GOLD_TEXT = 'text-[#a97f28] dark:text-[#d8b15a]';
export const GOLD_SOFT = 'bg-[#c9a24b]/16 text-[#a97f28] dark:text-[#d8b15a]';

// -- STORES -- //

export const settings = createSettings();

// -- FUNCTIONS -- //

export function isDarkTheme(theme: Theme): boolean {
	return DARK_THEMES.includes(theme);
}

// APPLY THE THEME AT THE DOCUMENT ROOT: dark CLASS, color-scheme, AND ROOT BACKGROUND
export function applyThemeClass(theme: Theme): void {
	if (!browser) return;
	const isDark = DARK_THEMES.includes(theme);
	const root = document.documentElement;
	root.classList.toggle('dark', isDark);
	root.style.colorScheme = isDark ? 'dark' : 'light';
	root.style.backgroundColor = THEME_BG[theme];
	// KEEP THE MOBILE BROWSER CHROME (ADDRESS / STATUS BAR) IN SYNC WITH THE ACTIVE THEME — THE SSR HOOK
	// SEEDS THIS META ON FIRST PAINT; THIS UPDATES IT WHENEVER THE READER SWITCHES THEMES.
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[theme]);
}

export function resetSettings() {
	settings.set({ ...DEFAULTS });
}

// MERGE A PARSED OBJECT ONTO DEFAULTS, KEEPING ONLY KNOWN KEYS WHOSE VALUE TYPE MATCHES THE DEFAULT —
// SO STALE/REMOVED KEYS AND TYPE-CORRUPTED VALUES ARE DROPPED WHILE VALID PREFERENCES SURVIVE.
function mergeKnown(parsed: unknown): ReaderSettings {
	const out = { ...DEFAULTS };
	if (parsed && typeof parsed === 'object') {
		for (const k of Object.keys(DEFAULTS) as (keyof ReaderSettings)[]) {
			const v = (parsed as Record<string, unknown>)[k];
			if (v !== undefined && typeof v === typeof DEFAULTS[k]) (out as Record<string, unknown>)[k] = v;
		}
	}
	out.version = DEFAULTS.version;
	return out;
}

function load(): ReaderSettings {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			// MIGRATION: MERGE THE USER'S SAVED VALUES *FORWARD* ONTO THE CURRENT DEFAULTS RATHER THAN
			// DISCARDING THEM ON A version BUMP — A DEFAULTS CHANGE MUST NOT WIPE THE READER'S THEME, LAYOUT,
			// AND TYPOGRAPHY. NEW KEYS COME FROM DEFAULTS; KNOWN KEYS KEEP THE SAVED VALUE (TYPE-CHECKED).
			const merged = mergeKnown(parsed);
			// LAYOUT WAS RENAMED en→target / zh→source WHEN THE READER BECAME LANGUAGE-AGNOSTIC — REMAP A
			// SAVED LEGACY VALUE SO IT STILL SELECTS THE RIGHT VIEW.
			const legacyLayout = (parsed as { layout?: string } | null)?.layout;
			if (legacyLayout === 'en') merged.layout = 'target';
			else if (legacyLayout === 'zh') merged.layout = 'source';
			return merged;
		}
	} catch {
		// IGNORE CORRUPT STATE
	}
	return { ...DEFAULTS };
}

function createSettings() {
	const store = writable<ReaderSettings>(load());
	if (browser) {
		let prevTheme: Theme | null = null;
		store.subscribe((s) => {
			try {
				localStorage.setItem(KEY, JSON.stringify(s));
				// MIRROR THE THEME TO A COOKIE SO SSR CAN PRE-RENDER IT
				document.cookie = `${THEME_COOKIE}=${s.theme}; path=/; max-age=31536000; samesite=lax`;
			} catch {
				// IGNORE STORAGE ERRORS (PRIVATE MODE / QUOTA)
			}
			// ONLY TOUCH THE DOCUMENT ROOT WHEN THE THEME ACTUALLY CHANGED — TYPOGRAPHY/LAYOUT EDITS (THE
			// COMMON CASE) SHOULDN'T REWRITE classList/colorScheme/backgroundColor ON EVERY KEYSTROKE.
			if (s.theme !== prevTheme) {
				prevTheme = s.theme;
				applyThemeClass(s.theme);
			}
		});
	}
	return store;
}
