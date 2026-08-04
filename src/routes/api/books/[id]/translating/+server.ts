// IMPORTED DEP-MODULES
import { json } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { assertBookOwner } from '$lib/server/books';
import { db } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';
import { runningChapterIds } from '$lib/server/translation-service';
// IMPORTED TYPES
import type { RequestHandler } from './$types';

// -- FUNCTIONS -- //

// LIVE SET OF CHAPTERS IN THIS BOOK WITH A TRANSLATION JOB RUNNING (CURRENT READ + BACKGROUND PREFETCH).
// THE SIDEBAR/TOC POLLS THIS SO ITS 'TRANSLATING' BADGES REFLECT THE TRUE SERVER STATE (THIS PROCESS'S
// IN-MEMORY RUNNING JOBS). CROSS-CHECK THE DB AND DROP ANY CHAPTER THAT ALREADY HAS A TRANSLATION: A JOB
// THAT STALLED (E.G. A HUNG MODEL CALL) STAYS 'running' IN MEMORY FOREVER, AND WITHOUT THIS THE BADGE WOULD
// SHOW "TRANSLATING" ON AN ALREADY-FINISHED CHAPTER UNTIL THE SERVER RESTARTS. THE DB IS THE SOURCE OF TRUTH.
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	await assertBookOwner(user.id, params.id);
	const ids = runningChapterIds();
	if (ids.length === 0) return json({ uuids: [] });
	const rows = await db
		.select({ uuid: chapters.uuid })
		.from(chapters)
		.where(and(eq(chapters.bookId, params.id), inArray(chapters.id, ids), isNull(chapters.contentTarget)));
	return json({ uuids: rows.map((r) => r.uuid).filter(Boolean) });
};
