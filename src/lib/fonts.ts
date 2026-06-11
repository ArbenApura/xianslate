// CURATED READING FONTS (SELF-HOSTED VIA @fontsource, IMPORTED IN app.css)

// -- TYPES -- //

export interface FontOption {
	key: string;
	label: string;
	stack: string;
}

// -- CONSTANTS -- //

export const LATIN_FONTS: FontOption[] = [
	{ key: 'literata', label: 'Literata', stack: "'Literata', Georgia, 'Times New Roman', serif" },
	{ key: 'lora', label: 'Lora', stack: "'Lora', Georgia, serif" },
	{ key: 'inter', label: 'Inter (sans)', stack: "'Inter', system-ui, sans-serif" },
	{ key: 'opendyslexic', label: 'OpenDyslexic', stack: "'OpenDyslexic', Comic Sans MS, sans-serif" },
];

export const CJK_FONTS: FontOption[] = [
	{ key: 'noto-serif-tc', label: 'Noto Serif TC', stack: "'Noto Serif TC', serif" },
	{ key: 'noto-sans-tc', label: 'Noto Sans TC', stack: "'Noto Sans TC', sans-serif" },
	{ key: 'lxgw', label: 'LXGW WenKai TC', stack: "'LXGW WenKai TC', cursive, serif" },
];

// -- FUNCTIONS -- //

export function latinStack(key: string): string {
	return (LATIN_FONTS.find((f) => f.key === key) ?? LATIN_FONTS[0]).stack;
}

export function cjkStack(key: string): string {
	return (CJK_FONTS.find((f) => f.key === key) ?? CJK_FONTS[0]).stack;
}
