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
	.object({ titleZh: z.string().trim().min(1).optional(), contentZh: z.string().trim().min(1).optional() })
	.refine((b) => b.titleZh !== undefined || b.contentZh !== undefined, 'Nothing to update.');

// -- FUNCTIONS -- //

// RENAME OR EDIT A CHAPTER. CHANGING THE CHINESE CONTENT CLEARS THE STALE TRANSLATION SO IT RE-TRANSLATES.
export const PATCH: RequestHandler = async ({ params, request }) => {
	const [row] = await db.select().from(chapters).where(eq(chapters.uuid, params.uuid)).limit(1);
	if (!row) throw error(404, 'Chapter not found.');

	const parsed = PatchBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide titleZh and/or contentZh.');

	const set: Partial<typeof chapters.$inferInsert> = {};
	if (parsed.data.titleZh !== undefined) set.titleZh = parsed.data.titleZh;
	if (parsed.data.contentZh !== undefined && parsed.data.contentZh !== row.contentZh) {
		set.contentZh = parsed.data.contentZh;
		// CONTENT CHANGED → THE STORED ENGLISH NO LONGER MATCHES; DROP IT SO THE READER RE-TRANSLATES
		set.contentEn = null;
		set.titleEn = null;
		set.translatedAt = null;
	}
	await db.update(chapters).set(set).where(eq(chapters.id, row.id));
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteChapter(params.uuid);
	return json({ ok: true });
};
