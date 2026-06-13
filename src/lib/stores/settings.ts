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
	version: 5,
	latinFont: 'literata',
	cjkFont: 'noto-serif-tc',
	fontSizePx: 19,
	lineHeight: 1.85,
	letterSpacingEm: 0,
	paragraphSpacingEm: 1,
	measureCh: 90,
	align: 'left',
	indent: false,
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
// SOFTER FOREGROUNDS — DARK THEMES USE MUTED SLATE (NOT PURE WHITE) TO REDUCE EYE STRAIN
export const THEME_CLASS: Record<Theme, string> = {
	light: 'bg-[#fbfaf7] text-slate-800',
	sepia: 'bg-[#f4ecd8] text-[#5b4636]',
	dark: 'bg-[#0e131c] text-slate-400',
	oled: 'bg-black text-slate-400',
	contrast: 'bg-black text-slate-100',
};

// ROOT BACKGROUND PER THEME — KEEPS BROWSER CHROME, SCROLLBARS, AND OVERSCROLL IN SYNC
export const THEME_BG: Record<Theme, string> = {
	light: '#fbfaf7',
	sepia: '#f4ecd8',
	dark: '#0e131c',
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
	light: 'bg-white text-slate-800',
	sepia: 'bg-[#fbf6ea] text-[#5b4636]',
	dark: 'bg-[#161d29] text-slate-200',
	oled: 'bg-[#0c0c0e] text-slate-200',
	contrast: 'bg-black text-white',
};

// POPOVERS / DROPDOWN MENUS — ONE ELEVATION HIGHER THAN A PANEL (THEY OFTEN OPEN ON TOP OF ONE)
export const THEME_POPOVER: Record<Theme, string> = {
	light: 'bg-white text-slate-800',
	sepia: 'bg-[#fdf9f0] text-[#5b4636]',
	dark: 'bg-[#1b2433] text-slate-200',
	oled: 'bg-[#161618] text-slate-200',
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
				// IGNORE QUOTA ERRORS
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
