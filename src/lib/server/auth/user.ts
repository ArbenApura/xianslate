// IMPORTED DEP-TYPES
import type { DecodedIdToken } from 'firebase-admin/auth';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
// IMPORTED MODULES
import { db } from '../db';
import { users, type User } from '../db/schema';

// -- TYPES -- //

// THE AUTHENTICATED USER SHAPE STORED ON event.locals.user (SEE src/app.d.ts). MIRRORS the users ROW.
export type AuthUser = {
	id: string;
	email: string;
	emailVerified: boolean;
	name: string | null;
	avatarUrl: string | null;
	role: 'user' | 'admin';
	createdAt: number;
};

// -- FUNCTIONS -- //

function toAuthUser(u: User): AuthUser {
	return {
		id: u.id,
		email: u.email,
		emailVerified: u.emailVerified,
		name: u.name,
		avatarUrl: u.avatarUrl,
		role: u.role,
		createdAt: u.createdAt,
	};
}

// UPSERT THE users ROW FROM A VERIFIED FIREBASE TOKEN AND RETURN THE AUTHENTICATED USER. READ-FIRST SO A
// HOT PATH (hooks RUNS THIS PER REQUEST) ONLY WRITES WHEN THE PROFILE ACTUALLY CHANGED OR THE ROW IS NEW —
// NOT ON EVERY REQUEST. role IS DB-OWNED (DEFAULTS TO 'user' ON INSERT) AND IS NEVER OVERWRITTEN HERE, SO
// AN ADMIN STAYS AN ADMIN ACROSS SIGN-INS.
export async function upsertUserFromToken(decoded: DecodedIdToken): Promise<AuthUser> {
	const id = decoded.uid;
	const email = decoded.email ?? '';
	const emailVerified = !!decoded.email_verified;
	const name = (decoded.name as string | undefined) ?? null;
	const avatarUrl = (decoded.picture as string | undefined) ?? null;

	const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
	if (existing) {
		const changed =
			existing.email !== email ||
			existing.emailVerified !== emailVerified ||
			existing.name !== name ||
			existing.avatarUrl !== avatarUrl;
		if (!changed) return toAuthUser(existing);
		const [updated] = await db
			.update(users)
			.set({ email, emailVerified, name, avatarUrl })
			.where(eq(users.id, id))
			.returning();
		return toAuthUser(updated);
	}

	// FIRST VERIFIED SIGN-IN — INSERT (onConflictDoUpdate GUARDS A RACE BETWEEN TWO CONCURRENT FIRST REQUESTS).
	const [created] = await db
		.insert(users)
		.values({ id, email, emailVerified, name, avatarUrl })
		.onConflictDoUpdate({ target: users.id, set: { email, emailVerified, name, avatarUrl } })
		.returning();
	return toAuthUser(created);
}

// THROW A 401 UNLESS A USER IS AUTHENTICATED — FOR USE INSIDE /api/* HANDLERS (hooks ALREADY 401s, BUT THIS
// NARROWS locals.user FROM AuthUser|null TO AuthUser AT THE CALL SITE).
export function requireUser(locals: App.Locals): AuthUser {
	if (!locals.user) throw error(401, 'Sign in required.');
	return locals.user;
}
