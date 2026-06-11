// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { createEmptyBook, listBooks } from '$lib/server/books';

// -- CONSTANTS -- //

const CreateBody = z.object({
	title: z.string().trim().min(1),
	author: z.string().trim().optional(),
	// THE BOOK'S TRANSLATION DIRECTION (DEFAULTS TO zh-Hant → en WHEN OMITTED).
	sourceLang: z.string().optional(),
	targetLang: z.string().optional(),
});

// -- FUNCTIONS -- //

export const GET: RequestHandler = async () => {
	return json(await listBooks());
};

// CREATE AN EMPTY (MANUALLY-MANAGED) BOOK — LETS THE USER CURATE A GLOSSARY BEFORE ADDING CHAPTERS
export const POST: RequestHandler = async ({ request }) => {
	const parsed = CreateBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A book title is required.');
	const { title, author, sourceLang, targetLang } = parsed.data;
	const pair = sourceLang && targetLang ? { sourceLang, targetLang } : undefined;
	const { id } = await createEmptyBook({ title, author, pair });
	return json({ id });
};
