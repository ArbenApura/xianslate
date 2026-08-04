// SAFE INLINE MARKUP RENDERING
// THE TRANSLATION MAY CONTAIN LIGHT MARKDOWN (**bold**, *italic*, `code`) OR SIMPLE INLINE HTML
// (<b>, <i>, <br>...). WE RENDER A SMALL WHITELIST OF THAT AS REAL FORMATTING. EVERYTHING IS HTML-
// ESCAPED FIRST, THEN ONLY BARE WHITELISTED TAGS ARE RE-ALLOWED — SO UNTRUSTED LLM OUTPUT CAN NEVER
// INJECT <script>, EVENT HANDLERS, OR ATTRIBUTES (IMPORTANT NOW THAT THE APP CAN BE EXPOSED PUBLICLY).

// -- TYPES -- //

export interface HighlightTerm {
	// THE SURFACE STRING TO FIND IN THE DISPLAYED TEXT (THE TERM'S target IN THE TRANSLATION VIEW, ITS
	// source IN THE ORIGINAL VIEW).
	match: string;
	// STABLE ID CARRIED ON THE INJECTED SPAN (data-term) SO A TAP CAN LOOK THE FULL TERM UP — THE TERM source.
	id: string;
}

// -- CONSTANTS -- //

const ESCAPE: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

// BARE INLINE TAGS (NO ATTRIBUTES) WE RE-ALLOW AFTER ESCAPING. ANYTHING WITH ATTRIBUTES STAYS ESCAPED.
const ALLOWED = ['b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark', 'sub', 'sup', 'code', 'br'];
const TAG_RE = new RegExp(`&lt;(/?)(${ALLOWED.join('|')})\\s*/?&gt;`, 'gi');

// A "WORD" CHARACTER FOR TERM-BOUNDARY DETECTION (LETTERS, DIGITS, COMBINING MARKS) — MIRRORS THE SERVER'S
// glossary-match RULE SO CLIENT HIGHLIGHTING MARKS THE SAME SPANS THE TRANSLATOR SAW.
const WORD_CHAR_CLASS = '[\\p{L}\\p{N}\\p{M}]';

// CLICKABLE, BOLDED GLOSSARY TERM — A DOTTED ACCENT UNDERLINE SIGNALS IT'S TAPPABLE WITHOUT RECOLOURING THE
// PROSE. (THESE CLASSES LIVE IN A .ts STRING; tailwind.config SCANS .ts SO THEY ARE STILL GENERATED.)
const TERM_CLASS =
	'cursor-pointer font-semibold underline decoration-dotted decoration-[#c0392b]/60 underline-offset-[3px] transition-colors hover:decoration-[#c0392b]';

// -- FUNCTIONS -- //

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ESCAPE[c]);
}

/** RENDER A SAFE SUBSET OF INLINE MARKDOWN + HTML TO HTML (USE WITH {@html}). */
export function renderMarkup(text: string): string {
	let s = escapeHtml(text);

	// RE-ALLOW WHITELISTED BARE TAGS: &lt;b&gt; → <b>, &lt;br/&gt; → <br>, ETC.
	s = s.replace(TAG_RE, (_m, slash: string, tag: string) => {
		const t = tag.toLowerCase();
		return t === 'br' ? '<br>' : `<${slash}${t}>`;
	});

	// INLINE MARKDOWN (bold BEFORE italic SO ** ISN'T EATEN BY THE * RULE).
	s = s
		.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>')
		.replace(/__([^\n_]+?)__/g, '<strong>$1</strong>')
		.replace(/\*([^\n*]+?)\*/g, '<em>$1</em>')
		.replace(/(?<![\w_])_([^\n_]+?)_(?![\w_])/g, '<em>$1</em>')
		.replace(/~~([^\n~]+?)~~/g, '<del>$1</del>')
		.replace(/`([^\n`]+?)`/g, '<code>$1</code>');

	return s;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A COMPILED TERM MATCHER: THE ALTERNATION REGEX + A LOOKUP FROM AN ESCAPED MATCH BACK TO THE TERM id.
type Matcher = { re: RegExp; byEscaped: Map<string, string> } | null;

// ONE-ENTRY COMPILE CACHE. THE READER PASSES A *STABLE* terms ARRAY (RECOMPUTED ONLY WHEN THE GLOSSARY OR
// TOGGLE CHANGES) BUT CALLS highlightTerms ONCE PER PARAGRAPH — AND, WHILE STREAMING, ON EVERY DELTA. KEYING
// BY ARRAY IDENTITY + wordDelimited LETS ALL THOSE CALLS REUSE A SINGLE BUILT REGEX INSTEAD OF REBUILDING IT.
let cacheTerms: HighlightTerm[] | null = null;
let cacheWordDelimited = false;
let cacheMatcher: Matcher = null;

function compileMatcher(terms: HighlightTerm[], wordDelimited: boolean): Matcher {
	if (terms === cacheTerms && wordDelimited === cacheWordDelimited) return cacheMatcher;
	cacheTerms = terms;
	cacheWordDelimited = wordDelimited;
	cacheMatcher = null;
	// ESCAPE EACH TERM THE SAME WAY THE HTML WAS, DROP EMPTIES, AND KEEP LONGEST-FIRST SO A TERM THAT IS A
	// SUBSTRING OF A LONGER MATCHED TERM NEVER WINS (MIRRORS THE SERVER'S LONGEST-MATCH-WINS RULE).
	const byEscaped = new Map<string, string>();
	for (const t of terms) {
		const esc = escapeHtml(t.match);
		if (esc && !byEscaped.has(esc)) byEscaped.set(esc, t.id);
	}
	const keys = [...byEscaped.keys()].sort((a, b) => b.length - a.length);
	if (keys.length === 0) return cacheMatcher;
	const core = `(?:${keys.map(escapeRegExp).join('|')})`;
	// WORD-DELIMITED LANGUAGES MATCH ONLY AT WORD BOUNDARIES (SO "art" ISN'T BOLDED INSIDE "start"); CJK AND
	// OTHER SCRIPTURA-CONTINUA SCRIPTS MATCH ANY OCCURRENCE.
	const re = new RegExp(wordDelimited ? `(?<!${WORD_CHAR_CLASS})${core}(?!${WORD_CHAR_CLASS})` : core, 'gu');
	cacheMatcher = { re, byEscaped };
	return cacheMatcher;
}

/** WRAP GLOSSARY-TERM OCCURRENCES IN ALREADY-SAFE HTML WITH A CLICKABLE, BOLD SPAN (USE WITH {@html}). */
export function highlightTerms(html: string, terms: HighlightTerm[], wordDelimited: boolean): string {
	if (terms.length === 0) return html;
	const matcher = compileMatcher(terms, wordDelimited);
	if (!matcher) return html;
	const { re, byEscaped } = matcher;
	// ONLY TRANSFORM TEXT BETWEEN TAGS — NEVER A TAG renderMarkup MAY HAVE EMITTED (<strong>, <em>, …).
	return html.replace(/<[^>]*>|[^<]+/g, (seg) => {
		if (seg.charCodeAt(0) === 60) return seg; // '<' → A TAG, LEAVE IT UNTOUCHED
		return seg.replace(re, (m) => {
			const id = byEscaped.get(m);
			if (id === undefined) return m;
			return `<span data-term="${escapeHtml(id)}" role="button" tabindex="0" class="${TERM_CLASS}">${m}</span>`;
		});
	});
}

/** renderMarkup() + GLOSSARY-TERM HIGHLIGHTING — FOR THE TRANSLATION (TARGET) TEXT. */
export function renderMarkupWithTerms(text: string, terms: HighlightTerm[], wordDelimited: boolean): string {
	return highlightTerms(renderMarkup(text), terms, wordDelimited);
}

/** ESCAPE-ONLY (NO MARKDOWN) + GLOSSARY-TERM HIGHLIGHTING — FOR THE RAW ORIGINAL (SOURCE) TEXT. */
export function renderTermsPlain(text: string, terms: HighlightTerm[], wordDelimited: boolean): string {
	return highlightTerms(escapeHtml(text), terms, wordDelimited);
}
