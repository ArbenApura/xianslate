// SAFE INLINE MARKUP RENDERING
// THE TRANSLATION MAY CONTAIN LIGHT MARKDOWN (**bold**, *italic*, `code`) OR SIMPLE INLINE HTML
// (<b>, <i>, <br>...). WE RENDER A SMALL WHITELIST OF THAT AS REAL FORMATTING. EVERYTHING IS HTML-
// ESCAPED FIRST, THEN ONLY BARE WHITELISTED TAGS ARE RE-ALLOWED — SO UNTRUSTED LLM OUTPUT CAN NEVER
// INJECT <script>, EVENT HANDLERS, OR ATTRIBUTES (IMPORTANT NOW THAT THE APP CAN BE EXPOSED PUBLICLY).

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
