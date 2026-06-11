// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
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
	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const fallback = file.name.replace(/\.epub$/i, '') || 'Imported EPUB';
		const imported = importEpub(bytes, fallback);
		if (targetBook) {
			const { added, firstUuid } = await appendChapters(targetBook.id, imported.chapters);
			return json({ bookId: targetBook.id, firstChapterUuid: firstUuid, chapters: added, title: targetBook.title });
		}
		const { bookId, firstChapterUuid } = await createImportedBook(imported, null);
		return json({ bookId, firstChapterUuid, chapters: imported.chapters.length, title: imported.title });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to import EPUB.');
	}
};
