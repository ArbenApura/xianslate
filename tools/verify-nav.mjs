import { createClient } from '@libsql/client';

const db = createClient({ url: 'file:./xianslate.db' });
const numOf = (t) => (String(t).match(/第(\d+)章/) || [])[1] || '?';

const rows = (
	await db.execute(
		"SELECT seq, uuid, title_source FROM chapters WHERE book_id='25048' AND (title_source LIKE '第559章%' OR title_source LIKE '第560章%' OR title_source LIKE '第561章%' OR title_source LIKE '第562章%') ORDER BY seq",
	)
).rows;
const byNum = {};
for (const r of rows) byNum[numOf(r.title_source)] = r.uuid;

async function viewOf(uuid) {
	const res = await fetch(`http://localhost:3000/api/chapter?id=${uuid}`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

const uuidToNum = Object.fromEntries(Object.entries(byNum).map(([n, u]) => [u, n]));
const label = (u) => (u ? (uuidToNum[u] ?? u.slice(0, 8)) : '∅');

console.log('LIVE server (port 3000) chapter navigation for book 25048:');
for (const n of ['559', '561', '560', '562']) {
	const v = await viewOf(byNum[n]);
	console.log(`  Chapter ${n}:  prev = ${label(v.prevUuid)}   next = ${label(v.nextUuid)}   (nextUrl=${v.nextUrl ? 'kept' : 'null'})`);
}
console.log('\nExpected reading chain after the reorder: 559 → 561 → 560 → 562');
await db.close();
