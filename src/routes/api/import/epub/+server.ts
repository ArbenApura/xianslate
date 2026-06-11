// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { DEFAULT_SOURCE_LANG, DEFAULT_TARGET_LANG, getLanguage } from '$lib/languages';
import { appendChapters, createImportedBook, getBook } from '$lib/server/books';
import { importEpub } from '$lib/server/ingest/epub';
import { assertMaxSize, MB } from '$lib/server/uploads';

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) throw error(400, 'Upload an .epub file in the "file" field.');
	assertMaxSize(file, 50 * MB);
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
		const bytes = new Uint8Array(await file.arrayBuffer());
		const fallback = file.name.replace(/\.epub$/i, '') || 'Imported EPUB';
		// HINT XHTML CHARSET DETECTION WITH THE SOURCE LANGUAGE'S LEGACY ENCODINGS (e.g. JP Shift_JIS).
		const imported = importEpub(bytes, fallback, getLanguage(pair.sourceLang).charsetHints);
		if (targetBook) {
			const { added, firstUuid } = await appendChapters(targetBook.id, imported.chapters);
			return json({ bookId: targetBook.id, firstChapterUuid: firstUuid, chapters: added, title: targetBook.title });
		}
		const { bookId, firstChapterUuid } = await createImportedBook(imported, null, pair);
		return json({ bookId, firstChapterUuid, chapters: imported.chapters.length, title: imported.title });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to import EPUB.');
	}
};
