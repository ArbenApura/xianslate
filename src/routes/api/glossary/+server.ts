// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { addTerm, getGlossaryPage } from '$lib/server/glossary';
// IMPORTED TYPES
import type { RequestHandler } from './$types';

// -- CONSTANTS -- //

const scopeSchema = z.enum(['global', 'book']);

const PostBody = z.object({
	scope: scopeSchema,
	bookId: z.string().nullable().optional(),
	raw: z.string().min(1),
	translation: z.string().min(1),
	gender: z.enum(['neuter', 'masculine', 'feminine']).default('neuter'),
	tags: z.string().nullable().optional(),
});

// -- FUNCTIONS -- //

export const GET: RequestHandler = async ({ url }) => {
	// safeParse → 400 (NOT AN UNHANDLED ZodError → 500) FOR A BAD ?scope= VALUE.
	const scopeResult = scopeSchema.safeParse(url.searchParams.get('scope') ?? 'global');
	if (!scopeResult.success) throw error(400, 'scope must be global or book.');
	const scope = scopeResult.data;
	const bookId = url.searchParams.get('bookId');
	if (scope === 'book' && !bookId) throw error(400, 'bookId is required for book scope.');

	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
	const pageSize = Math.min(200, Math.max(10, Number(url.searchParams.get('pageSize') ?? '50') || 50));
	const q = url.searchParams.get('q') ?? '';

	const { rows, total } = await getGlossaryPage(scope, bookId, { q, limit: pageSize, offset: (page - 1) * pageSize });
	return json({ rows, total, page, pageSize });
};

export const POST: RequestHandler = async ({ request }) => {
	const parsed = PostBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Invalid term.');
	const { scope, bookId, raw, translation, gender, tags } = parsed.data;
	if (scope === 'book' && !bookId) throw error(400, 'bookId is required for book scope.');
	const row = await addTerm(scope, bookId ?? null, { raw, translation, gender, tags: tags ?? null });
	return json(row, { status: 201 });
};
