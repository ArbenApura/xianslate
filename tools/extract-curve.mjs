import { createClient } from '@libsql/client';
const db = createClient({ url: 'file:./xianslate.db' });
const q = async (sql) => (await db.execute(sql)).rows;
const line = (s) => console.log(s);

// GLOSSARY SIZE PER BOOK + SCOPE
line('=== glossary rows by book/scope ===');
for (const r of await q(`SELECT book_id, scope, COUNT(*) n,
   SUM(LENGTH(source)+LENGTH(target)+COALESCE(LENGTH(context),0)) chars
   FROM glossary GROUP BY book_id, scope`))
  line(`book=${r.book_id ?? 'GLOBAL'} scope=${r.scope} terms=${r.n} chars=${r.chars}`);

// SATURATION CURVE: terms created over time, bucketed by creation order within each book.
// glossary.created_at is set when a term is first added (additive-only), so its growth vs
// chapter-extraction order shows whether new terms taper off.
line('\n=== new-term creation over chapter-extraction order (per book) ===');
const books = await q(`SELECT id, title FROM books`);
for (const b of books) {
  // chapters in seq order with their extractedAt
  const chs = await q(`SELECT seq, extracted_at FROM chapters
     WHERE book_id='${b.id}' AND extracted_at IS NOT NULL ORDER BY seq`);
  if (chs.length === 0) continue;
  // book-scope glossary creation timestamps
  const terms = await q(`SELECT created_at FROM glossary WHERE book_id='${b.id}' ORDER BY created_at`);
  // assign each term to the chapter whose extracted_at is the latest <= term.created_at
  const counts = new Map();
  for (const t of terms) {
    let assigned = chs[0].seq;
    for (const c of chs) { if (Number(c.extracted_at) <= Number(t.created_at)) assigned = c.seq; else break; }
    counts.set(assigned, (counts.get(assigned) ?? 0) + 1);
  }
  line(`\nBook: ${b.title}  (chapters extracted=${chs.length}, book-terms=${terms.length})`);
  let cum = 0;
  const seqs = chs.map(c => c.seq);
  const buckets = seqs.map(s => ({ s, n: counts.get(s) ?? 0 }));
  for (const bk of buckets) { cum += bk.n; line(`  ch.seq ${String(bk.s).padStart(3)}: +${String(bk.n).padStart(3)} new  (cum ${cum})`); }
}
await db.close();
