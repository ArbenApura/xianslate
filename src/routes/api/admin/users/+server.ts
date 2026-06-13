// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { desc, eq, sql } from 'drizzle-orm';
import { error, json } from '@sveltejs/kit';
// IMPORTED MODULES
import { dbRead } from '$lib/server/db';
import { books, users } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/auth/user';

// -- FUNCTIONS -- //

// EVERY REGISTERED ACCOUNT + ITS LIBRARY SIZE (BOOK COUNT), NEWEST FIRST — POWERS THE ADMIN USERS TABLE.
// READ FROM THE REPLICA ENDPOINT (HEAVY READ). hooks GATES /api/admin/* TO ADMINS.
export const GET: RequestHandler = async ({ locals }) => {
	const me = requireUser(locals);
	if (me.role !== 'admin') throw error(403, 'Admin only.');
	const rows = await dbRead
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			avatarUrl: users.avatarUrl,
			emailVerified: users.emailVerified,
			role: users.role,
			createdAt: users.createdAt,
			books: sql<number>`count(${books.id})`,
		})
		.from(users)
		.leftJoin(books, eq(books.userId, users.id))
		.groupBy(users.id)
		.orderBy(desc(users.createdAt));
	return json(rows.map((r) => ({ ...r, books: Number(r.books) })));
};
