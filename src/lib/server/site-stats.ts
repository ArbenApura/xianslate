// FETCH-OUTCOME LOGGING + AI-SPEND LEDGER, AND THE AGGREGATE QUERY BEHIND THE /admin DASHBOARD.
//
// EVERY WEB-CHAPTER FETCH RECORDS ONE site_events ROW (SUCCESS OR A TYPED FAILURE), AND EVERY
// SITE-MAPPING MODEL CALL RECORDS ONE ai_usage ROW. ALL WRITES ARE BEST-EFFORT: LOGGING MUST NEVER
// BREAK A FETCH, SO FAILURES HERE ARE SWALLOWED.

// IMPORTED TYPES
import type { TranslationUsage } from '$lib/types';
// IMPORTED DEP-MODULES
import { desc, eq, sql } from 'drizzle-orm';
// IMPORTED MODULES
import { db } from './db';
import { aiUsage, siteAdapters, siteEvents, translations } from './db/schema';
import { isFetchError } from './fetch-error';

// -- TYPES -- //

export type DashboardSite = {
	host: string;
	supported: boolean;
	version: number | null;
	model: string | null;
	learnedAt: number | null;
	fetches: number;
	errors: number;
	lastFetchAt: number | null;
};

export type DashboardErrorKind = { kind: string; status: number; count: number };

export type DashboardErrorRow = {
	id: number;
	host: string;
	url: string;
	kind: string;
	status: number;
	message: string | null;
	createdAt: number;
};

export type DashboardCostBucket = {
	label: string;
	calls: number;
	promptTokens: number;
	completionTokens: number;
	costUsd: number;
};

export type Dashboard = {
	sites: DashboardSite[];
	errorKinds: DashboardErrorKind[];
	recentErrors: DashboardErrorRow[];
	cost: { total: number; buckets: DashboardCostBucket[] };
	totals: { fetches: number; ok: number; errors: number };
};

// -- CONSTANTS -- //

// HUMAN LABEL PER ai_usage.kind FOR THE DASHBOARD COST BREAKDOWN. AN UNKNOWN KIND FALLS BACK TO ITS RAW
// VALUE, SO ADDING A NEW LEDGER KIND NEVER VANISHES FROM THE TOTAL — IT JUST SHOWS UNDER ITS OWN NAME.
const AI_KIND_LABELS: Record<string, string> = {
	map: 'Site mapping',
	extract: 'Term extraction',
	title: 'Title translation',
	term: 'Glossary terms',
	repair: 'Leak repair',
};

// -- FUNCTIONS -- //

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return 'unknown';
	}
}

export async function recordFetchOk(url: string): Promise<void> {
	try {
		await db.insert(siteEvents).values({ host: hostOf(url), url, ok: 1, kind: 'ok', status: 200 });
	} catch {
		// BEST-EFFORT — LOGGING MUST NOT BREAK A FETCH.
	}
}

export async function recordFetchError(url: string, e: unknown): Promise<void> {
	try {
		const fe = isFetchError(e) ? e : null;
		await db.insert(siteEvents).values({
			host: hostOf(url),
			url,
			ok: 0,
			kind: fe?.kind ?? 'parse_failed',
			status: fe?.status ?? 502,
			message: fe?.message ?? (e instanceof Error ? e.message : 'Unknown error'),
		});
	} catch {
		// BEST-EFFORT.
	}
}

export async function recordMapUsage(host: string, usage: TranslationUsage): Promise<void> {
	try {
		await db.insert(aiUsage).values({
			kind: 'map',
			host,
			model: usage.model,
			promptTokens: usage.promptTokens,
			cachedTokens: usage.cachedTokens,
			completionTokens: usage.completionTokens,
			costUsd: usage.costUsd,
		});
	} catch {
		// BEST-EFFORT.
	}
}

// LEDGER ONE NON-TRANSLATION-CACHE MODEL CALL (kind = 'extract' | 'title' | 'term' | 'repair'). THESE ARE
// PER-CHAPTER PIPELINE EXPENSES THAT DON'T LAND IN THE translations CACHE ROW, SO WITHOUT THIS THEY WERE
// SPENT BUT NEVER COUNTED. PASS chapterId FOR CHAPTER-SCOPED CALLS SO THE STATS DIALOG CAN ATTRIBUTE THEM
// (NULL FOR BOOK/TEXT-LEVEL CALLS LIKE A TITLE BACKFILL). A ZERO-COST / NO-OP CALL (CACHED TITLE REUSE,
// NO-RESIDUE REPAIR) IS SKIPPED SO THE LEDGER STAYS MEANINGFUL.
export async function recordAiUsage(kind: string, usage: TranslationUsage, chapterId?: number | null): Promise<void> {
	if (!usage || (usage.promptTokens === 0 && usage.completionTokens === 0 && usage.costUsd === 0)) return;
	try {
		await db.insert(aiUsage).values({
			kind,
			chapterId: chapterId ?? null,
			model: usage.model,
			promptTokens: usage.promptTokens,
			cachedTokens: usage.cachedTokens,
			completionTokens: usage.completionTokens,
			costUsd: usage.costUsd,
		});
	} catch {
		// BEST-EFFORT — LEDGER WRITES MUST NEVER BREAK THE PIPELINE.
	}
}

const N = (v: unknown): number => Number(v ?? 0);

// AGGREGATE EVERYTHING THE DASHBOARD SHOWS IN ONE CALL: PER-HOST FETCH STATS (JOINED WITH LEARNED
// ADAPTERS), ERRORS GROUPED BY KIND + RECENT FAILURES, AND TOTAL AI SPEND (MAPPING ∪ TRANSLATION).
export async function getDashboard(): Promise<Dashboard> {
	const [adapters, okRows, errRows, errByKind, recent, aiAgg, trAgg] = await Promise.all([
		db.select().from(siteAdapters),
		db
			.select({
				host: siteEvents.host,
				n: sql<number>`count(*)`,
				last: sql<number>`max(${siteEvents.createdAt})`,
			})
			.from(siteEvents)
			.where(eq(siteEvents.ok, 1))
			.groupBy(siteEvents.host),
		db
			.select({ host: siteEvents.host, n: sql<number>`count(*)` })
			.from(siteEvents)
			.where(eq(siteEvents.ok, 0))
			.groupBy(siteEvents.host),
		db
			.select({ kind: siteEvents.kind, status: sql<number>`max(${siteEvents.status})`, n: sql<number>`count(*)` })
			.from(siteEvents)
			.where(eq(siteEvents.ok, 0))
			.groupBy(siteEvents.kind),
		db
			.select({
				id: siteEvents.id,
				host: siteEvents.host,
				url: siteEvents.url,
				kind: siteEvents.kind,
				status: siteEvents.status,
				message: siteEvents.message,
				createdAt: siteEvents.createdAt,
			})
			.from(siteEvents)
			.where(eq(siteEvents.ok, 0))
			.orderBy(desc(siteEvents.createdAt))
			.limit(50),
		db
			.select({
				kind: aiUsage.kind,
				calls: sql<number>`count(*)`,
				pt: sql<number>`coalesce(sum(${aiUsage.promptTokens}),0)`,
				ct: sql<number>`coalesce(sum(${aiUsage.completionTokens}),0)`,
				cost: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)`,
			})
			.from(aiUsage)
			.groupBy(aiUsage.kind),
		db
			.select({
				calls: sql<number>`count(*)`,
				pt: sql<number>`coalesce(sum(${translations.promptTokens}),0)`,
				ct: sql<number>`coalesce(sum(${translations.completionTokens}),0)`,
				cost: sql<number>`coalesce(sum(${translations.costUsd}),0)`,
			})
			.from(translations),
	]);

	const adapterByHost = new Map(adapters.map((a) => [a.host, a]));
	const okByHost = new Map(okRows.map((r) => [r.host, r]));
	const errByHost = new Map(errRows.map((r) => [r.host, N(r.n)]));

	// EVERY HOST WE KNOW ABOUT: A LEARNED ADAPTER, OR ANY HOST THAT HAS EVER BEEN FETCHED.
	const hosts = new Set<string>([...adapterByHost.keys(), ...okByHost.keys(), ...errByHost.keys()]);
	const sites: DashboardSite[] = [...hosts]
		.map((host) => {
			const a = adapterByHost.get(host);
			const ok = okByHost.get(host);
			const fetches = N(ok?.n);
			return {
				host,
				supported: Boolean(a) || fetches > 0,
				version: a?.version ?? null,
				model: a?.model ?? null,
				learnedAt: a?.createdAt ?? null,
				fetches,
				errors: errByHost.get(host) ?? 0,
				lastFetchAt: ok?.last ? N(ok.last) : null,
			};
		})
		.sort((a, b) => b.fetches - a.fetches || a.host.localeCompare(b.host));

	const tr = trAgg[0];
	// ONE BUCKET PER ai_usage KIND (SITE MAPPING, TERM EXTRACTION, TITLE/TERM TRANSLATION, LEAK REPAIR) PLUS
	// THE PER-CHAPTER BODY TRANSLATION FROM THE translations CACHE — TOGETHER THE COMPLETE AI SPEND. SORTED
	// BY COST SO THE BIGGEST LINE ITEMS LEAD.
	const buckets: DashboardCostBucket[] = [
		{
			label: 'Translation',
			calls: N(tr?.calls),
			promptTokens: N(tr?.pt),
			completionTokens: N(tr?.ct),
			costUsd: N(tr?.cost),
		},
		...aiAgg.map((r) => ({
			label: AI_KIND_LABELS[r.kind] ?? r.kind,
			calls: N(r.calls),
			promptTokens: N(r.pt),
			completionTokens: N(r.ct),
			costUsd: N(r.cost),
		})),
	].sort((a, b) => b.costUsd - a.costUsd);

	const okTotal = okRows.reduce((s, r) => s + N(r.n), 0);
	const errTotal = errRows.reduce((s, r) => s + N(r.n), 0);

	return {
		sites,
		errorKinds: errByKind
			.map((r) => ({ kind: r.kind, status: N(r.status), count: N(r.n) }))
			.sort((a, b) => b.count - a.count),
		recentErrors: recent.map((r) => ({ ...r, status: N(r.status), createdAt: N(r.createdAt) })),
		cost: { total: buckets.reduce((s, b) => s + b.costUsd, 0), buckets },
		totals: { fetches: okTotal + errTotal, ok: okTotal, errors: errTotal },
	};
}
