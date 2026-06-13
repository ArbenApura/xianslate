// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { eq } from 'drizzle-orm';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/auth/user';

// -- CONSTANTS -- //

const PatchBody = z.object({ role: z.enum(['user', 'admin']) });

// -- FUNCTIONS -- //

// SET A USER'S APP role (PROMOTE TO admin / DEMOTE TO user). hooks GATES /api/admin/* TO ADMINS. AN ADMIN
// CANNOT DEMOTE THEMSELVES — THAT'S THE FOOTGUN THAT LOCKS EVERYONE OUT OF /admin.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const me = requireUser(locals);
	if (me.role !== 'admin') throw error(403, 'Admin only.');

	const parsed = PatchBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A valid role ("user" or "admin") is required.');
	const { role } = parsed.data;
	const id = params.id;

	if (id === me.id && role !== 'admin') throw error(400, 'You can’t remove your own admin access.');

	const [updated] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
	if (!updated) throw error(404, 'User not found.');
	return json({ ok: true, id, role: updated.role });
};
