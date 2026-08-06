// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { deleteChapter, getOwnedChapterByUuid } from '$lib/server/books';
import { db } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';
// IMPORTED TYPES
import type { RequestHandler } from './$types';

// -- CONSTANTS -- //

const PatchBody = z
	.object({
		titleSource: z.string().trim().min(1).max(500, 'Title is too long.').optional(),
		// EDITABLE TARGET-LANGUAGE TITLE — EMPTY/null CLEARS IT (FALLS BACK TO THE SOURCE TITLE IN THE READER)
		titleTarget: z.string().trim().max(500, 'Title is too long.').nullable().optional(),
		contentSource: z.string().trim().min(1).max(2_000_000, 'Chapter text is too long (max 2MB).').optional(),
	})
	.refine(
		(b) => b.titleSource !== undefined || b.titleTarget !== undefined || b.contentSource !== undefined,
		'Nothing to update.',
	);

// -- FUNCTIONS -- //

// RENAME OR EDIT A CHAPTER. CHANGING THE SOURCE CONTENT CLEARS THE STALE TRANSLATION SO IT RE-TRANSLATES.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = requireUser(locals);
	// OWNERSHIP: getOwnedChapterByUuid JOINS chapters→books AND FILTERS BY OWNER.
	const row = await getOwnedChapterByUuid(user.id, params.uuid);
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

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	// OWNERSHIP: ONLY DELETE A CHAPTER IN THE CALLER'S LIBRARY.
	if (!(await getOwnedChapterByUuid(user.id, params.uuid))) throw error(404, 'Chapter not found.');
	await deleteChapter(params.uuid);
	return json({ ok: true });
};
