import { error, json } from '@sveltejs/kit';
import { appendChapters, createImportedBook, getBook } from '$lib/server/books';
import { importTxt } from '$lib/server/ingest/txt';
import { decodeTextBytes } from '$lib/server/charset';
import { assertMaxSize, MB } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) throw error(400, 'Upload a .txt file in the "file" field.');
	assertMaxSize(file, 20 * MB);
	// OPTIONAL: APPEND INTO AN EXISTING BOOK INSTEAD OF CREATING A NEW ONE
	const targetBookId = (form?.get('bookId') as string | null) || null;
	const targetBook = targetBookId ? await getBook(targetBookId) : null;
	if (targetBookId && !targetBook) throw error(404, 'Target book not found.');
	try {
		// DECODE BY DETECTED CHARSET — CHINESE .txt IS OFTEN GB2312/GBK/BIG5, NOT UTF-8 (file.text() ASSUMES
		// UTF-8 AND WOULD PRODUCE MOJIBAKE).
		const text = decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
		const fallback = file.name.replace(/\.txt$/i, '') || 'Imported Text';
		const imported = importTxt(text, fallback);
		if (targetBook) {
			const { added, firstUuid } = await appendChapters(targetBook.id, imported.chapters);
			return json({ bookId: targetBook.id, firstChapterUuid: firstUuid, chapters: added, title: targetBook.title });
		}
		const { bookId, firstChapterUuid } = await createImportedBook(imported, null);
		return json({ bookId, firstChapterUuid, chapters: imported.chapters.length, title: imported.title });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Failed to import text file.');
	}
};
