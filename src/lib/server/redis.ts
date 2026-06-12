// IMPORTED DEP-TYPES
import type { ConnectionOptions } from 'bullmq';
import type { Redis as RedisClient } from 'ioredis';
// IMPORTED ENVS ($env/...)
import { env } from '$env/dynamic/private';
// IMPORTED DEP-MODULES
import { Redis } from 'ioredis';

// -- CONSTANTS -- //

const REDIS_URL = env.REDIS_URL ?? '';

// CAP + TTL FOR THE PER-CHAPTER EVENT REPLAY LIST (SO A (RE)CONNECTING SSE CLIENT CAN REPLAY RECENT EVENTS
// EVEN IF IT LANDS ON A DIFFERENT WEB INSTANCE THAN THE WORKER). A FINISHED TRANSLATION ALSO PERSISTS TO
// POSTGRES, SO LOSING THE LIST IS HARMLESS (THE NEXT READ HITS THE FREE contentTarget FAST PATH).
const EVENTS_CAP = 400;

const EVENTS_TTL_SEC = 600;

// RUNTIME-ADJUSTABLE GLOBAL DEEPSEEK CONCURRENCY (THE BullMQ WORKER CAP). STORED IN REDIS SO IT CAN BE
// CHANGED WITHOUT A REDEPLOY; SEEDS FROM DEEPSEEK_CONCURRENCY (DEFAULT 4).
const CONCURRENCY_KEY = 'config:deepseek_concurrency';

const DEFAULT_CONCURRENCY = Math.max(1, Number(env.DEEPSEEK_CONCURRENCY ?? '4') || 4);

// -- TYPES -- //

declare global {
	var __xianslateRedis: { client?: RedisClient; sub?: RedisClient } | undefined;
}

// -- STATES -- //

const store = globalThis.__xianslateRedis ?? (globalThis.__xianslateRedis = {});

// -- FUNCTIONS -- //

// IS A REDIS-BACKED (DISTRIBUTED) DEPLOYMENT CONFIGURED? WHEN false THE APP USES THE IN-MEMORY SINGLE-
// INSTANCE PATH (THE PHASE-0 BRIDGE) — TRANSLATION JOBS + CACHE INVALIDATION STAY PER-PROCESS.
export function hasRedis(): boolean {
	return !!REDIS_URL;
}

// SHARED COMMAND CLIENT (publish / lists / config reads+writes). NOT FOR SUBSCRIBE (A SUBSCRIBED CONNECTION
// CAN'T RUN NORMAL COMMANDS — USE redisSubscriber() FOR THAT). maxRetriesPerRequest:null KEEPS IT USABBLE
// BY BullMQ-ADJACENT CODE AND TOLERATES BRIEF OUTAGES.
export function redis(): RedisClient {
	if (!store.client) store.client = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
	return store.client;
}

// A DEDICATED SUBSCRIBER CONNECTION (REUSED — ioredis MULTIPLEXES MULTIPLE CHANNELS OVER ONE SUB CONNECTION).
export function redisSubscriber(): RedisClient {
	if (!store.sub) store.sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
	return store.sub;
}

// A FRESH CONNECTION FOR BullMQ (IT REQUIRES maxRetriesPerRequest:null AND OWNS/BLOCKS ITS OWN CONNECTIONS).
// TYPED AS BullMQ's ConnectionOptions VIA A CAST: bullmq BUNDLES ITS OWN ioredis COPY, SO OUR top-level
// ioredis Redis IS A NOMINAL MISMATCH FOR BullMQ's TYPE EVEN THOUGH IT'S STRUCTURALLY IDENTICAL AT RUNTIME.
export function newBullConnection(): ConnectionOptions {
	return new Redis(REDIS_URL, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;
}

// THE CURRENT GLOBAL DEEPSEEK CONCURRENCY (WORKER CAP). RUNTIME-ADJUSTABLE VIA setGlobalConcurrency().
export async function getGlobalConcurrency(): Promise<number> {
	if (!hasRedis()) return DEFAULT_CONCURRENCY;
	const raw = await redis().get(CONCURRENCY_KEY);
	const n = Number(raw);
	return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_CONCURRENCY;
}

export async function setGlobalConcurrency(n: number): Promise<void> {
	if (!hasRedis()) return;
	await redis().set(CONCURRENCY_KEY, String(Math.max(1, Math.floor(n))));
}

// CHANNEL + LIST KEYS FOR A CHAPTER'S TRANSLATION EVENT STREAM.
export function eventsChannel(chapterId: number): string {
	return `translate:${chapterId}`;
}

export function eventsListKey(chapterId: number): string {
	return `translate:${chapterId}:events`;
}

// APPEND AN EVENT TO THE CAPPED REPLAY LIST *AND* PUBLISH IT LIVE, IN ONE ROUND-TRIP.
export async function publishTranslationEvent(chapterId: number, payload: string): Promise<void> {
	const list = eventsListKey(chapterId);
	await redis()
		.multi()
		.rpush(list, payload)
		.ltrim(list, -EVENTS_CAP, -1)
		.expire(list, EVENTS_TTL_SEC)
		.publish(eventsChannel(chapterId), payload)
		.exec();
}

// READ THE BUFFERED REPLAY LIST FOR A CHAPTER (NEWEST WINDOW, OLDEST-FIRST).
export async function readBufferedEvents(chapterId: number): Promise<string[]> {
	return redis().lrange(eventsListKey(chapterId), 0, -1);
}

// CROSS-INSTANCE CACHE-INVALIDATION CHANNEL (glossary-match + site-adapter BROADCAST DROPS HERE).
export const INVALIDATION_CHANNEL = 'cache:invalidate';

// BROADCAST A CACHE-INVALIDATION MESSAGE TO EVERY INSTANCE (NO-OP WITHOUT REDIS — THE SINGLE PROCESS ALREADY
// CLEARED ITS OWN CACHE LOCALLY). src/lib/server/cache-bus.ts SUBSCRIBES AND APPLIES THE LOCAL DROP.
export async function publishInvalidation(msg: { kind: string; bookId?: string; host?: string }): Promise<void> {
	if (!hasRedis()) return;
	await redis().publish(INVALIDATION_CHANNEL, JSON.stringify(msg));
}
