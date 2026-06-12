// IMPORTED DEP-TYPES
import type { Worker as WorkerType } from 'bullmq';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { Worker } from 'bullmq';
// IMPORTED MODULES
import { getGlobalConcurrency, hasRedis, newBullConnection, publishTranslationEvent } from '../redis';
import { ensureTranslationJob, subscribe } from '../translation-service';
import { TRANSLATE_QUEUE, type TranslateJobData } from './translate-queue';

// -- STATES -- //

let worker: WorkerType<TranslateJobData> | undefined;

// -- FUNCTIONS -- //

// PROCESS ONE QUEUED TRANSLATION: DRIVE THE EXISTING IN-MEMORY PIPELINE *IN THIS WORKER PROCESS* AND MIRROR
// EACH TranslationEvent TO REDIS (THE WEB TIER SUBSCRIBES). RESOLVES THE BullMQ JOB WHEN THE PIPELINE EMITS
// done/error. COMPLETION STILL PERSISTS TO POSTGRES INSIDE run(), SO A REDIS LOSS IS SAFE.
function processJob(data: TranslateJobData): Promise<void> {
	return new Promise<void>((resolve) => {
		const job = ensureTranslationJob(data.chapterId, data.force, data.autoExtract, data.model);
		const unsub = subscribe(job, (evt) => {
			void publishTranslationEvent(data.chapterId, JSON.stringify(evt));
			if (evt.type === 'done' || evt.type === 'error') {
				unsub();
				resolve();
			}
		});
	});
}

// START THE BullMQ WORKER (IDEMPOTENT). concurrency = THE RUNTIME-ADJUSTABLE GLOBAL DEEPSEEK CAP; AN OPTIONAL
// limiter ENFORCES DEEPSEEK'S REQUESTS-PER-MINUTE CEILING (DEEPSEEK_RPM). RETURNS null WITHOUT REDIS.
export async function startTranslateWorker(): Promise<WorkerType<TranslateJobData> | null> {
	if (!hasRedis()) return null;
	if (worker) return worker;
	const concurrency = await getGlobalConcurrency();
	const rpm = Math.max(0, Number(env.DEEPSEEK_RPM ?? '0') || 0);
	worker = new Worker<TranslateJobData>(TRANSLATE_QUEUE, (job) => processJob(job.data), {
		connection: newBullConnection(),
		concurrency,
		...(rpm ? { limiter: { max: rpm, duration: 60_000 } } : {}),
	});
	worker.on('error', (e) => console.error('[translate-worker] error:', e));
	console.log(`[translate-worker] started (concurrency=${concurrency}${rpm ? `, ${rpm}/min` : ''})`);
	return worker;
}
