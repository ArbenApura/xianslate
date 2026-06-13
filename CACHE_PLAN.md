# Persisted Caching — Implementation Plan (IndexedDB SWR)

_Scope chosen: an on-device IndexedDB stale-while-revalidate (SWR) cache for read-path GETs. Zero new dependencies. Web (SSR) + Capacitor (SPA). This is a plan for review — no code written yet._

---

## 1. Goal

Make already-seen data **instant and offline-capable** on both web and Android:

- Opening a chapter you've viewed before paints **immediately** from device storage, then silently revalidates.
- The library and chapter lists paint instantly on revisit.
- A dropped connection still lets you re-open cached chapters (critical for the Capacitor build).
- Less mobile data: bodies aren't re-downloaded on every back/forward.

It composes with what already exists:

- **Server translation cache** ([cache.ts](src/lib/server/cache.ts)) removes model *cost*. This plan removes *latency + network dependency* on the client.
- **Reader prefetch** already warms upcoming chapters server-side; with this cache those prefetched chapters open instantly from IndexedDB instead of re-downloading.

---

## 2. Strategy: cache-first + background revalidate (SWR)

For each cached GET:

1. Return the cached value **synchronously-ish** (one IDB read) so the UI paints now.
2. Fire the network request in the background; on success, update the store **and** rewrite the cache.
3. On network failure, keep showing the cached value (offline tolerance).

SvelteKit `load()` returns once and can't push later, so revalidation lives in the **component** (the reader / library already hold their data reactively and have natural mutation hooks). `load()` does the cache-first read; the component does the revalidate + write-through.

> Alternative considered: returning a streamed promise from `load()` (SvelteKit supports it). Rejected for v1 — it complicates the reader's existing auto-translate-on-load + streaming logic. Component-driven revalidate is simpler and equally instant.

---

## 3. Storage layer — `src/lib/cache/idb.ts` (new, zero-dep)

A ~70-line promise wrapper over a single IndexedDB object store. No library (keeps with the project's lean, dependency-light style).

```
DB:    xianslate-cache   (version 1)
store: kv  (keyPath: "key")
record: { key: string, data: unknown, ts: number, v: number }
```

API:

- `idbGet(key): Promise<Record | null>`
- `idbSet(key, data): Promise<void>`  // stamps ts + schema version
- `idbDel(key): Promise<void>`
- `idbDelByPrefix(prefix): Promise<void>`  // cursor sweep
- `idbAllKeys(): Promise<string[]>`
- `idbClear(): Promise<void>`

All calls are `browser`-guarded and wrapped in try/catch — a cache failure must **never** break a page (mirrors how `localStorage` is used in `settings.ts`). If IndexedDB is unavailable, every helper no-ops and the app behaves exactly as today.

---

## 4. Cache module — `src/lib/cache/readCache.ts` (new)

Owns key naming, versioning, the SWR helpers, and invalidation.

```
CACHE_VERSION = 1          // bump to invalidate everything on shape change
MAX_CHAPTER_ENTRIES = 200  // LRU cap on chapter-view bodies
```

**Key scheme** (namespaced by user, resume-param stripped so resume=1 ≡ no-resume):

```
key = `${userId}|${normalizedPath}`
  e.g.  u_abc123|/api/chapter?id=<uuid>
        u_abc123|/api/books
        u_abc123|/api/books/<id>
        u_abc123|/api/books/<id>/chapters
```

`userId` comes from the `currentUser` store (falls back to `anon` pre-auth). Namespacing prevents one account's data leaking to another on a shared device.

**Functions:**

- `cacheKey(path): string`
- `readCached<T>(path): Promise<T | null>` — returns cached `data` if version matches (ignores age; SWR keeps it fresh).
- `writeCached(path, data): Promise<void>` — write + bump LRU; enforce `MAX_CHAPTER_ENTRIES` for `…/api/chapter…` keys (evict oldest by `ts`).
- `cachedFirst<T>(path, fetcher): Promise<{ value: T; stale: boolean }>` — used in `load()`: cache hit → `{value, stale:true}` immediately (no network); miss → await `fetcher()`, store, `{value, stale:false}`.
- `revalidate<T>(path, fetcher): Promise<T | null>` — used in components: network fetch → store → return (null on failure, caller keeps cached value).
- Invalidation: `evictChapter(uuid)`, `evictBook(bookId)` (prefix sweep of all keys containing the book id), `evictBookLists()` (`/api/books`), `clearAllCache()`.

---

## 5. What we cache (and what we don't)

| Endpoint | Cache? | Key | Notes |
|---|---|---|---|
| `GET /api/chapter?id=<uuid>&resume=1` | ✅ | by uuid | The big win. Strip `resume` from the key; keep `resume=1` on the network revalidate so the resume-pointer side-effect still fires. |
| `GET /api/books` | ✅ | `/api/books` | Library list. |
| `GET /api/books/<id>` | ✅ | by id | Used by `ChapterList` (sidebar + TOC). |
| `GET /api/books/<id>/chapters` | ✅ | by id | Manage load + resume redirect. |
| `GET /api/books/<id>/translating` | ❌ | — | **Live poll** — never cache. |
| `GET /api/me` | ◯ optional | `/api/me` | Small; caching lets native cold-start show identity offline. Optional in v1. |
| Glossary GETs, stats, admin | ❌ v1 | — | Out of scope (glossary is editable; stats are diagnostic). |
| Any POST/DELETE/PUT, the translate SSE, `/api/translate-text` | ❌ | — | Mutations / streams are never cached. |

**Never cache an in-flight/partial chapter.** Only store a `ChapterView` once it's settled (has `contentTarget`, or is monolingual/source-only). Mid-stream translation output is not written.

---

## 6. Integration — file by file

### New files
- `src/lib/cache/idb.ts` — IDB wrapper (§3).
- `src/lib/cache/readCache.ts` — keys, SWR, invalidation (§4).

### `src/routes/app/book/[id]/[chapter]/+page.ts` (reader load)
- On `browser` + cache hit → return `{ view: cached, fromCache: true }` instantly (no network).
- Cache miss (or SSR) → fetch as today, `writeCached`, return `{ view, fromCache: false }`.

### `src/routes/app/book/[id]/[chapter]/+page.svelte` (reader)
- **Revalidate:** in `afterNavigate`/`onMount`, if `data.fromCache`, call `revalidate('/api/chapter?id=<uuid>&resume=1')` in the background; when it resolves and we're **not** mid-translation (`!translating`), apply the fresh view (and re-store). This also fires the resume side-effect.
- **Write-through on translate done:** where the stream sets `view.contentTarget = enText` / `titleTarget` (the `'done'` branch), `writeCached('/api/chapter?id=<uuid>', view)` so the next open is instant **and** translated; then `evictBook(bookId)` (chapter lists' `hasTarget`/counts changed).
- **Write-through on progress:** in `sendProgress`/`setChapterRead`, patch the cached chapter's `readProgress` (cheap) and `evictBookLists()` so the library's read counts refresh on next visit.
- **On add-chapter / fetch-neighbor:** `evictBook(bookId)` + `evictBookLists()`.

### `src/routes/app/+page.svelte` (library)
- `onMount`: `readCached('/api/books')` → paint instantly if present → then `revalidate('/api/books')` → update `booksList` + store.
- Mutations already in this file: `confirmDelete` → `evictBook(id)` + write new list; `fetchCover` → write patched list; `backfillTitles` → write patched list.

### `src/routes/app/book/[id]/+page.ts` and `manage/+page.ts`
- Wrap the `/api/books/<id>/chapters` fetch with `cachedFirst`; manage component revalidates on mount. Manage mutations (add/delete/reorder/edit-title/mark-read) call `evictBook(id)` + `evictBookLists()`.

### `src/lib/components/ChapterList.svelte`
- Wrap its `/api/books/<id>` fetch with `cachedFirst` + background `revalidate` so the sidebar/TOC paints instantly. (Its `/translating` poll stays uncached.)

### `src/lib/stores/auth.ts`
- In `signOutEverywhere`, call `clearAllCache()` before redirect — no cached data survives a sign-out. (User-namespaced keys already isolate accounts; this is belt-and-suspenders.)

---

## 7. Invalidation matrix

| Event (where) | Action |
|---|---|
| Translation completes (reader `'done'`) | write-through chapter view; `evictBook(id)`; `evictBookLists()` |
| Scroll progress / mark read·unread (reader, manage) | patch cached chapter `readProgress`; `evictBookLists()` |
| Add chapter (reader dialog, manage) | `evictBook(id)`; `evictBookLists()` |
| Delete chapter / reorder / edit title (manage) | `evictBook(id)`; `evictBookLists()` |
| Delete book (library) | `evictBook(id)`; rewrite `/api/books` |
| (Re)fetch cover, backfill titles (library) | rewrite `/api/books` |
| Sign out / account switch | `clearAllCache()` |
| Schema change | bump `CACHE_VERSION` → stale-version reads return null → natural rebuild |

Because every read also **revalidates**, most staleness self-heals within one visit; explicit eviction above only prevents showing obviously-wrong data immediately after a local mutation.

---

## 8. SSR & native

- **Web (`ssr=true`):** first paint is server-rendered (no IDB on the server — helpers no-op). On the client, navigations use the cache. No hydration risk: `load` returns the same shape; `fromCache` just selects the source.
- **Native (`ssr=false`, Capacitor):** `load` runs client-side via `apiFetch`; cache-first works fully and delivers the biggest win (offline reopen of seen chapters). IndexedDB is available in the WebView.

---

## 9. Edge cases & decisions

- **Resume pointer side-effect:** keep `resume=1` on the background revalidation fetch so the book's resume pointer still advances on a real view (today's behavior preserved).
- **Don't clobber a live stream:** apply a revalidated view only when `!translating`; otherwise drop it (the stream is authoritative).
- **Partial chapters:** never written to cache (only settled views).
- **LRU/size:** cap chapter-view entries at `MAX_CHAPTER_ENTRIES` (≈200; ~6 MB worst case). Book/list entries are few and small. Evict oldest by `ts` on write.
- **Quota / private mode / no IDB:** every cache op is try/caught and `browser`-guarded; failure = silently behave like today.
- **Account isolation:** keys namespaced by `userId`; full wipe on sign-out.
- **Versioning:** `CACHE_VERSION` gate discards old-shape records after a deploy that changes `ChapterView`/`BookSummary`.
- **Offline UX:** when revalidation fails and there's no cache, the existing `error()` path shows the not-found/offline state — unchanged. With cache, the user just reads the cached copy.

---

## 10. Validation & rollout

- A `PERSIST_CACHE` boolean constant in `readCache.ts` (default `true`) — flip to `false` to disable the whole layer instantly if anything misbehaves in the field.
- After build: `svelte-check` (0 errors), `eslint`, `prettier` — same gates as the design pass.
- Manual smoke (per `run`/`verify` skills): open chapter → reload → confirm instant paint; go offline → reopen a seen chapter → confirm it renders; translate a chapter → reopen → confirm instant + translated; delete a book → confirm it's gone from the library without a stale flash.
- Commit to the `refactor/svelte-guidelines` branch (open-editor buffers reverted uncommitted work during the design pass, so committing is how it survives).

---

## 11. Out of scope (future, noted in DESIGN_REVIEW)

- Server `ETag`/`Cache-Control` 304 revalidation (bandwidth win; complements this).
- Service-worker PWA offline (app shell + assets; mainly the web build).
- Caching the glossary read path (editable data; needs careful invalidation).

---

## 12. Effort estimate

~2 new files (~130 lines total) + small edits to 6 existing files (load + components, mostly 2–6 lines each at mutation points). Medium. No new dependencies. Fully reversible via the `PERSIST_CACHE` flag.
