// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
// IMPORTED MODULES
import { deleteChapter } from '$lib/server/books';
import { db } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';
// IMPORTED TYPES
import type { RequestHandler } from './$types';

// -- CONSTANTS -- //

const PatchBody = z
	.object({
		titleSource: z.string().trim().min(1).optional(),
		// EDITABLE TARGET-LANGUAGE TITLE — EMPTY/null CLEARS IT (FALLS BACK TO THE SOURCE TITLE IN THE READER)
		titleTarget: z.string().trim().nullable().optional(),
		contentSource: z.string().trim().min(1).optional(),
	})
	.refine(
		(b) => b.titleSource !== undefined || b.titleTarget !== undefined || b.contentSource !== undefined,
		'Nothing to update.',
	);

// -- FUNCTIONS -- //

// RENAME OR EDIT A CHAPTER. CHANGING THE SOURCE CONTENT CLEARS THE STALE TRANSLATION SO IT RE-TRANSLATES.
export const PATCH: RequestHandler = async ({ params, request }) => {
	const [row] = await db.select().from(chapters).where(eq(chapters.uuid, params.uuid)).limit(1);
	if (!row) throw error(404, 'Chapter not found.');

	const parsed = PatchBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide titleSource and/or contentSource.');

	const set: Partial<typeof chapters.$inferInsert> = {};
	if (parsed.data.titleSource !== undefined) set.titleSource = parsed.data.titleSource;
	if (parsed.data.titleTarget !== undefined) set.titleTarget = parsed.data.titleTarget || null;
	if (parsed.data.contentSource !== undefined && parsed.data.contentSource !== row.contentSource) {
		set.contentSource = parsed.data.contentSource;
		// CONTENT CHANGED → THE STORED TRANSLATION NO LONGER MATCHES; DROP IT SO THE READER RE-TRANSLATES
		set.contentTarget = null;
		set.titleTarget = null;
		set.translatedAt = null;
	}
	await db.update(chapters).set(set).where(eq(chapters.id, row.id));
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteChapter(params.uuid);
	return json({ ok: true });
};
