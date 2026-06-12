// IMPORTED TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { getOwnedChapterByUuid, refreshChapterNav } from '$lib/server/books';

// -- CONSTANTS -- //

const Body = z.object({ uuid: z.string().min(1) });

// -- FUNCTIONS -- //

// RE-READ A WEB CHAPTER'S LIVE PAGE TO REFRESH ITS prev/next/index LINKS (e.g. THE FORMER "LATEST" CHAPTER
// ONCE A NEWER ONE EXISTS, OR A PREVIOUSLY MIS-SCRAPED LINK). RETURNS THE UPDATED CHAPTER VIEW.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A chapter uuid is required.');
	// OWNERSHIP: ONLY REFRESH A CHAPTER IN THE CALLER'S LIBRARY.
	if (!(await getOwnedChapterByUuid(user.id, parsed.data.uuid))) throw error(404, 'Chapter not found.');
	try {
		const view = await refreshChapterNav(parsed.data.uuid);
		if (!view) throw error(404, 'Chapter not found or not refreshable.');
		return json(view);
	} catch (e) {
		// A TYPED FetchError (network / blocked / not found) OR ANY OTHER FAILURE → 502 SO THE READER CAN
		// FALL BACK GRACEFULLY (IT JUST REPORTS "no next chapter" RATHER THAN BREAKING NAVIGATION).
		if (e && typeof e === 'object' && 'status' in e) throw e; // RE-THROW SvelteKit error() (e.g. THE 404 ABOVE)
		throw error(502, e instanceof Error ? e.message : 'Could not refresh the chapter.');
	}
};
