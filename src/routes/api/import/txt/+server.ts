// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, getLanguage } from '$lib/languages';
import { appendChapters, createImportedBook, getBook } from '$lib/server/books';
import { importTxt } from '$lib/server/ingest/txt';
import { decodeTextBytes } from '$lib/server/charset';
import { assertMaxSize, MB } from '$lib/server/uploads';

// -- FUNCTIONS -- //

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) throw error(400, 'Upload a .txt file in the "file" field.');
	assertMaxSize(file, 20 * MB);
	// OPTIONAL: APPEND INTO AN EXISTING BOOK INSTEAD OF CREATING A NEW ONE
	const targetBookId = (form?.get('bookId') as string | null) || null;
	const targetBook = targetBookId ? await getBook(targetBookId) : null;
	if (targetBookId && !targetBook) throw error(404, 'Target book not found.');
	// DIRECTION: APPENDING INHERITS THE BOOK'S; A NEW BOOK USES THE FORM PAIR (DEFAULT zh-Hant → en).
	const pair = targetBook
		? { sourceLang: targetBook.sourceLang, targetLang: targetBook.targetLang }
		: {
				sourceLang: (form?.get('sourceLang') as string | null) || DEFAULT_SOURCE_LANG,
				targetLang: (form?.get('targetLang') as string | null) || DEFAULT_TARGET_LANG,
			};
	try {
		// DECODE BY DETECTED CHARSET — A SOURCE-LANGUAGE .txt IS OFTEN A LEGACY EAST-ASIAN ENCODING, NOT
		// UTF-8 (file.text() ASSUMES UTF-8 AND WOULD PRODUCE MOJIBAKE). HINT WITH THE SOURCE LANG'S CHARSETS.
		const hints = getLanguage(pair.sourceLang).charsetHints;
		const text = decodeTextBytes(new Uint8Array(await file.arrayBuffer()), false, hints);
		const fallback = file.name.replace(/\.txt$/i, '') || 'Imported Text';
		const imported = importTxt(text, fallback);
		if (targetBook) {
			const { added, firstUuid } = await appendChapters(targetBook.id, imported.chapters);
			return json({ bookId: targetBook.id, firstChapterUuid: firstUuid, chapters: added, title: targetBook.title });
		}
		const { bookId, firstChapterUuid } = await createImportedBook(imported, null, pair);
		return json({ bookId, firstChapterUuid, chapters: imported.chapters.length, title: imported.title });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to import text file.');
	}
};
