// LANGUAGE REGISTRY — THE SINGLE SOURCE OF TRUTH FOR EVERY LANGUAGE-SPECIFIC DECISION IN THE APP.
// THE TRANSLATION DIRECTION USED TO BE HARDCODED (CHINESE SOURCE → ENGLISH TARGET). IT IS NOW DATA:
// EACH BOOK STORES A sourceLang + targetLang code, AND EVERY PLACE THAT ONCE ASSUMED zh→en (PROMPTS,
// SCRIPT-LEAK REPAIR, FETCH CHARSET, FONTS, TTS, READING-TIME, GLOSSARY MATCHING) READS THE BEHAVIOUR
// OFF THIS TABLE INSTEAD. ADD A LANGUAGE = ADD A ROW HERE.

// -- TYPES -- //

// THE WRITING SYSTEM — DRIVES SCRIPT-LEAK DETECTION (DID THE MODEL LEAVE SOURCE-SCRIPT RESIDUE IN THE
// TARGET?) AND THE DEFAULT FONT SLOT. 'han'/'kana'/'hangul' ARE DENSE CJK SCRIPTS; 'latin'/'cyrillic'
// ARE WORD-DELIMITED ALPHABETS.
export type Script = 'han' | 'kana' | 'hangul' | 'latin' | 'cyrillic';

// WHICH READING-FONT PICKER A LANGUAGE USES (THE READER KEEPS ONE CJK + ONE LATIN FONT CHOICE).
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
	// ("pinyin with no tone marks", "Hepburn romaji", "Revised Romanization"). null = ALREADY LATIN.
	romanization: string | null;
	// TRUE WHEN WORDS ARE SEPARATED BY SPACES (en) — GLOSSARY MATCHING THEN REQUIRES WORD BOUNDARIES SO
	// A TERM ISN'T MATCHED INSIDE A LARGER WORD. FALSE FOR SCRIPTURA-CONTINUA CJK (SUBSTRING MATCH IS SAFE).
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
}

// -- CONSTANTS -- //

export const LANGUAGES: Record<string, Language> = {
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
	},
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
	},
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
	},
};

// THE LANGUAGE PAIR EVERY PRE-EXISTING BOOK/GLOSSARY ROW IS BACKFILLED TO DURING MIGRATION — THE APP'S
// ORIGINAL HARDCODED DIRECTION. ALSO THE FACTORY DEFAULT FOR THE "NEW BOOK" GLOBAL PREFERENCE.
export const DEFAULT_SOURCE_LANG = 'zh-Hant';
export const DEFAULT_TARGET_LANG = 'en';

// -- FUNCTIONS -- //

// RESOLVE A CODE TO ITS Language, FALLING BACK TO THE DEFAULTS SO A STALE/UNKNOWN CODE NEVER THROWS.
export function getLanguage(code: string | null | undefined): Language {
	return (code && LANGUAGES[code]) || LANGUAGES[DEFAULT_SOURCE_LANG];
}

export function languageName(code: string | null | undefined): string {
	return getLanguage(code).name;
}

// LANGUAGE OPTIONS FOR THE PICKERS. THE LABEL APPENDS THE ENDONYM ONLY WHEN IT DIFFERS FROM THE ENGLISH
// NAME — SO ENGLISH READS "English", NOT "English · English".
export function languageOptions(): { value: string; label: string }[] {
	return Object.values(LANGUAGES).map((l) => ({
		value: l.code,
		label: l.name === l.endonym ? l.name : `${l.name} · ${l.endonym}`,
	}));
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
// 'auto' SOURCE IS NEVER FLAGGED HERE (IT'S RESOLVED FROM THE CONTENT LATER).
export function sameLanguage(a: string, b: string): boolean {
	return a !== AUTO_SOURCE && b !== AUTO_SOURCE && languageFamily(a) === languageFamily(b);
}

// COMMON SIMPLIFIED-ONLY vs TRADITIONAL-ONLY CHARACTERS — A LIGHT HEURISTIC TO TELL zh-Hans FROM zh-Hant
// WITHOUT A FULL DICTIONARY. DISJOINT SETS; WHICHEVER SIDE APPEARS MORE WINS (TIE/NONE → TRADITIONAL,
// MATCHING THE PRIMARY SOURCE SITE).
const SIMP_ONLY = '们这国说时为对开关边门见车马鸟长东书会买卖学觉际汉还进过远爱图义乐习写双发';
const TRAD_ONLY = '們這國說時為對開關邊門見車馬鳥長東書會買賣學覺際漢還進過遠愛圖義樂習寫雙發';

const KANA_RE = /[぀-ゟ゠-ヿ]/u;
const HANGUL_RE = /[가-힣]/u;
const HAN_DETECT_RE = /[一-鿿㐀-䶿]/u;

/**
 * DETECT A SOURCE-LANGUAGE CODE FROM A SAMPLE OF THE FETCHED/IMPORTED TEXT (USED WHEN THE USER PICKS
 * "Auto-detect"). KANA → ja, HANGUL → ko, HAN → zh-Hant/zh-Hans BY A SIMPLIFIED/TRADITIONAL SENTINEL
 * COUNT, OTHERWISE en. FALLS BACK TO THE DEFAULT SOURCE WHEN THE SAMPLE IS EMPTY.
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
	return 'en';
}

// PER-SCRIPT REGEX MATCHING A *RUN* OF THAT SCRIPT'S CHARACTERS. USED TO DETECT SOURCE-SCRIPT RESIDUE
// LEFT IN A TRANSLATION. RETURNS null FOR ALPHABETIC SCRIPTS (latin/cyrillic): A STRAY LATIN LETTER IN
// CJK TARGET TEXT IS USUALLY A LEGITIMATE LOANWORD/NAME, SO WE DON'T TREAT ALPHABETIC SOURCE SCRIPTS AS
// "LEAKABLE" — LEAK REPAIR IS MEANINGFUL ONLY WHEN THE SOURCE IS A DENSE CJK SCRIPT.
const SCRIPT_RESIDUE: Record<Script, RegExp | null> = {
	// CJK IDEOGRAPHS (incl. Ext-A, Ext-B, COMPATIBILITY). PUNCTUATION/FULL-WIDTH SYMBOLS ARE NOT FLAGGED.
	han: /[㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{2a6df}]/u,
	// HIRAGANA + KATAKANA (KANJI IS COVERED BY 'han' — A JA RESIDUE CHECK ALSO RUNS THE han REGEX).
	kana: /[぀-ヿㇰ-ㇿ]/u,
	hangul: /[가-힣ᄀ-ᇿ㄰-㆏]/u,
	latin: null,
	cyrillic: null,
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
