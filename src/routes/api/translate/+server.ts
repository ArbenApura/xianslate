// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED TYPES
import type { TranslationEvent } from '$lib/server/translation-service';
// IMPORTED MODULES
import { requireUser } from '$lib/server/auth/user';
import { assertChapterOwner } from '$lib/server/books';
import { resolveModel } from '$lib/server/deepseek';
import { assertWithinQuota } from '$lib/server/spend-guard';
import { ensureTranslationJob, subscribe } from '$lib/server/translation-service';

// -- CONSTANTS -- //

const Body = z.object({
	chapterId: z.number().int().positive(),
	force: z.boolean().optional(),
	// AUTO-EXTRACT + SAVE GLOSSARY TERMS ONCE BEFORE TRANSLATING (READER PASSES THE USER'S SETTING)
	autoExtract: z.boolean().optional(),
	// THE GLOBAL MODEL PICK (flash/pro) — VALIDATED SERVER-SIDE; UNKNOWN VALUES FALL BACK TO THE DEFAULT.
	model: z.string().optional(),
});

// -- FUNCTIONS -- //

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	// BUDGET/RATE GUARD — A force RE-RUN BILLS THE WHOLE PIPELINE, SO CAP PER-USER SPEND BEFORE ANY WORK.
	await assertWithinQuota(user.id);
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A numeric chapterId is required.');

	// OWNERSHIP: VERIFY THE CALLER OWNS chapterId (JOIN TO book) *BEFORE* ATTACHING — STOPS A USER FROM
	// SUBSCRIBING TO ANOTHER USER'S TRANSLATION STREAM BY GUESSING A NUMERIC chapterId. 404 IF NOT OWNED.
	await assertChapterOwner(user.id, parsed.data.chapterId);

	const chapterId = parsed.data.chapterId;
	const force = parsed.data.force ?? false;
	const autoExtract = parsed.data.autoExtract ?? false;
	const model = resolveModel(parsed.data.model);

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(ctrl) {
			let closed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				try {
					ctrl.close();
				} catch {
					// ALREADY CLOSED
				}
			};
			const send = (evt: unknown) => {
				if (closed) return;
				try {
					ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
				} catch {
					closed = true;
				}
			};

			// HEARTBEAT: THE EXTRACT + TITLE STAGES CAN RUN MANY SECONDS BEFORE THE FIRST delta, AND AN IDLE
			// HTTP CONNECTION IS OFTEN DROPPED BY PROXIES/LOAD-BALANCERS AFTER 30-60s. A PERIODIC SSE COMMENT
			// (`: ping`) KEEPS BYTES ON THE WIRE WITHOUT AFFECTING THE EVENT STREAM THE CLIENT PARSES.
			const heartbeat = setInterval(() => {
				if (closed) return;
				try {
					ctrl.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					closed = true;
				}
			}, 15_000);
			const stopHeartbeat = () => clearInterval(heartbeat);

			// OBSERVE THE IN-MEMORY JOB. HOLD THE UNSUBSCRIBE IN A REF SO BOTH THE done/error PATH AND THE
			// abort PATH CAN TEAR DOWN EXACTLY ONE SUBSCRIPTION.
			let unsubscribe = () => {};
			const onEvent = (evt: TranslationEvent) => {
				send(evt);
				if (evt.type === 'done' || evt.type === 'error') {
					stopHeartbeat();
					unsubscribe();
					close();
				}
			};

			// CLIENT WENT AWAY — STOP STREAMING, BUT THE DETACHED JOB KEEPS RUNNING TO COMPLETION (IT PERSISTS).
			request.signal.addEventListener('abort', () => {
				stopHeartbeat();
				unsubscribe();
				close();
			});

			const job = ensureTranslationJob(chapterId, force, autoExtract, model, user.id);
			unsubscribe = subscribe(job, onEvent);
		},
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
			// DISABLE NGINX/PROXY RESPONSE BUFFERING — OTHERWISE THE STREAM IS HELD AND DELIVERED IN ONE LUMP.
			'x-accel-buffering': 'no',
		},
	});
};
