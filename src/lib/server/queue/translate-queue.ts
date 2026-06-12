// IMPORTED DEP-TYPES
import type { Redis as RedisClient } from 'ioredis';
import type { Queue as QueueType } from 'bullmq';
// IMPORTED TYPES
import type { TranslationEvent } from '../translation-service';
// IMPORTED DEP-MODULES
import { Queue } from 'bullmq';
// IMPORTED MODULES
import {
	eventsChannel,
	hasRedis,
	newBullConnection,
	readBufferedEvents,
	redisSubscriber,
} from '../redis';

// -- TYPES -- //

// THE BullMQ JOB PAYLOAD. job id = String(chapterId) SO DUPLICATE REQUESTS COLLAPSE (NO DOUBLE-BILLING).
export type TranslateJobData = {
	chapterId: number;
	force: boolean;
	autoExtract: boolean;
	model: string;
	userId: string;
};

export const TRANSLATE_QUEUE = 'translate';

// -- STATES -- //

let queue: QueueType<TranslateJobData> | undefined;

// CHANNEL → SET OF LISTENERS, MULTIPLEXED OVER A SINGLE SUBSCRIBER CONNECTION (ioredis FANS 'message' OUT).
const channelHandlers = new Map<string, Set<(payload: string) => void>>();

let dispatcherWired = false;

// -- FUNCTIONS -- //

// THE LAZY BullMQ QUEUE SINGLETON (PRODUCER SIDE). NULL WHEN NO REDIS IS CONFIGURED.
function translateQueue(): QueueType<TranslateJobData> | null {
	if (!hasRedis()) return null;
	if (!queue) queue = new Queue<TranslateJobData>(TRANSLATE_QUEUE, { connection: newBullConnection() });
	return queue ?? null;
}

// WIRE THE SINGLE 'message' DISPATCHER ONCE (ROUTES EACH CHANNEL'S PAYLOAD TO ITS REGISTERED LISTENERS).
function ensureDispatcher(sub: RedisClient): void {
	if (dispatcherWired) return;
	dispatcherWired = true;
	sub.on('message', (channel: string, payload: string) => {
		const set = channelHandlers.get(channel);
		if (!set) return;
		for (const fn of set) {
			try {
				fn(payload);
			} catch {
				// A DEAD LISTENER MUST NOT KILL THE OTHERS
			}
		}
	});
}

// ENQUEUE A TRANSLATION (PRODUCER). jobId = chapterId COLLAPSES DUPLICATES; A force RUN REMOVES ANY PRIOR
// WAITING/COMPLETED JOB FIRST SO IT ACTUALLY RE-RUNS. removeOn* KEEPS REDIS TIDY.
export async function enqueueTranslation(data: TranslateJobData): Promise<void> {
	const q = translateQueue();
	if (!q) return;
	const jobId = String(data.chapterId);
	if (data.force) await q.remove(jobId).catch(() => {});
	await q.add(TRANSLATE_QUEUE, data, {
		jobId,
		removeOnComplete: { age: 600, count: 200 },
		removeOnFail: { age: 600, count: 200 },
	});
}

// SUBSCRIBE A LISTENER TO A CHAPTER'S EVENT STREAM (CONSUMER, e.g. THE SSE ENDPOINT). REPLAYS THE CAPPED
// BACKLOG FIRST, THEN STREAMS LIVE — IN ORDER, DEDUPED, SO A CLIENT THAT RECONNECTS TO A DIFFERENT WEB
// INSTANCE STILL SEES THE WHOLE STREAM. RETURNS AN UNSUBSCRIBE FN.
export async function subscribeToTranslation(
	chapterId: number,
	onEvent: (evt: TranslationEvent) => void,
): Promise<() => void> {
	const channel = eventsChannel(chapterId);
	const sub = redisSubscriber();
	ensureDispatcher(sub);

	// BUFFER LIVE EVENTS UNTIL THE BACKLOG IS REPLAYED, SO ORDER IS PRESERVED EVEN IF A LIVE EVENT ARRIVES
	// MID-REPLAY. seen DEDUPES THE BACKLOG↔LIVE OVERLAP.
	const seen = new Set<string>();
	const liveBuffer: string[] = [];
	let flushing = true;
	const emit = (payload: string) => {
		if (seen.has(payload)) return;
		seen.add(payload);
		try {
			onEvent(JSON.parse(payload) as TranslationEvent);
		} catch {
			// IGNORE A MALFORMED PAYLOAD
		}
	};
	const handle = (payload: string) => {
		if (flushing) liveBuffer.push(payload);
		else emit(payload);
	};

	let set = channelHandlers.get(channel);
	if (!set) {
		set = new Set();
		channelHandlers.set(channel, set);
	}
	set.add(handle);
	await sub.subscribe(channel);

	// REPLAY THE BACKLOG, THEN FLUSH ANY LIVE EVENTS THAT ARRIVED DURING THE READ (SYNCHRONOUS — NO RACE).
	const backlog = await readBufferedEvents(chapterId);
	for (const p of backlog) emit(p);
	for (const p of liveBuffer) emit(p);
	flushing = false;

	return () => {
		const s = channelHandlers.get(channel);
		if (s) {
			s.delete(handle);
			if (s.size === 0) {
				channelHandlers.delete(channel);
				sub.unsubscribe(channel).catch(() => {});
			}
		}
	};
}

// CHAPTER ids WITH AN ACTIVE OR WAITING TRANSLATION JOB (DRIVES THE LIVE 'TRANSLATING' BADGES IN QUEUE MODE,
// ACROSS INSTANCES). EMPTY WHEN NO REDIS.
export async function activeChapterIds(): Promise<number[]> {
	const q = translateQueue();
	if (!q) return [];
	const jobs = await q.getJobs(['active', 'waiting', 'delayed']);
	return jobs.map((j) => Number(j?.id)).filter((n) => Number.isInteger(n));
}
