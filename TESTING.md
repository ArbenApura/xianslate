# TESTING — HARNESS, MATRIX, AND COVERAGE

Everything here runs locally with `yarn test` (or `yarn test:coverage` for the coverage gate). CI runs
`yarn test:coverage`, `yarn run check`, `npx eslint src tests`, and `npx tsc --noEmit` on every push/PR.

## The harness

- **Vitest** (`vitest.config.ts`) is the single runner. The config compiles Svelte with
  `generate: 'dom'` (via `@sveltejs/vite-plugin-svelte` directly, **not** `sveltekit()` — vitest's SSR
  pipeline would compile components in SSR mode with no lifecycle) and wires the aliases the app normally
  gets from SvelteKit: `$lib`, `$env/dynamic/private` (a live `process.env` double so `vi.stubEnv` works),
  and `$app/environment`.
- **pg-mem** (`tests/helpers/pgmem.ts`) gives DB-dependent modules (`account-usage`, `spend-guard`,
  `glossary-match`) a real query engine via `drizzle-orm/pg-proxy`. The bridge interpolates params,
  rewrites aggregate expressions with aliases (pg-mem keys aggregates by function name alone), and returns
  positional rows — the three quirks that make drizzle run unchanged against it. The instance lives on
  `globalThis` so `vi.resetModules()` (needed to reload env-dependent modules) keeps returning the same DB.
- **fake-indexeddb** (`tests/offline/db.test.ts`) exercises the real IndexedDB wrapper, including the
  v1→v2 outbox migration (a v1 keyless store seeded manually, then reopened at v2).
- **jsdom + @testing-library/svelte v4** for component tests.

### Known harness limitation

Svelte 4 `onMount`/`onDestroy` do **not** fire for components mounted under vitest+jsdom (the vite SSR
import rewrite of the DOM-compiled module breaks the dev-runtime scheduler). Consequences:

- Pure-render/interaction component tests work: `Modal`, `TocDrawer`.
- Lifecycle-driven components (`ChapterList`, `OfflineBanner`, the reader page) are covered by the **pure
  logic suites** (outbox-core, db, gate, reader-progress) plus **live emulator checks** — not by mounted
  component tests. If lifecycle tests are ever needed, that is a harness-fixing task, not a test-writing one.

## Feature → test matrix

| Feature | Suite | What is pinned |
|---|---|---|
| Offline datastore | `tests/offline/db.test.ts` | meta/toc/chapter/glossary/cover round-trips; outbox FIFO + user partitioning + remove; `clearUserData` user-scoping; **v1→v2 outbox migration**; `glossaryKey` format |
| Outbox replay decisions | `tests/outbox-core.test.ts` | full status matrix (transient 4xx retry vs permanent drop, 5xx retry, no-status retry); `mergeOfflineRows` dedupe/cap; offline search/paging |
| Offline gate | `tests/offline/gate.test.ts` | `requireOnline` blocks with a feature-named toast; banner mirrors the inverse of the online store |
| Reading-progress guard (P1 fix) | `tests/reader-progress.test.ts` | `computeSeen` fraction; **no advancement while translating or restoring**; monotonic |
| Usage stats (account page) | `tests/server/account-usage.test.ts` | totals reconcile body+pipeline+map+fetch; **standalone attribution**; **no map double-count**; user isolation; legacy-unstamped exclusion; per-book breakdown |
| Quota/rate limit | `tests/server/spend-guard.test.ts` | **UTC calendar-day window** boundaries; attribution; RPM 429; budget 429; **`AI_DAILY_BUDGET_USD=0` disables the budget** (the `0||5` parse bug this caught) |
| AI cost math | `tests/server/deepseek.test.ts` | token/price computation; cache-hit cheaper than cold |
| SSRF guard | `tests/server/fetcher.test.ts` | private-address matrix (v4/v6/mapped, metadata, multicast/reserved/broadcast); resolve→reject; pin return |
| Glossary matching | `tests/server/glossary-match.test.ts` | **coverage-aware longest match (齊天 regression)**; true-fragment drop; word boundaries; aliases; `sourcesPresentIn` |
| Glossary chunking | `tests/server/glossary.test.ts` | paragraph-aligned splitter; `MAX_EXTRACT_CHUNKS` cost cap |
| Web/novel parsing | `tests/site-parser.test.ts` | adapter selectors, nav guards, title sanity, `sanitizeMap` fixpoint |
| TXT import | `tests/server/ingest-txt.test.ts` | heading split (zh/ja/ko/en), **fallback title for heading-less files** (a fix this caught), empty rejection |
| EPUB import | `tests/server/epub.test.ts` | real mini-EPUBs: title/author/chapters, zip-bomb guard, single-doc heading split, **no double-decode of `&amp;#65;`** (a real bug this caught) |
| Component a11y/interaction | `tests/ui/modal.test.ts`, `tests/ui/tocdrawer.test.ts` | dialog accessible names (**Modal `aria-labelledby` fix**), Escape/backdrop close, conditional render |
| Invariants (property) | `tests/property.test.ts` | classifyOutcome totality/permanence; merge window; **UTC day-partition math**; `computeSeen` bounds/monotonicity; `sanitizeMap` fixpoint |

## Coverage

`yarn test:coverage` gates CI at **lines 45 / statements 40 / functions 50 / branches 28** over the modules
the suite actually exercises (server + offline core + reader-progress; the full `src/lib` set is ~26% because
client-only modules like `firebase.ts`/`api.ts`/`markup.ts` are deliberately never imported by unit tests).

**Growth path to the 65% target**: the big remaining surfaces are `site-parser.ts` (~1,200 lines) and
`fetcher.ts` (fetch paths beyond `assertPublicUrl`). Property-testing the parser against generated HTML and
driving `fetchChapter` with mocked network layers would move both materially.

## Running

```bash
yarn test              # fast: tests only
yarn test:coverage     # tests + coverage gate (CI uses this)
yarn run check         # svelte-check (0 errors / 0 warnings expected)
npx tsc --noEmit       # type gate
npx eslint src tests   # lint gate
```
