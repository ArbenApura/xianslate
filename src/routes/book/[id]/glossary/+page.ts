import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const res = await fetch(`/api/books/${params.id}`);
	const bookTitle = res.ok ? ((await res.json()).book?.title ?? '') : '';
	return { bookId: params.id, bookTitle };
};
