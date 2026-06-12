// LANGUAGE REGISTRY — THE SINGLE SOURCE OF TRUTH FOR EVERY LANGUAGE-SPECIFIC DECISION IN THE APP.
// THE TRANSLATION DIRECTION USED TO BE HARDCODED (CHINESE SOURCE → ENGLISH TARGET). IT IS NOW DATA:
// EACH BOOK STORES A sourceLang + targetLang code, AND EVERY PLACE THAT ONCE ASSUMED zh→en (PROMPTS,
// SCRIPT-LEAK REPAIR, FETCH CHARSET, FONTS, TTS, READING-TIME, GLOSSARY MATCHING) READS THE BEHAVIOUR
// OFF THIS TABLE INSTEAD. ADD A LANGUAGE = ADD A ROW HERE.
//
// THE TARGET SET COVERS THE LANGUAGES DEEPSEEK TRANSLATES WELL, GROUPED BY A QUALITY `tier`
// (1 = PRODUCTION zh/en, 2 = STRONG, 3 = USABLE) SO THE TARGET PICKER CAN RANK THEM. SOURCE AUTO-DETECTION
// ONLY DISTINGUISHES THE DENSE CJK SCRIPTS + LATIN, SO MOST OF THE NEWER ROWS ARE PRIMARILY TARGETS.

// -- TYPES -- //

// THE WRITING SYSTEM — DRIVES SCRIPT-LEAK DETECTION (DID THE MODEL LEAVE SOURCE-SCRIPT RESIDUE IN THE
// TARGET?) AND THE DEFAULT FONT SLOT. 'han'/'kana'/'hangul' ARE DENSE CJK SCRIPTS; 'latin'/'cyrillic'/
// 'greek' ARE WORD-DELIMITED ALPHABETS; 'arabic'/'hebrew' ARE RTL; THE INDIC/THAI SCRIPTS ARE ABUGIDAS.
export type Script =
	| 'han'
	| 'kana'
	| 'hangul'
	| 'latin'
	| 'cyrillic'
	| 'greek'
	| 'arabic'
	| 'hebrew'
	| 'devanagari'
	| 'bengali'
	| 'tamil'
	| 'thai';

// WHICH READING-FONT PICKER A LANGUAGE USES (THE READER KEEPS ONE CJK + ONE LATIN FONT CHOICE). NON-CJK
// SCRIPTS RIDE THE 'latin' SLOT AND FALL BACK TO THE SYSTEM FONT FOR THEIR SCRIPT.
export type FontSlot = 'cjk' | 'latin';

export interface Language {
	// BCP-47-ISH STABLE CODE STORED IN THE DB (e.g. 'zh-Hant', 'en', 'ja', 'ko').
	code: string;
	// ENGLISH DISPLAY NAME, USED IN PROMPTS AND THE UI ("Traditional Chinese").
	name: string;
	// NATIVE NAME, SHOWN AS A SECONDARY LABEL IN PICKERS ("繁體中文").
	endonym: string;
	script: Script;
	fontSlot: FontSlot;
	// HOW THE TRANSLATOR SHOULD ROMANIZE NAMES THAT HAVE NO GLOSSARY ENTRY, PHRASED FOR THE PROMPT
	// ("pinyin with no tone marks", "Hepburn romaji", "Revised Romanization"). null = ALREADY LATIN /
	// ROMANIZATION NOT MEANINGFUL AS A SOURCE.
	romanization: string | null;
	// TRUE WHEN WORDS ARE SEPARATED BY SPACES (en) — GLOSSARY MATCHING THEN REQUIRES WORD BOUNDARIES SO
	// A TERM ISN'T MATCHED INSIDE A LARGER WORD. FALSE FOR SCRIPTURA-CONTINUA CJK/THAI (SUBSTRING MATCH IS SAFE).
	wordDelimited: boolean;
	// LEGACY ENCODINGS THIS LANGUAGE'S SOURCE PAGES/FILES OFTEN USE (BEYOND UTF-8) — CONSULTED WHEN
	// DECODING A FETCHED PAGE OR AN IMPORTED FILE THAT ISN'T VALID UTF-8.
	charsetHints: string[];
	// SENT AS Accept-Language WHEN FETCHING A SOURCE PAGE IN THIS LANGUAGE.
	acceptLanguage: string;
	// BCP-47 TAG FOR THE BROWSER SpeechSynthesis VOICE.
	ttsLang: string;
	// APPROXIMATE READING SPEED — WORDS/MIN FOR wordDelimited LANGUAGES, CHARACTERS/MIN OTHERWISE.
	readUnitsPerMin: number;
	// DEEPSEEK TRANSLATION-QUALITY TIER (1 = PRODUCTION, 2 = STRONG, 3 = USABLE) — RANKS THE TARGET PICKER.
	tier: 1 | 2 | 3;
	// RIGHT-TO-LEFT SCRIPT (ARABIC/HEBREW/URDU) — THE READER SETS dir="rtl" SO THE PROSE LAYS OUT CORRECTLY.
	rtl?: boolean;
}

// -- CONSTANTS -- //

export const LANGUAGES: Record<string, Language> = {
	// ── TIER 1 — PRODUCTION (THE LANGUAGES DEEPSEEK WAS OPTIMISED AGAINST) ──
	en: {
		code: 'en',
		name: 'English',
		endonym: 'English',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'en,en-US;q=0.9',
		ttsLang: 'en-US',
		readUnitsPerMin: 220,
		tier: 1,
	},
	'zh-Hans': {
		code: 'zh-Hans',
		name: 'Simplified Chinese',
		endonym: '简体中文',
		script: 'han',
		fontSlot: 'cjk',
		romanization: 'Hanyu Pinyin with NO tone marks',
		wordDelimited: false,
		charsetHints: ['gb18030', 'big5'],
		acceptLanguage: 'zh-Hans,zh;q=0.9,en;q=0.8',
		ttsLang: 'zh-CN',
		readUnitsPerMin: 400,
		tier: 1,
	},
	'zh-Hant': {
		code: 'zh-Hant',
		name: 'Traditional Chinese',
		endonym: '繁體中文',
		script: 'han',
		fontSlot: 'cjk',
		romanization: 'Hanyu Pinyin with NO tone marks',
		wordDelimited: false,
		charsetHints: ['big5', 'gb18030'],
		acceptLanguage: 'zh-Hant,zh;q=0.9,en;q=0.8',
		ttsLang: 'zh-TW',
		readUnitsPerMin: 400,
		tier: 1,
	},

	// ── TIER 2 — STRONG (LIGHT REVIEW) ──
	ja: {
		code: 'ja',
		name: 'Japanese',
		endonym: '日本語',
		script: 'kana',
		fontSlot: 'cjk',
		romanization: 'Hepburn romaji',
		wordDelimited: false,
		charsetHints: ['shift_jis', 'euc-jp', 'iso-2022-jp'],
		acceptLanguage: 'ja,en;q=0.8',
		ttsLang: 'ja-JP',
		readUnitsPerMin: 400,
		tier: 2,
	},
	ko: {
		code: 'ko',
		name: 'Korean',
		endonym: '한국어',
		script: 'hangul',
		fontSlot: 'cjk',
		romanization: 'Revised Romanization of Korean',
		wordDelimited: true,
		charsetHints: ['euc-kr'],
		acceptLanguage: 'ko,en;q=0.8',
		ttsLang: 'ko-KR',
		readUnitsPerMin: 600,
		tier: 2,
	},
	es: {
		code: 'es',
		name: 'Spanish',
		endonym: 'Español',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'es,es-ES;q=0.9,en;q=0.8',
		ttsLang: 'es-ES',
		readUnitsPerMin: 200,
		tier: 2,
	},
	fr: {
		code: 'fr',
		name: 'French',
		endonym: 'Français',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'fr,fr-FR;q=0.9,en;q=0.8',
		ttsLang: 'fr-FR',
		readUnitsPerMin: 200,
		tier: 2,
	},
	de: {
		code: 'de',
		name: 'German',
		endonym: 'Deutsch',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'de,de-DE;q=0.9,en;q=0.8',
		ttsLang: 'de-DE',
		readUnitsPerMin: 200,
		tier: 2,
	},
	pt: {
		code: 'pt',
		name: 'Portuguese',
		endonym: 'Português',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'pt,pt-BR;q=0.9,en;q=0.8',
		ttsLang: 'pt-BR',
		readUnitsPerMin: 200,
		tier: 2,
	},
	it: {
		code: 'it',
		name: 'Italian',
		endonym: 'Italiano',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'it,it-IT;q=0.9,en;q=0.8',
		ttsLang: 'it-IT',
		readUnitsPerMin: 200,
		tier: 2,
	},
	ru: {
		code: 'ru',
		name: 'Russian',
		endonym: 'Русский',
		script: 'cyrillic',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['windows-1251', 'koi8-r'],
		acceptLanguage: 'ru,ru-RU;q=0.9,en;q=0.8',
		ttsLang: 'ru-RU',
		readUnitsPerMin: 180,
		tier: 2,
	},
	nl: {
		code: 'nl',
		name: 'Dutch',
		endonym: 'Nederlands',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'nl,nl-NL;q=0.9,en;q=0.8',
		ttsLang: 'nl-NL',
		readUnitsPerMin: 200,
		tier: 2,
	},
	pl: {
		code: 'pl',
		name: 'Polish',
		endonym: 'Polski',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['iso-8859-2', 'windows-1250'],
		acceptLanguage: 'pl,pl-PL;q=0.9,en;q=0.8',
		ttsLang: 'pl-PL',
		readUnitsPerMin: 200,
		tier: 2,
	},
	ar: {
		code: 'ar',
		name: 'Arabic',
		endonym: 'العربية',
		script: 'arabic',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['windows-1256'],
		acceptLanguage: 'ar,ar-SA;q=0.9,en;q=0.8',
		ttsLang: 'ar-SA',
		readUnitsPerMin: 180,
		tier: 2,
		rtl: true,
	},
	tr: {
		code: 'tr',
		name: 'Turkish',
		endonym: 'Türkçe',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['iso-8859-9', 'windows-1254'],
		acceptLanguage: 'tr,tr-TR;q=0.9,en;q=0.8',
		ttsLang: 'tr-TR',
		readUnitsPerMin: 200,
		tier: 2,
	},
	vi: {
		code: 'vi',
		name: 'Vietnamese',
		endonym: 'Tiếng Việt',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['windows-1258'],
		acceptLanguage: 'vi,vi-VN;q=0.9,en;q=0.8',
		ttsLang: 'vi-VN',
		readUnitsPerMin: 200,
		tier: 2,
	},
	id: {
		code: 'id',
		name: 'Indonesian',
		endonym: 'Bahasa Indonesia',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'id,id-ID;q=0.9,en;q=0.8',
		ttsLang: 'id-ID',
		readUnitsPerMin: 200,
		tier: 2,
	},
	hi: {
		code: 'hi',
		name: 'Hindi',
		endonym: 'हिन्दी',
		script: 'devanagari',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'hi,hi-IN;q=0.9,en;q=0.8',
		ttsLang: 'hi-IN',
		readUnitsPerMin: 180,
		tier: 2,
	},

	// ── TIER 3 — USABLE (VERIFY) ──
	sv: {
		code: 'sv',
		name: 'Swedish',
		endonym: 'Svenska',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'sv,sv-SE;q=0.9,en;q=0.8',
		ttsLang: 'sv-SE',
		readUnitsPerMin: 200,
		tier: 3,
	},
	nb: {
		code: 'nb',
		name: 'Norwegian',
		endonym: 'Norsk',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'nb,no;q=0.9,en;q=0.8',
		ttsLang: 'nb-NO',
		readUnitsPerMin: 200,
		tier: 3,
	},
	da: {
		code: 'da',
		name: 'Danish',
		endonym: 'Dansk',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'da,da-DK;q=0.9,en;q=0.8',
		ttsLang: 'da-DK',
		readUnitsPerMin: 200,
		tier: 3,
	},
	fi: {
		code: 'fi',
		name: 'Finnish',
		endonym: 'Suomi',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'fi,fi-FI;q=0.9,en;q=0.8',
		ttsLang: 'fi-FI',
		readUnitsPerMin: 200,
		tier: 3,
	},
	cs: {
		code: 'cs',
		name: 'Czech',
		endonym: 'Čeština',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['iso-8859-2', 'windows-1250'],
		acceptLanguage: 'cs,cs-CZ;q=0.9,en;q=0.8',
		ttsLang: 'cs-CZ',
		readUnitsPerMin: 200,
		tier: 3,
	},
	el: {
		code: 'el',
		name: 'Greek',
		endonym: 'Ελληνικά',
		script: 'greek',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['iso-8859-7', 'windows-1253'],
		acceptLanguage: 'el,el-GR;q=0.9,en;q=0.8',
		ttsLang: 'el-GR',
		readUnitsPerMin: 190,
		tier: 3,
	},
	he: {
		code: 'he',
		name: 'Hebrew',
		endonym: 'עברית',
		script: 'hebrew',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['windows-1255'],
		acceptLanguage: 'he,he-IL;q=0.9,en;q=0.8',
		ttsLang: 'he-IL',
		readUnitsPerMin: 180,
		tier: 3,
		rtl: true,
	},
	th: {
		code: 'th',
		name: 'Thai',
		endonym: 'ไทย',
		script: 'thai',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: false,
		charsetHints: ['tis-620', 'windows-874'],
		acceptLanguage: 'th,th-TH;q=0.9,en;q=0.8',
		ttsLang: 'th-TH',
		readUnitsPerMin: 350,
		tier: 3,
	},
	ms: {
		code: 'ms',
		name: 'Malay',
		endonym: 'Bahasa Melayu',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'ms,ms-MY;q=0.9,en;q=0.8',
		ttsLang: 'ms-MY',
		readUnitsPerMin: 200,
		tier: 3,
	},
	tl: {
		code: 'tl',
		name: 'Tagalog',
		endonym: 'Tagalog',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'tl,fil;q=0.9,en;q=0.8',
		ttsLang: 'fil-PH',
		readUnitsPerMin: 200,
		tier: 3,
	},
	uk: {
		code: 'uk',
		name: 'Ukrainian',
		endonym: 'Українська',
		script: 'cyrillic',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['windows-1251', 'koi8-u'],
		acceptLanguage: 'uk,uk-UA;q=0.9,en;q=0.8',
		ttsLang: 'uk-UA',
		readUnitsPerMin: 180,
		tier: 3,
	},
	ro: {
		code: 'ro',
		name: 'Romanian',
		endonym: 'Română',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['iso-8859-2'],
		acceptLanguage: 'ro,ro-RO;q=0.9,en;q=0.8',
		ttsLang: 'ro-RO',
		readUnitsPerMin: 200,
		tier: 3,
	},
	hu: {
		code: 'hu',
		name: 'Hungarian',
		endonym: 'Magyar',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['iso-8859-2'],
		acceptLanguage: 'hu,hu-HU;q=0.9,en;q=0.8',
		ttsLang: 'hu-HU',
		readUnitsPerMin: 200,
		tier: 3,
	},
	bn: {
		code: 'bn',
		name: 'Bengali',
		endonym: 'বাংলা',
		script: 'bengali',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'bn,bn-BD;q=0.9,en;q=0.8',
		ttsLang: 'bn-BD',
		readUnitsPerMin: 180,
		tier: 3,
	},
	ta: {
		code: 'ta',
		name: 'Tamil',
		endonym: 'தமிழ்',
		script: 'tamil',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'ta,ta-IN;q=0.9,en;q=0.8',
		ttsLang: 'ta-IN',
		readUnitsPerMin: 180,
		tier: 3,
	},
	ur: {
		code: 'ur',
		name: 'Urdu',
		endonym: 'اردو',
		script: 'arabic',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: ['windows-1256'],
		acceptLanguage: 'ur,ur-PK;q=0.9,en;q=0.8',
		ttsLang: 'ur-PK',
		readUnitsPerMin: 180,
		tier: 3,
		rtl: true,
	},
	sw: {
		code: 'sw',
		name: 'Swahili',
		endonym: 'Kiswahili',
		script: 'latin',
		fontSlot: 'latin',
		romanization: null,
		wordDelimited: true,
		charsetHints: [],
		acceptLanguage: 'sw,sw-KE;q=0.9,en;q=0.8',
		ttsLang: 'sw-KE',
		readUnitsPerMin: 200,
		tier: 3,
	},
};

// THE LANGUAGE PAIR EVERY PRE-EXISTING BOOK/GLOSSARY ROW IS BACKFILLED TO DURING MIGRATION — THE APP'S
// ORIGINAL HARDCODED DIRECTION. ALSO THE FACTORY DEFAULT FOR THE "NEW BOOK" GLOBAL PREFERENCE.
export const DEFAULT_SOURCE_LANG = 'zh-Hant';
export const DEFAULT_TARGET_LANG = 'en';

// THE SENTINEL TARGET FOR "DON'T TRANSLATE — READ IN THE ORIGINAL". A BOOK WHOSE targetLang IS THIS IS
// MONOLINGUAL: THE READER SHOWS THE SOURCE TEXT AS-IS, NEVER AUTO-TRANSLATES, AND HIDES THE COST/TRANSLATE
// CONTROLS. LETS THE APP DOUBLE AS A PREMIUM PLAIN READER FOR BOOKS THE USER CAN ALREADY READ.
export const NO_TRANSLATION = 'none';

// -- FUNCTIONS -- //

// RESOLVE A CODE TO ITS Language, FALLING BACK TO THE DEFAULTS SO A STALE/UNKNOWN CODE NEVER THROWS.
export function getLanguage(code: string | null | undefined): Language {
	return (code && LANGUAGES[code]) || LANGUAGES[DEFAULT_SOURCE_LANG];
}

export function languageName(code: string | null | undefined): string {
	if (code === NO_TRANSLATION) return 'Original';
	return getLanguage(code).name;
}

// TRUE WHEN THE BOOK IS SET TO "READ IN ORIGINAL" (NO TRANSLATION).
export function isMonolingual(targetLang: string | null | undefined): boolean {
	return targetLang === NO_TRANSLATION;
}

// LANGUAGE OPTIONS FOR THE PICKERS. THE LABEL APPENDS THE ENDONYM ONLY WHEN IT DIFFERS FROM THE ENGLISH
// NAME — SO ENGLISH READS "English", NOT "English · English".
export function languageOptions(): { value: string; label: string }[] {
	return Object.values(LANGUAGES).map((l) => ({
		value: l.code,
		label: l.name === l.endonym ? l.name : `${l.name} · ${l.endonym}`,
	}));
}

// RICH TARGET-LANGUAGE OPTIONS FOR THE COOL PICKER — ORDERED BY QUALITY tier THEN NAME, WITH ENDONYM +
// SCRIPT + RTL FLAG SO THE UI CAN GROUP AND DECORATE THEM.
export interface TargetOption {
	value: string;
	name: string;
	endonym: string;
	tier: 1 | 2 | 3;
	script: Script;
	rtl: boolean;
}
export function targetLanguageOptions(): TargetOption[] {
	return Object.values(LANGUAGES)
		.map((l) => ({
			value: l.code,
			name: l.name,
			endonym: l.endonym,
			tier: l.tier,
			script: l.script,
			rtl: !!l.rtl,
		}))
		.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

// THE SENTINEL FOR "DETECT THE SOURCE LANGUAGE FROM THE CONTENT" — RESOLVED SERVER-SIDE AT FETCH/IMPORT.
export const AUTO_SOURCE = 'auto';

// THE BROAD LANGUAGE FAMILY OF A CODE — zh-Hant AND zh-Hans ARE BOTH 'zh'. USED TO REJECT A DEGENERATE
// SAME-LANGUAGE DIRECTION (e.g. Chinese → Chinese) AT BOOK CREATION.
export function languageFamily(code: string): string {
	if (code === AUTO_SOURCE) return AUTO_SOURCE;
	return code.startsWith('zh') ? 'zh' : code;
}

// TRUE WHEN SOURCE AND TARGET ARE THE SAME LANGUAGE (FAMILY) — AN INVALID TRANSLATION DIRECTION. AN
// 'auto' SOURCE OR THE 'none' (READ-IN-ORIGINAL) TARGET ARE NEVER FLAGGED HERE.
export function sameLanguage(a: string, b: string): boolean {
	if (a === AUTO_SOURCE || b === AUTO_SOURCE || b === NO_TRANSLATION) return false;
	return languageFamily(a) === languageFamily(b);
}

// COMMON SIMPLIFIED-ONLY vs TRADITIONAL-ONLY CHARACTERS — A LIGHT HEURISTIC TO TELL zh-Hans FROM zh-Hant
// WITHOUT A FULL DICTIONARY. DISJOINT SETS; WHICHEVER SIDE APPEARS MORE WINS (TIE/NONE → TRADITIONAL,
// MATCHING THE PRIMARY SOURCE SITE).
const SIMP_ONLY = '们这国说时为对开关边门见车马鸟长东书会买卖学觉际汉还进过远爱图义乐习写双发';
const TRAD_ONLY = '們這國說時為對開關邊門見車馬鳥長東書會買賣學覺際漢還進過遠愛圖義樂習寫雙發';

const KANA_RE = /[぀-ゟ゠-ヿ]/u;
const HANGUL_RE = /[가-힣]/u;
const HAN_DETECT_RE = /[一-鿿㐀-䶿]/u;
const CYRILLIC_RE = /[Ѐ-ӿ]/u;
const ARABIC_RE = /[؀-ۿ]/u;
const DEVANAGARI_RE = /[ऀ-ॿ]/u;
const THAI_RE = /[฀-๿]/u;
const HEBREW_RE = /[֐-׿]/u;
const GREEK_RE = /[Ͱ-Ͽἀ-ῼ]/u;

/**
 * DETECT A SOURCE-LANGUAGE CODE FROM A SAMPLE OF THE FETCHED/IMPORTED TEXT (USED WHEN THE USER PICKS
 * "Auto-detect"). RECOGNISES THE MAJOR SCRIPTS; HAN IS SPLIT zh-Hant/zh-Hans BY A SIMPLIFIED/TRADITIONAL
 * SENTINEL COUNT. FALLS BACK TO en (LATIN) OR THE DEFAULT SOURCE WHEN THE SAMPLE IS EMPTY.
 */
export function detectSourceLang(text: string): string {
	const s = (text ?? '').slice(0, 4000);
	if (!s.trim()) return DEFAULT_SOURCE_LANG;
	if (KANA_RE.test(s)) return 'ja';
	if (HANGUL_RE.test(s)) return 'ko';
	if (HAN_DETECT_RE.test(s)) {
		let simp = 0;
		let trad = 0;
		for (const ch of s) {
			if (SIMP_ONLY.includes(ch)) simp++;
			else if (TRAD_ONLY.includes(ch)) trad++;
		}
		return simp > trad ? 'zh-Hans' : 'zh-Hant';
	}
	if (THAI_RE.test(s)) return 'th';
	if (HEBREW_RE.test(s)) return 'he';
	if (ARABIC_RE.test(s)) return 'ar';
	if (DEVANAGARI_RE.test(s)) return 'hi';
	if (GREEK_RE.test(s)) return 'el';
	if (CYRILLIC_RE.test(s)) return 'ru';
	return 'en';
}

// PER-SCRIPT REGEX MATCHING A *RUN* OF THAT SCRIPT'S CHARACTERS. USED TO DETECT SOURCE-SCRIPT RESIDUE
// LEFT IN A TRANSLATION. RETURNS null FOR ALPHABETIC / ABUGIDA SCRIPTS WHOSE STRAY CHARACTERS ARE OFTEN
// LEGITIMATE LOANWORDS/NAMES — LEAK REPAIR IS MEANINGFUL ONLY WHEN THE SOURCE IS A DENSE CJK SCRIPT.
const SCRIPT_RESIDUE: Record<Script, RegExp | null> = {
	// CJK IDEOGRAPHS (incl. Ext-A, Ext-B, COMPATIBILITY). PUNCTUATION/FULL-WIDTH SYMBOLS ARE NOT FLAGGED.
	han: /[㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{2a6df}]/u,
	// HIRAGANA + KATAKANA (KANJI IS COVERED BY 'han' — A JA RESIDUE CHECK ALSO RUNS THE han REGEX).
	kana: /[぀-ヿㇰ-ㇿ]/u,
	hangul: /[가-힣ᄀ-ᇿ㄰-㆏]/u,
	latin: null,
	cyrillic: null,
	greek: null,
	arabic: null,
	hebrew: null,
	devanagari: null,
	bengali: null,
	tamil: null,
	thai: null,
};

// TRUE IF `text` CONTAINS UNTRANSLATED RESIDUE OF THE SOURCE LANGUAGE'S SCRIPT — i.e. THE TRANSLATOR
// LEFT RAW SOURCE CHARACTERS IN THE OUTPUT. FOR JAPANESE THIS COVERS BOTH KANA AND KANJI.
export function hasSourceResidue(text: string, sourceLang: string): boolean {
	const { script } = getLanguage(sourceLang);
	const re = SCRIPT_RESIDUE[script];
	if (re?.test(text)) return true;
	// JAPANESE PROSE IS KANA + KANJI; ALSO FLAG LEFTOVER KANJI (han) WHEN THE SOURCE IS KANA-SCRIPTED.
	if (script === 'kana') return SCRIPT_RESIDUE.han!.test(text);
	return false;
}

// WHETHER SCRIPT-LEAK REPAIR IS WORTH RUNNING FOR THIS DIRECTION (ONLY WHEN THE SOURCE SCRIPT IS A DENSE
// CJK SCRIPT WHOSE STRAY CHARACTERS UNAMBIGUOUSLY SIGNAL AN UNTRANSLATED FRAGMENT).
export function leakRepairApplies(sourceLang: string): boolean {
	const { script } = getLanguage(sourceLang);
	return script === 'han' || script === 'kana' || script === 'hangul';
}
