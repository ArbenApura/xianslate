import { error } from '@sveltejs/kit';
import { getEffectiveGlossary, getGlossary } from '$lib/server/glossary';
import { toGlossaryCsv } from '$lib/server/glossary-csv';
import type { TermDraft } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const scope = url.searchParams.get('scope') ?? 'global';
	const bookId = url.searchParams.get('bookId');

	let terms: TermDraft[];
	let name: string;
	if (scope === 'effective') {
		if (!bookId) throw error(400, 'bookId is required for effective export.');
		terms = await getEffectiveGlossary(bookId);
		name = `glossary-effective-${bookId}.csv`;
	} else if (scope === 'book') {
		if (!bookId) throw error(400, 'bookId is required for book export.');
		const rows = await getGlossary('book', bookId);
		terms = rows.map((r) => ({ raw: r.raw, translation: r.translation, gender: r.gender, tags: r.tags }));
		name = `glossary-book-${bookId}.csv`;
	} else if (scope === 'global') {
		const rows = await getGlossary('global', null);
		terms = rows.map((r) => ({ raw: r.raw, translation: r.translation, gender: r.gender, tags: r.tags }));
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
