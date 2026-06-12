// IMPORTED DEP-TYPES
import type { RequestHandler } from './$types';
// IMPORTED DEP-MODULES
import { error } from '@sveltejs/kit';
import { z } from 'zod';
// IMPORTED MODULES
import { resolveModel } from '$lib/server/deepseek';
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

export const POST: RequestHandler = async ({ request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'A numeric chapterId is required.');

	// START (OR ATTACH TO) THE PERSISTENT JOB — IT RUNS DETACHED AND SURVIVES THIS REQUEST
	const job = ensureTranslationJob(
		parsed.data.chapterId,
		parsed.data.force ?? false,
		parsed.data.autoExtract ?? false,
		resolveModel(parsed.data.model),
	);

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

			// OBSERVE THE JOB (REPLAYS BUFFERED EVENTS, THEN STREAMS LIVE ONES)
			const unsubscribe = subscribe(job, (evt) => {
				send(evt);
				if (evt.type === 'done' || evt.type === 'error') {
					stopHeartbeat();
					unsubscribe();
					close();
				}
			});

			// CLIENT WENT AWAY — STOP STREAMING, BUT THE JOB KEEPS RUNNING SERVER-SIDE
			request.signal.addEventListener('abort', () => {
				stopHeartbeat();
				unsubscribe();
				close();
			});
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
