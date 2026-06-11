// SAFE INLINE MARKUP RENDERING
// The translation may contain light markdown (**bold**, *italic*, `code`) or simple inline HTML
// (<b>, <i>, <br>…). We render a small WHITELIST of that as real formatting. Everything is HTML-
// escaped first, then only bare whitelisted tags are re-allowed — so untrusted LLM output can never
// inject <script>, event handlers, or attributes (important now that the app can be exposed publicly).

const ESCAPE: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ESCAPE[c]);
}

// BARE INLINE TAGS (NO ATTRIBUTES) WE RE-ALLOW AFTER ESCAPING. ANYTHING WITH ATTRIBUTES STAYS ESCAPED.
const ALLOWED = ['b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark', 'sub', 'sup', 'code', 'br'];
const TAG_RE = new RegExp(`&lt;(/?)(${ALLOWED.join('|')})\\s*/?&gt;`, 'gi');

/** RENDER A SAFE SUBSET OF INLINE MARKDOWN + HTML TO HTML (USE WITH {@html}). */
export function renderMarkup(text: string): string {
	let s = escapeHtml(text);

	// Re-allow whitelisted bare tags: &lt;b&gt; → <b>, &lt;br/&gt; → <br>, etc.
	s = s.replace(TAG_RE, (_m, slash: string, tag: string) => {
		const t = tag.toLowerCase();
		return t === 'br' ? '<br>' : `<${slash}${t}>`;
	});

	// Inline markdown (bold before italic so ** isn't eaten by the * rule).
	s = s
		.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>')
		.replace(/__([^\n_]+?)__/g, '<strong>$1</strong>')
		.replace(/\*([^\n*]+?)\*/g, '<em>$1</em>')
		.replace(/(?<![\w_])_([^\n_]+?)_(?![\w_])/g, '<em>$1</em>')
		.replace(/~~([^\n~]+?)~~/g, '<del>$1</del>')
		.replace(/`([^\n`]+?)`/g, '<code>$1</code>');

	return s;
}
