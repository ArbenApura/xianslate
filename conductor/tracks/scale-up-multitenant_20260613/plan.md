# Implementation Plan: Multi-User Scale-Up & Cross-Platform Delivery

**Track ID:** scale-up-multitenant_20260613
**Spec:** [spec.md](./spec.md)
**Created:** 2026-06-13
**Status:** [~] In Progress (Phases 0–1 complete)

## Overview

Eight phases, each independently verifiable. **Phase 0 is already done** (the `/app` route
refactor + the DeepSeek pricing fix). The remaining seven phases follow a dependency-aware order:
decouple `/app` from the server (1) and migrate the DB (2) — both independent — then layer
identity (3), tenancy + cost guardrails (4), the distributed queue (5), the Android build (6), and
finally hosting + end-to-end verification (7).

**Dependency graph:**

```
P1 (/app → API)  ─────────────┐
P2 (Postgres/Neon) ──► P3 (Firebase) ──► P4 (tenancy+quota) ──► P5 (Redis queue)
P1 + P3 ───────────────────────────────► P6 (Capacitor)
all ───────────────────────────────────► P7 (hosting + verify)
```

Per `workflow.md`: **flexible TDD** (tests for the breakage-prone logic — auth verification,
tenancy scoping, queue replay, the Postgres cache-key/glossary paths — not trivial glue);
**Conventional Commits**; **review non-trivial changes**; **manual end-to-end verification at
track completion**. All code follows `conductor/code_styleguides/` (Tailwind-only, no
`<style>`/CSS vars, `cn()`, `svelte-sonner`, UPPERCASE comments, strict import groups + section
headers) and `.prettierrc`. Run checks via the Windows full-node-path workaround:
`$env:Path = "C:\Program Files\nodejs;C:\Windows\System32;" + $env:Path` then
`node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run check`.

> **Source of truth:** [spec.md](./spec.md) + `memory/scale-up-architecture-plan.md`. Verify each
> referenced file/symbol against the live codebase before editing — line numbers drift.

## Phase 0: Completed Prerequisites (DONE — verify, don't redo)

### Tasks

-   [x] Task 0.1: `/app` route-prefix refactor — reader pages under `src/routes/app/*`, `/admin`
        top-level, `/` landing page, all internal links rewritten, `svelte-check` clean.
-   [x] Task 0.2: DeepSeek model-aware pricing in `src/lib/server/deepseek.ts` — `PRICING` table +
        `pricingFor()` with real Flash/Pro rates; per-model env overrides; README updated.

### Verification

-   [x] `svelte-check` clean (773 files, 0 errors); `/`, `/app/`, `/admin/`, `/api/*` resolve.

## Phase 1: Decouple `/app` from server loads (SPA-ready)

Make every `/app` route render with `ssr=false` against `/api` only — the prerequisite for both
the Capacitor static build and cross-origin auth. Depends on: none.

### Tasks

-   [x] Task 1.1: Reader load. Convert `src/routes/app/book/[id]/[chapter]/+page.server.ts` (today
        `getChapterView(uuid, true)` + resume tracking) to a universal `+page.ts` that fetches
        `GET /api/chapter?id={uuid}` (endpoint exists) via `event.fetch`. Move the "record resume /
        `lastReadAt`" side-effect to an API call (extend `/api/chapter` with `?resume=1` **or** add
        `POST /api/chapters/[uuid]/resume`). Must run identically server-side (web SSR) and
        client-side (native SPA). **DONE:** `/api/chapter` now honours `?resume=1`; reader uses a
        universal `+page.ts`.
-   [x] Task 1.2: Manage load. Convert `src/routes/app/book/[id]/manage/+page.server.ts` to a
        universal `+page.ts` fetching `GET /api/books/[id]/chapters` (+ book meta). Add any fields
        the page needs to that endpoint. **DONE:** added a GET to the chapters endpoint returning
        `{ book, resumeUuid, chapters }` (hasTarget computed in SQL — no full-content transfer).
-   [x] Task 1.3: Resume redirect. Replace `src/routes/app/book/[id]/+page.server.ts` (server
        `redirect()` to resume/first chapter) with a universal `+page.ts` that resolves the resume
        chapter via `/api` and throws `redirect()` (works client-side in SPA mode); empty book →
        `/app/book/[id]/manage/`. **DONE:** reuses `GET /api/books/[id]/chapters`.
-   [x] Task 1.4: Theme without a server load. Keep `+layout.server.ts` cookie-theme as a
        **web-only** anti-flash nicety; ensure no `/app` route *requires* it (theme already comes
        from `$settings`/localStorage). Confirm the static build (Phase 6, `ssr=false`) tolerates or
        excludes `+layout.server.ts`; if it errors, gate the theme to be fully client-side for the
        capacitor target. **DONE (verified):** `+layout.svelte:23` uses `$settings.theme` whenever
        `browser` is true (always so in a static SPA) and only falls back to `data.theme` under web
        SSR — no `/app` route requires the server load. The app.html placeholder / layout.server
        exclusion for the static build is handled in Phase 6 (Task 6.2).
-   [x] Task 1.5: Audit `/app` for any other server-only reach (e.g. `$env/dynamic/private`,
        `$lib/server/*` imported into a `+page.ts`/component); relocate behind `/api`. **DONE:** the
        only `$lib/server` reference in `/app` is a **type-only** `import type { ChapterView }`
        (erased by esbuild before SvelteKit's illegal-import check — confirmed by a clean
        `vite build`); no runtime server reach in any component or universal load.

### Verification

-   [x] Reader/manage/library behave identically with SSR; temporarily set `export const ssr = false`
        on the `/app` layout and confirm every `/app` route renders against `/api` with **no** server
        load reached; revert the flag; `svelte-check` clean. **DONE:** `npm run check` clean (773
        files, 0 errors) **and** `npm run build` (adapter-node) green — the universal loads + the
        redirect-only `+page.ts` build without a single server load under `/app`.

## Phase 2: PostgreSQL on Neon migration

Swap the DB layer libsql → Postgres with no query-logic rewrite (Drizzle). Depends on: none.

### Tasks

-   [ ] Task 2.1: Provision **Neon** (Launch; min CU 0.25–0.5; autoscale on; scale-to-zero **off**;
        region = the planned Fly region; PITR 7d). Capture three connection strings and set as
        env/secrets: `DATABASE_URL` (pooled `-pooler`, transaction mode), `DATABASE_URL_DIRECT`
        (session), `DATABASE_URL_REPLICA` (replica; = pooled primary until a replica is added).
        **⚠ USER ACTION (needs your Neon account):** create the project, copy the three URLs into
        `.env` (template + format added to `.env.example`), then `npm run db:migrate`.
-   [x] Task 2.2: Deps — add `postgres` (postgres.js); keep `drizzle-orm`; leave `@libsql/client`
        until the migration is verified. **DONE:** `postgres` installed; `@libsql/client` retained
        for the one-time ETL (see 2.9).
-   [x] Task 2.3: `schema.ts` → `drizzle-orm/pg-core`. **DONE:** `pgTable`; `bigserial({mode:'number'})`
        PKs; `uuid().defaultRandom()` for `chapters.uuid`; all ms-epoch timestamps →
        `bigint({mode:'number'})` (Date.now() + stat math unchanged); `cost_usd`/`read_progress` →
        `doublePrecision`; `site_events.ok`/`status` integer kept; `text(enum)` kept; all partial
        unique indexes + indexes reproduced (verified in `drizzle/0000_*.sql`); `$inferSelect/$inferInsert`
        kept (types unchanged: number/string/number).
-   [x] Task 2.4: `db/index.ts` → postgres.js. **DONE:** `dbWrite` (pooled, `{prepare:false, max:10}`),
        `dbRead` (`DATABASE_URL_REPLICA`), `db = dbWrite` back-compat; WAL/FK pragmas + top-level
        `await` removed; `globalThis` singleton guard kept. The `migrator` (third role, direct
        endpoint, `max:1`) lives in `migrate.ts` — `$env/dynamic/private` isn't available in a
        standalone node script, so it reads `process.env`.
-   [x] Task 2.5: `glossary.ts` `likeContains` → **`ILIKE`**. **DONE.** `onConflictDoUpdate(targetWhere,
        set:{x:sql\`excluded.x\`})` and `Number(count(*))` verified valid on PG (svelte-check + build green).
        Also fixed `setReadProgress` `max()` → `greatest()` (PG `max` is an aggregate) and `listBooks`'
        bare-`uuid`-under-GROUP-BY (illegal in PG) → `selectDistinctOn`.
-   [x] Task 2.6: `drizzle.config.ts` → `dialect:'postgresql'`, credentials = `DATABASE_URL_DIRECT`.
        **DONE:** `drizzle-kit generate` produced `drizzle/0000_smiling_psynapse.sql`; added `migrate.ts`
        (postgres-js migrator) + `db:generate`/`db:migrate` npm scripts. (Running `db:migrate` needs the
        Neon URL from 2.1.)
-   [~] Task 2.7: Route reads → `dbRead`, writes → `dbWrite`. **PARTIAL (intentional):** `dbRead`/`dbWrite`
        roles exist; until a real Neon **replica** endpoint is configured `DATABASE_URL_REPLICA` = the
        pooled primary, so the split is a functional no-op. All call sites use `db` (=`dbWrite`), which is
        correct for both reads and writes. Flipping pure-read paths to `dbRead` is mechanical and safe to
        do once a replica exists — deferred to avoid churn for zero current benefit.
-   [x] Task 2.8: Data migration. **DONE:** `scripts/etl-sqlite-to-pg.mjs` (libsql → Postgres COPY +
        identity-sequence reset) written + documented; run after `db:migrate`. Pre-prod alternative:
        skip the ETL and start fresh.
-   [x] Task 2.9: Remove `@libsql/client` + `drizzle-orm/libsql`. **DONE (app code):** no app module
        imports libsql anymore (`db/index.ts` is postgres.js). `@libsql/client` is retained **only** for
        the one-time ETL — run it, then `npm rm @libsql/client`. `conductor/tech-stack.md` updated in the
        track's final doc-sync.

### Verification

-   [x] `svelte-check` clean (772 files, 0 errors) **and** `npm run build` green on the Postgres schema;
        migration SQL generated with correct types + partial unique indexes. **⚠ Live boot on Neon
        (fetch → import → extract → translate → read; case-insensitive glossary search; cascade delete)
        is pending the Neon provisioning in Task 2.1** — the code is ready; only the database account is not.

## Phase 3: Firebase authentication

Identity via Firebase; the server stays authoritative for app data. Depends on: Phase 2.

### Tasks

-   [x] Task 3.1: Firebase deps + env. **DONE:** `firebase` + `firebase-admin` installed;
        `PUBLIC_FIREBASE_*` (web) + `FIREBASE_SERVICE_ACCOUNT` (server) documented in `.env.example`.
        **⚠ USER ACTION (needs your Firebase project):** create the project, enable **Email/Password** +
        **Google**, copy the web config + a service-account key into `.env`.
-   [x] Task 3.2: `users` table (Postgres). **DONE:** `id text pk` (= Firebase uid), `email` unique,
        `emailVerified boolean`, `name`, `avatarUrl`, `role enum['user','admin'] default 'user'`,
        `createdAt bigint`. Migration `drizzle/0001_*.sql` generated.
-   [x] Task 3.3: `src/lib/server/auth/` — **DONE:** `admin.ts` (lazy firebase-admin singleton),
        `verify.ts` (`verifyIdToken`, `createSessionCookie`, `verifySessionCookie` — revocation check
        opt-in for a cheap per-request hook), `user.ts` (`upsertUserFromToken` read-first/write-on-change,
        `requireUser(locals)`).
-   [x] Task 3.4: **DONE:** `POST /api/auth/session` (verify ID token → upsert user → set the Firebase
        session cookie: httpOnly, `secure:!dev`, `SameSite=Lax`, path `/`, 14-day maxAge);
        `POST /api/auth/logout` (clear cookie).
-   [x] Task 3.5: `hooks.server.ts` — **DONE:** `sequence(authHandle, themeHandle)`. Bearer →
        `verifyIdToken`, else session cookie → `verifySessionCookie` → `upsertUserFromToken` →
        `event.locals.user`. Guards: `/app`,`/admin` → `/login/` if no user; `/admin` requires admin;
        `/api/*` (except `/api/auth/*`) → 401 JSON, `/api/admin/*` → 403 JSON. Anonymous asset hits do
        zero auth work.
-   [x] Task 3.6: `src/app.d.ts` — **DONE:** `App.Locals { user: AuthUser | null }`.
-   [x] Task 3.7: Client — **DONE:** `src/lib/firebase.ts` (web SDK via `$env/dynamic/public` so a missing
        config never breaks the build); `/login` + `/signup` (email/password + "Continue with Google"
        popup → POST ID token to `/api/auth/session` → `goto`); `/logout` (server + Firebase sign-out);
        `/verify-email` notice (resend); password reset via "Forgot password" on `/login`
        (`sendPasswordResetEmail`).
-   [x] Task 3.8: `apiFetch()` helper (`src/lib/api.ts`). **DONE (web):** same-origin cookie pass-through;
        the login/session calls route through it. Native bearer + `PUBLIC_API_BASE` are added in Phase 6
        (Task 6.4), where the rest of `/app`'s fetches are routed through it too.

### Verification

-   [x] `svelte-check` clean (873 files, 0 errors) **and** build green with firebase + firebase-admin.
        **⚠ Live sign-in (email/password + verification, Google popup, session persistence, `/app`
        login-gate, `/admin` role-gate, `/api` 401) is pending the Firebase project in Task 3.1** — the
        code + guards are complete; only the Firebase project credentials are not.

## Phase 4: Per-user multi-tenancy & cost guardrail

Make every library private and bound LLM spend per user. Depends on: Phase 2 + 3.

### Tasks

-   [x] Task 4.1: Schema. **DONE:** `userId text NOT NULL references(users.id, onDelete:'cascade')` on
        **`books`** + **`glossary`**; `glossary_global_unq` → `(userId, sourceLang, targetLang, source)
        WHERE scope='global'`. **Also** scoped `chapters_url_unq` → `(bookId, chapterUrl)` (per-user web
        libraries need the same source URL fetchable into each user's own book — see DEVIATION note below).
        Migration `drizzle/0002_*.sql`; backfill-to-seed-admin handled by the ETL.
-   [x] Task 4.2: `books.ts`. **DONE:** `listBooks(userId)` (scoped, incl. its chapter aggregates);
        `getChapterView(uuid, userId, …)` (ownership check); creates (`ingestWebChapter`,
        `createImportedBook`, `createEmptyBook`) set `userId`; per-user web book ids
        (`web-{userId}-{siteId}`); `chapterByUrl` scoped to the book; new
        `assertBookOwner` / `assertChapterOwner` / `getOwnedChapterByUuid` helpers. Mutators
        (`setReadProgress`, `setBookReadStatus`, `deleteBook`, `reorderChapters`, `refetchCover`,
        `refreshChapterNav`, `appendChapters`, `deleteChapter`) are authorised **at the endpoint** via the
        helpers (less churn, same guarantee).
-   [x] Task 4.3: `glossary.ts`. **DONE:** `userId` threaded through `scopeWhere`/`getGlossary`/
        `getGlossaryPage`/`countGlossary`/`addTerm`/`updateTerm`/`deleteTerm`/`mergeGlossary` (global +
        book rows both userId-scoped). `getEffectiveGlossary`/`addNewTerms` derive the owner from the
        book, so `glossary-match.matchTerms` + the translate pipeline stay UNCHANGED. `chapter-stats`
        owner scope enforced at its endpoint.
-   [x] Task 4.4: **DONE:** every `/api/*` data endpoint calls `requireUser(locals)` + an ownership
        assertion (`assertBookOwner` / `assertChapterOwner` / `getOwnedChapterByUuid` / userId-scoped
        glossary): `/api/books*`, `/api/chapter*`, `/api/chapters/[uuid]/*`, `/api/translate`,
        `/api/translate-text`, `/api/extract`, `/api/fetch`, `/api/import/*`, `/api/glossary*`. The hooks
        guard already 401s anonymous `/api/*`; these add cross-user 404s. The Phase-1 universal loads call
        these endpoints, so they inherit the scoping.
-   [x] Task 4.5: **DONE:** `/api/translate` calls `assertChapterOwner(user.id, chapterId)` **before**
        `ensureTranslationJob`/`subscribe` — a guessed integer chapterId from another user 404s instead of
        attaching to their SSE stream.
-   [x] Task 4.6: **DONE:** chapter-linked `ai_usage` cascades via the chapter FK; `'map'` (no chapterId)
        stays global; `quota.userSpendUsd` rolls up per-user spend through the chapters→books chain.
-   [x] Task 4.7: `src/lib/server/quota.ts`. **DONE:** `assertWithinBudget(userId)` sums the window cost
        (`translations` + chapter-linked `ai_usage`) vs a per-user USD cap, called in `/api/translate` +
        `/api/fetch` before enqueue; over-limit → 429 with a friendly message. **Default cap (chosen):**
        `$0.50` per 24h (≈250 fresh chapters/day at ~$0.002), env-overridable via `QUOTA_USD_PER_WINDOW`
        / `QUOTA_WINDOW_MS`; `<= 0` disables. (Confirm the value with product — it's a one-env-var change.)
-   [x] Task 4.8: **DONE:** `/admin` (server-loaded `getDashboard`, cross-user) is gated by the hooks
        `role==='admin'` guard; per-user stats (`chapter-stats`) stay user-scoped at their endpoint. No
        `/api/admin/*` exists yet — the dashboard loads via `/admin/+page.server.ts` directly.

> **DEVIATION from spec acceptance criterion B (documented):** `chapters_url_unq` is `(bookId, chapterUrl)`
> rather than global `(chapterUrl)`. A global URL-unique index makes it impossible for two users to each
> have the same source novel in their own private library (the headline goal, criterion D). Per-book
> uniqueness + per-user web book ids resolves that; `chapterByUrl` is scoped to the book so neighbour
> resolution never crosses users. True cross-user web *dedup/sharing* is the deferred shared-base-cache track.

### Verification

-   [x] `svelte-check` clean (874 files, 0 errors) **and** build green. The type system confirmed every
        call site of the re-signed functions is scoped. **⚠ Live two-user isolation / over-budget-refusal /
        cascade-on-user-delete checks are pending Neon + Firebase provisioning** (Tasks 2.1 + 3.1) — the
        ownership + quota code is complete and compiles.

## Phase 5: Redis/BullMQ queue + global DeepSeek cap

Externalize jobs + concurrency so the web tier is stateless and the DeepSeek cap is global +
settable. Depends on: Phase 2 (config); uses Phase 4 (quota gate).

### Tasks

-   [ ] Task 5.1: Provision Redis (Upstash) → `REDIS_URL`; add `bullmq` + `ioredis`.
-   [ ] Task 5.2: `src/lib/server/queue/` — define a `translate` BullMQ queue. Job data
        `{chapterId, force, autoExtract, model, userId}`; job id = `chapterId` (collapse duplicates).
        Producer (`/api/translate`, after the quota gate) enqueues + subscribes to channel
        `translate:{chapterId}`, replays the capped list `translate:{chapterId}:events` (TTL) then
        tails, piping into the SSE stream — preserving the `TranslationEvent` shape + endpoint contract.
-   [ ] Task 5.3: `src/lib/server/queue/worker.ts` — run the existing `run()` pipeline, refactored to
        **publish** each `TranslationEvent` + append to the capped list (replacing the in-memory
        `job.events`/listeners). Worker `concurrency` = the **global DeepSeek cap**, read from
        config/Redis (runtime-adjustable); add BullMQ `limiter:{max,duration}` for DeepSeek RPM.
-   [ ] Task 5.4: `deepseek.ts` — retire the per-process `PQueue` global cap (authoritative cap is
        now worker concurrency); keep chunked per-chapter calls sequential within one job.
-   [ ] Task 5.5: `translation-service.ts` — replace the in-memory `jobs` `Map` + `emit/subscribe`
        with the queue-backed pub/sub; keep completion persisting to Postgres (Redis loss → next read
        hits the `contentTarget` fast-path).
-   [ ] Task 5.6: Distributed cache invalidation — `glossary-match.invalidateBook/All` and
        `site-adapter` cache changes broadcast over Redis pub/sub so all instances drop stale entries.
-   [ ] Task 5.7: Document the Phase-0 bridge (single instance, or sticky sessions via Fly
        `fly-replay`, or an in-process worker) for launching before the worker tier is split out.

### Verification

-   [ ] Two web instances + one worker locally: a translate started on instance A streams correctly
        when the SSE client reconnects to instance B; global cap honoured across workers (set cap=1 →
        serialized); glossary edit on A invalidates B; killing Redis mid-run still leaves a persisted
        translation.

## Phase 6: Capacitor Android build

Ship only `/app` as a native static SPA against the hosted API. Depends on: Phase 1 + Phase 3.

### Tasks

-   [ ] Task 6.1: Conditional adapter in `svelte.config.js` — `BUILD_TARGET==='capacitor'` →
        `@sveltejs/adapter-static` (SPA fallback, precompress off); else `adapter-node`. Add
        `@sveltejs/adapter-static`.
-   [ ] Task 6.2: `ssr=false` + `prerender=false` for the capacitor build; confirm no server load is
        reached (relies on Phase 1); theme from `localStorage`; native WebView background set to
        avoid flash; SPA start path `/app/`.
-   [ ] Task 6.3: Capacitor init — `@capacitor/core` + `@capacitor/cli` + `@capacitor/android`;
        `capacitor.config.ts` (appId, `webDir` = static output); add the Android platform.
-   [ ] Task 6.4: API base + transport — `PUBLIC_API_BASE` (web `''`; native `https://xianslate.com`);
        `apiFetch()` attaches `Authorization: Bearer <idToken>` on native (token from the Firebase
        SDK), cookie on web; all `/app` fetches go through it.
-   [ ] Task 6.5: Native auth — `@capacitor-firebase/authentication` for native Google sign-in (+
        email/password); register `google-services.json` + SHA-1/256 fingerprints in Firebase.
-   [ ] Task 6.6: API CORS — allow the Capacitor origin (`https://localhost`/`capacitor://localhost`)
        for `/api/*` (methods + `Authorization`), no credentialed cookies for native; add a CORS
        handle in hooks scoped to `/api`.
-   [ ] Task 6.7: Build + run the APK in an emulator/device against `https://xianslate.com/api`.

### Verification

-   [ ] APK boots to `/app`; native Google + email/password sign-in succeed; library, reader, and
        streaming translation work cross-origin with the bearer token; `/` and `/admin` are not
        reachable in-app.

## Phase 7: Hosting & deployment + final verification

Stand up the production topology and verify the whole system. Depends on: all.

### Tasks

-   [ ] Task 7.1: Dockerfiles — slim multi-stage Node image for `web` + `translation-worker` (no
        Chromium); a separate Chromium image for the `scraper` (`playwright install --with-deps chromium`).
-   [ ] Task 7.2: `fly.toml`(s) — App A `[processes]` `web` + `translation-worker` (http_service +
        health checks on `web` only); App B `scraper` (no public ports, autostop). Fly region = Neon
        region. `fly secrets set` `DATABASE_URL*`, `DEEPSEEK_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`,
        `REDIS_URL`, public Firebase web config.
-   [ ] Task 7.3: Cloudflare — DNS `xianslate.com` → Fly (orange-cloud); cache rule for
        `/_app/immutable/*`, bypass `/api/*`; create the R2 bucket.
-   [ ] Task 7.4: R2 covers — route cover upload/serve (`uploads.ts` + cover endpoints) to R2 (S3
        API); serve via CDN.
-   [ ] Task 7.5: Capacitor — point `PUBLIC_API_BASE` at `https://xianslate.com`; rebuild the APK.
-   [ ] Task 7.6: Smoke + light load — SSE through Cloudflare (heartbeat), same-origin web cookie +
        cross-origin native bearer, multi-instance web, replica reads, autostop scraper.

### Verification

-   [ ] **Whole-track manual E2E (per `workflow.md`):** sign up → add book (URL/EPUB/TXT) → extract
        → translate (streamed, global cap honoured) → read (progress saved) → glossary edit
        (cross-instance) → second-user isolation → over-budget refusal → Android parity.

## Final Verification

-   [ ] All acceptance criteria (spec §A–H) met.
-   [ ] Tests for the breakage-prone logic (auth verify, tenancy scoping, queue replay, PG glossary
        paths) pass; `svelte-check` / `lint` / `format` pass.
-   [ ] Docs updated: `conductor/tech-stack.md` (Postgres, Fly, Firebase, Redis), `conductor/product.md`
        (multi-user/online), `README.md`, `memory/scale-up-architecture-plan.md` (mark phases done).
-   [ ] Track marked complete in `conductor/tracks.md` + `conductor/index.md`.

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
