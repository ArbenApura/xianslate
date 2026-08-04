// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { assertBookOwner } from '$lib/server/books';
import { db } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';

// -- CONSTANTS -- //

const FORMATS = new Set(['txt', 'md', 'json']);

// -- FUNCTIONS -- //

// A SAFE, SHORT FILENAME STEM FROM THE BOOK TITLE.
function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'book'
	);
}

// STRIP THE STORED INLINE MARKUP TAGS FOR PLAIN-TEXT / MARKDOWN OUTPUT (JSON KEEPS THE RAW CONTENT).
function stripTags(s: string): string {
	return s.replace(/<[^>]+>/g, '');
}

// DOWNLOAD A WHOLE BOOK AS txt / md / json. EACH CHAPTER PREFERS ITS TRANSLATION, FALLING BACK TO THE
// SOURCE. OWNER-SCOPED VIA assertBookOwner — A GUESSED bookId FROM ANOTHER LIBRARY 404s.
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = requireUser(locals);
	const book = await assertBookOwner(user.id, params.id);
	const format = (url.searchParams.get('format') ?? 'txt').toLowerCase();
	if (!FORMATS.has(format)) throw error(400, 'format must be txt, md, or json.');

	const rows = await db
		.select({
			seq: chapters.seq,
			titleSource: chapters.titleSource,
			titleTarget: chapters.titleTarget,
			contentSource: chapters.contentSource,
			contentTarget: chapters.contentTarget,
		})
		.from(chapters)
		.where(eq(chapters.bookId, book.id))
		.orderBy(asc(chapters.seq));

	const displayTitle = book.titleTarget ?? book.title;
	const displayAuthor = book.authorTarget ?? book.author;
	const stem = slugify(displayTitle);

	let bodyText: string;
	let contentType: string;
	let ext: string;

	if (format === 'json') {
		bodyText = JSON.stringify(
			{
				title: book.title,
				titleTarget: book.titleTarget,
				author: book.author,
				authorTarget: book.authorTarget,
				sourceLang: book.sourceLang,
				targetLang: book.targetLang,
				chapters: rows.map((r) => ({
					title: r.titleTarget ?? r.titleSource,
					titleSource: r.titleSource,
					content: r.contentTarget ?? r.contentSource,
					contentSource: r.contentSource,
				})),
			},
			null,
			2,
		);
		contentType = 'application/json; charset=utf-8';
		ext = 'json';
	} else {
		const md = format === 'md';
		const parts = rows.map((r) => {
			const t = stripTags(r.titleTarget ?? r.titleSource);
			const c = stripTags(r.contentTarget ?? r.contentSource);
			return md ? `## ${t}\n\n${c}` : `${t}\n\n${c}`;
		});
		const header = md
			? `# ${displayTitle}\n${displayAuthor ? `\n_${displayAuthor}_\n` : ''}\n`
			: `${displayTitle}\n${displayAuthor ? `${displayAuthor}\n` : ''}\n`;
		bodyText = header + parts.join(md ? '\n\n---\n\n' : '\n\n\n') + '\n';
		contentType = 'text/plain; charset=utf-8';
		ext = md ? 'md' : 'txt';
	}

	return new Response(bodyText, {
		headers: {
			'content-type': contentType,
			'content-disposition': `attachment; filename="${stem}.${ext}"`,
		},
	});
};
