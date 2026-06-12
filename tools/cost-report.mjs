import { createClient } from '@libsql/client';

const db = createClient({ url: 'file:./xianslate.db' });
const q = async (sql) => (await db.execute(sql)).rows;

const line = (s) => console.log(s);

// OVERALL TRANSLATION-ROW STATS
const agg = (
	await q(`
  SELECT COUNT(*) n,
         SUM(prompt_tokens) prompt, SUM(cached_tokens) cached,
         SUM(completion_tokens) completion, SUM(cost_usd) cost
  FROM translations`)
)[0];
line('=== translations table (cache rows = billed body translations) ===');
line(JSON.stringify(agg, null, 0));
line(
	`rows=${agg.n}  cost=$${Number(agg.cost).toFixed(4)}  avg/row=$${(Number(agg.cost) / Math.max(1, agg.n)).toFixed(5)}`,
);
const promptT = Number(agg.prompt),
	cachedT = Number(agg.cached),
	compT = Number(agg.completion);
line(`tokens: prompt=${promptT}  cached(of prompt)=${cachedT}  completion=${compT}`);
line(`cache-hit ratio on prompt = ${((cachedT / Math.max(1, promptT)) * 100).toFixed(1)}%`);

// COST SPLIT (recompute from tokens at code's default prices)
const PIN = 0.27 / 1e6,
	PHIT = 0.027 / 1e6,
	POUT = 1.1 / 1e6;
const miss = promptT - cachedT;
const cIn = miss * PIN,
	cHit = cachedT * PHIT,
	cOut = compT * POUT;
line(`cost split: input-miss=$${cIn.toFixed(4)}  input-hit=$${cHit.toFixed(4)}  output=$${cOut.toFixed(4)}`);
line(`output share of cost = ${((cOut / (cIn + cHit + cOut)) * 100).toFixed(1)}%`);

// PER MODEL
line('\n=== by model ===');
for (const r of await q(`SELECT model, COUNT(*) n, SUM(cost_usd) cost,
    SUM(prompt_tokens) p, SUM(completion_tokens) c FROM translations GROUP BY model`))
	line(`${r.model}: rows=${r.n} cost=$${Number(r.cost).toFixed(4)} prompt=${r.p} completion=${r.c}`);

// CHAPTER / BOOK COUNTS + EXTRACTION COVERAGE
const ch = (
	await q(`SELECT COUNT(*) n,
   SUM(content_target IS NOT NULL) translated,
   SUM(extracted_at IS NOT NULL) extracted FROM chapters`)
)[0];
line('\n=== chapters ===');
line(`total=${ch.n}  translated=${ch.translated}  extracted=${ch.extracted}`);
const books = (await q(`SELECT COUNT(*) n FROM books`))[0];
line(`books=${books.n}`);

// AVG CHAPTER SIZE (source chars) for translated chapters
const sz = (
	await q(`SELECT AVG(LENGTH(content_source)) avgsrc, AVG(LENGTH(content_target)) avgtgt
   FROM chapters WHERE content_target IS NOT NULL`)
)[0];
line(`avg source chars=${Math.round(sz.avgsrc)}  avg target chars=${Math.round(sz.avgtgt)}`);

// DISTRIBUTION OF completion tokens per row (body translation output)
const dist = (
	await q(`SELECT
   MIN(completion_tokens) mn, MAX(completion_tokens) mx, AVG(completion_tokens) av,
   AVG(prompt_tokens) ap, AVG(cached_tokens) ac FROM translations WHERE completion_tokens>0`)
)[0];
line('\n=== per-row token distribution (body) ===');
line(`completion: min=${dist.mn} max=${dist.mx} avg=${Math.round(dist.av)}`);
line(
	`prompt avg=${Math.round(dist.ap)}  cached avg=${Math.round(dist.ac)}  cache-hit/row=${((dist.ac / Math.max(1, dist.ap)) * 100).toFixed(0)}%`,
);

await db.close();
