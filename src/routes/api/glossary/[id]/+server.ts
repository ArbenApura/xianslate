import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteTerm, updateTerm } from '$lib/server/glossary';
import type { RequestHandler } from './$types';

// STRICT POSITIVE-INTEGER PK PARSE — REJECTS "3.9", "0x10", " 3 ", "3abc" THAT Number() WOULD COERCE.
function parseId(s: string): number | null {
	if (!/^\d+$/.test(s)) return null;
	const n = Number(s);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const PutBody = z.object({
	raw: z.string().min(1).optional(),
	translation: z.string().min(1).optional(),
	gender: z.enum(['neuter', 'masculine', 'feminine']).optional(),
	tags: z.string().nullable().optional(),
});

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseId(params.id);
	if (id === null) throw error(400, 'Invalid id.');
	const parsed = PutBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Invalid update.');
	const row = await updateTerm(id, parsed.data);
	if (!row) throw error(404, 'Term not found.');
	return json(row);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseId(params.id);
	if (id === null) throw error(400, 'Invalid id.');
	await deleteTerm(id);
	return json({ ok: true });
};
