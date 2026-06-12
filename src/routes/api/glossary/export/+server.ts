// IMPORTED DEP-TYPES
import { error } from '@sveltejs/kit';
// IMPORTED TYPES
import type { TermDraft } from '$lib/types';
import type { RequestHandler } from './$types';
// IMPORTED MODULES
import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG } from '$lib/languages';
import { requireUser } from '$lib/server/auth/user';
import { assertBookOwner } from '$lib/server/books';
import { getEffectiveGlossary, getGlossary } from '$lib/server/glossary';
import { toGlossaryCsv } from '$lib/server/glossary-csv';

// -- FUNCTIONS -- //

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireUser(locals);
	const scope = url.searchParams.get('scope') ?? 'global';
	const bookId = url.searchParams.get('bookId');
	// GLOBAL EXPORT IS SCOPED TO A LANGUAGE PAIR (DEFAULT zh-Hant → en).
	const pair = {
		sourceLang: url.searchParams.get('sourceLang') || DEFAULT_SOURCE_LANG,
		targetLang: url.searchParams.get('targetLang') || DEFAULT_TARGET_LANG,
	};

	let terms: TermDraft[];
	let name: string;
	if (scope === 'effective') {
		if (!bookId) throw error(400, 'bookId is required for effective export.');
		await assertBookOwner(user.id, bookId);
		terms = await getEffectiveGlossary(bookId);
		name = `glossary-effective-${bookId}.csv`;
	} else if (scope === 'book') {
		if (!bookId) throw error(400, 'bookId is required for book export.');
		await assertBookOwner(user.id, bookId);
		const rows = await getGlossary('book', bookId, user.id);
		terms = rows.map((r) => ({
			source: r.source,
			target: r.target,
			gender: r.gender,
			context: r.context,
			tags: r.tags,
		}));
		name = `glossary-book-${bookId}.csv`;
	} else if (scope === 'global') {
		const rows = await getGlossary('global', null, user.id, pair);
		terms = rows.map((r) => ({
			source: r.source,
			target: r.target,
			gender: r.gender,
			context: r.context,
			tags: r.tags,
		}));
		name = 'glossary-global.csv';
	} else {
		throw error(400, 'scope must be global, book, or effective.');
	}

	// SANITIZE THE FILENAME: bookId IS USER-CONTROLLED, SO STRIP ANYTHING THAT COULD BREAK OUT OF THE
	// QUOTED filename OR INJECT A HEADER (QUOTES, BACKSLASHES, CONTROL CHARS INCLUDING CR/LF).
	const safeName = name.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'glossary.csv';
	const csv = toGlossaryCsv(terms);
	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${safeName}"`,
		},
	});
};
