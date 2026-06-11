import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { createEmptyBook, listBooks } from '$lib/server/books';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json(await listBooks());
};

const CreateBody = z.object({ title: z.string().trim().min(1), author: z.string().trim().optional() });

// CREATE AN EMPTY (MANUALLY-MANAGED) BOOK — LETS THE USER CURATE A GLOSSARY BEFORE ADDING CHAPTERS
export const POST: RequestHandler = async ({ request }) => {
	const parsed = CreateBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A book title is required.');
	const { id } = await createEmptyBook(parsed.data);
	return json({ id });
};
