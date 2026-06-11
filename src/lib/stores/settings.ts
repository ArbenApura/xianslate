// IMPORTED ENVS
import { browser } from '$app/environment';
// IMPORTED DEP-MODULES
import { writable } from 'svelte/store';

// -- TYPES -- //

export type Theme = 'light' | 'sepia' | 'dark' | 'oled' | 'contrast';
export type LayoutMode = 'sidebyside' | 'interleaved' | 'en' | 'zh';
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
}

// -- CONSTANTS -- //

// BUMP version WHEN DEFAULTS CHANGE — TRIGGERS A ONE-TIME MIGRATION OF SAVED SETTINGS
export const DEFAULTS: ReaderSettings = {
	version: 3,
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
	layout: 'en',
	autoExtract: true,
	prefetch: 1,
	prefetchTranslate: false,
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
			return mergeKnown(parsed);
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
