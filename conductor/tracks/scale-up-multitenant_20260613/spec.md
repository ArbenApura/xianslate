# Specification: Multi-User Scale-Up & Cross-Platform Delivery

**Track ID:** scale-up-multitenant_20260613
**Type:** Feature
**Created:** 2026-06-13
**Status:** Approved

## Summary

Evolve Xianslate from a single-user, local-first SvelteKit app (libsql/SQLite, in-memory
translation jobs) into a **multi-tenant, horizontally scalable online service** with **per-user
private libraries**, **Firebase authentication** (Google + email/password), a **PostgreSQL
(Neon)** datastore, a **Redis/BullMQ** translation queue with a **global, settable DeepSeek
concurrency cap**, and a **Capacitor Android app** that ships only the `/app` reader as a static
SPA against the hosted API. Hosting target: a single Cloudflare origin `xianslate.com` fronting a
Node API on Fly.io (web + worker + a separate Chromium scraper), with Cloudflare R2 for cover
images.

> **Authoritative cross-session reference:** `memory/scale-up-architecture-plan.md` (in the
> Claude project memory) mirrors these decisions. If this spec and that memo ever diverge, this
> spec wins (it is the reviewed artifact).

## Context

Xianslate today (verified against the codebase, **not** the slightly stale
`conductor/tech-stack.md`):

-   **DB:** `@libsql/client` + `drizzle-orm/libsql` (a local SQLite file by default), schema in
    `src/lib/server/db/schema.ts` using `drizzle-orm/sqlite-core`. WAL/FK pragmas + top-level
    `await` in `src/lib/server/db/index.ts`.
-   **No user concept.** Every query in `books.ts`, `glossary.ts`, the API routes, and the page
    loads is **unscoped** — any caller can read/mutate any book.
-   **Translation jobs** live in an **in-memory module `Map`** keyed by `chapterId`
    (`src/lib/server/translation-service.ts:66`) and stream to clients over SSE
    (`src/routes/api/translate/+server.ts`). DeepSeek concurrency is a **per-process** `PQueue`
    (`src/lib/server/deepseek.ts`, `DEEPSEEK_CONCURRENCY`, default 4).
-   **Glossary matching** (`glossary-match.ts`) and **site adapters** (`site-adapter.ts`) cache
    per-process `Map`s, invalidated only in-process.
-   The app runs on `@sveltejs/adapter-node` with `precompress: true`.

**Already completed in the session that authored this track (do not redo — verify, then build on):**

1.  **`/app` route-prefix refactor.** All reader pages moved under `src/routes/app/*`
    (`/app/` library, `/app/book/[id]/[chapter]/`, `/app/book/[id]/manage/`, `/app/glossary/`);
    `/admin` is a **top-level** route (not under `/app`); `/` is a new **landing page**; `/api/*`
    unchanged. All internal `goto()`/`href`/`redirect()` links rewritten to the `/app/...` prefix
    (admin → `/admin/`, "back to library" → `/app/`). `svelte-check` is clean (773 files, 0
    errors). Git tracked the moves as renames.
2.  **DeepSeek model-aware pricing fix** (`src/lib/server/deepseek.ts`). Replaced the stale single
    price triple with a **model-keyed `PRICING` table** + `pricingFor(model)` (Flash fallback).
    Real published rates baked in as defaults: **Flash** `$0.14` miss / `$0.0028` hit / `$0.28`
    output; **Pro** `$0.435` / `$0.003625` / `$0.87` (USD per 1M tokens). Env overrides are now
    per-model: `DEEPSEEK_PRICE_FLASH_INPUT|_CACHED|_OUTPUT`, `DEEPSEEK_PRICE_PRO_INPUT|_CACHED|_OUTPUT`.
    README updated. (The cost meter now under-counts ~3.5× less; historical `costUsd` rows keep
    their old inflated values and are **not** backfilled.)

This track delivers the remaining six phases of the scale-up.

## User Story

As a reader, I want my own private account and library that I can open on the web **and** on an
Android app — with my books, glossaries, settings, and reading progress kept private to me — so
that Xianslate works as a real multi-user product, while the operator keeps LLM spend bounded and
predictable per user.

## Goals & Non-Goals (this track)

**Goals:** per-user auth + private libraries; Postgres on Neon; horizontally scalable stateless
web tier; global settable DeepSeek concurrency cap; per-user quota/budget guardrail; a Capacitor
Android build of `/app`; single-origin Cloudflare + Fly hosting topology defined and deployable.

**Non-goals (explicitly deferred):** iOS Capacitor build (same path, later); Stripe/usage billing
(the `ai_usage` ledger is built to support it, but no payments here); the **shared base-translation
cache** cost optimization (separate follow-up track); multi-region web/DB; admin RBAC beyond a
single `role` flag; migrating off DeepSeek.

## Acceptance Criteria

### A. `/app` runs without server loads (SPA-ready)

-   [ ] The four server `load`s that `/app` depends on are gone or relocated: `app/book/[id]/[chapter]/+page.server.ts`,
        `app/book/[id]/manage/+page.server.ts`, `app/book/[id]/+page.server.ts` (resume redirect),
        and the theme dependency in the root `+layout.server.ts`. Data now comes from `/api/*` via
        universal `+page.ts` / client `fetch`.
-   [ ] The reader, manage page, and library work identically with SSR **and** with `ssr=false`
        (the static-SPA mode) — no `+page.server.ts`/`+layout.server.ts` is reached for any `/app`
        route. Theme on the native build derives from client `localStorage`, not the cookie.
-   [ ] `svelte-check` passes; web app behaviour is unchanged for end users.

### B. PostgreSQL on Neon

-   [ ] `schema.ts` uses `drizzle-orm/pg-core`; all tables, columns, enums, FKs (`onDelete:'cascade'`),
        and **partial unique indexes** (glossary global/book, `chapters_url_unq`) reproduced with
        matching semantics (NULLs remain distinct in unique indexes).
-   [ ] `db/index.ts` uses `postgres.js` with **three clients**: `dbWrite` (pooled primary,
        `prepare:false`), `dbRead` (replica endpoint; may point at primary initially), and a
        `migrator` client (direct/session endpoint). WAL/FK pragmas + top-level `await` removed.
-   [ ] `glossary.ts` `likeContains` uses **`ILIKE`** (Postgres `LIKE` is case-sensitive; SQLite's
        was not) so glossary search still matches case-insensitively.
-   [ ] `drizzle.config.ts` dialect is `postgresql`; migrations generated with `drizzle-kit generate`
        and applied via a scripted migrator (no interactive `db:push`).
-   [ ] App boots against a Neon database; fetch → import → extract → translate → read works
        end-to-end on Postgres.

### C. Firebase authentication

-   [ ] Email/password **and** Google sign-in work on the web (Firebase JS SDK).
-   [ ] Server verifies identity with `firebase-admin`. **Web** uses a Firebase **session cookie**
        (httpOnly, secure, `SameSite=Lax`, same-origin); **native** uses a **bearer ID token**
        (`Authorization: Bearer`). `hooks.server.ts` accepts **either** and populates
        `event.locals.user` (+ `App.Locals` typed in `app.d.ts`).
-   [ ] A `users` table (keyed by Firebase `uid`) is upserted on first verified sign-in
        (`email`, `emailVerified`, `name`, `avatarUrl`, `role` default `user`).
-   [ ] Route protection in hooks: `/app/*` and `/admin/*` redirect to `/login` when
        unauthenticated; `/admin/*` additionally requires `role==='admin'`; `/api/*` (except auth
        endpoints) returns `401` JSON when unauthenticated.
-   [ ] Email verification + password reset are handled by Firebase (no separate email provider).

### D. Per-user multi-tenancy & cost guardrail

-   [ ] `userId` (FK → `users`, `onDelete:'cascade'`) added to **`books`** and **`glossary`** only.
        `chapters`, `translations`, and chapter-linked `ai_usage` inherit ownership through FK
        chains. `site_adapters` and `site_events` remain **global/shared**.
-   [ ] `glossary_global_unq` becomes `(userId, sourceLang, targetLang, source) WHERE scope='global'`.
-   [ ] Every data path (page loads via API, all `/api/*` endpoints, `books.ts`, `glossary.ts`,
        `glossary-match.ts`, `chapter-stats.ts`, the translation job) is scoped by the authenticated
        `userId`; a user cannot read or mutate another user's book/chapter/glossary (including by
        guessing a numeric `chapterId` to attach to a translation SSE stream).
-   [ ] A **per-user quota + budget gate** runs **before** a translation is enqueued (reads
        `ai_usage`); over-budget requests are refused with a clear error. `ai_usage` is attributed
        per user (chapter-linked rows already cascade; non-chapter spend like `'map'` stays global).
-   [ ] Existing single-user data is backfilled to a seed admin user by the migration (or a clean
        recreate if pre-prod).

### E. Redis/BullMQ queue + global DeepSeek cap

-   [ ] The in-memory `jobs` `Map` and the per-process `PQueue` are replaced by a **Redis-backed
        BullMQ** queue. Enqueue is keyed by `chapterId` so duplicate requests collapse (no
        double-billing). Worker runs the existing `run()` pipeline and **publishes** each
        `TranslationEvent` to a Redis channel; the SSE endpoint **subscribes + replays** from a
        capped Redis list (replacing `job.events`).
-   [ ] DeepSeek concurrency is a **single global cap across all workers** (BullMQ worker
        concurrency), **adjustable at runtime** (value in config/Redis, no redeploy), plus a
        **rate limiter** (requests/min) for DeepSeek's RPM limit.
-   [ ] Completion still persists to Postgres, so a total Redis loss is safe (next read hits the
        free `contentTarget` fast-path).
-   [ ] Glossary/site-adapter cache invalidations propagate across instances (Redis pub/sub) so a
        glossary edit on instance A is seen by instance B.
-   [ ] Multiple web instances can run concurrently with correct SSE replay/tail on reconnect.

### F. Capacitor Android app

-   [ ] A `BUILD_TARGET=capacitor` build produces an `adapter-static` SPA (`ssr=false`, fallback)
        containing **only** the `/app` experience, start path `/app/`, that boots standalone in the
        Android WebView and talks to `https://xianslate.com/api` cross-origin with a bearer token.
-   [ ] Google sign-in on Android is **native** (e.g. `@capacitor-firebase/authentication`), not a
        webview redirect; email/password also works. The API CORS-allows the Capacitor origin for
        `/api/*` (bearer, no cookies).
-   [ ] `/` (landing) and `/admin` are **not** in the Android bundle.

### G. Hosting & deployment

-   [ ] Single Cloudflare origin `xianslate.com`: `/` landing, `/app/*` reader, `/admin/*` page +
        `/api/admin/*` data, `/api/*` server. Cache rule for `/_app/immutable/*`; `/api/*` bypassed.
        R2 bucket for cover images.
-   [ ] Fly.io topology: a slim app with `web` + `translation-worker` process groups (no Chromium)
        and a **separate** Chromium **scraper** app/image (Playwright/curl only there). Secrets set
        (`DATABASE_URL*`, `DEEPSEEK_API_KEY`, Firebase admin creds, `REDIS_URL`). Fly region matched
        to the Neon region.
-   [ ] SSE streams cleanly through Cloudflare (15s heartbeat + `x-accel-buffering:no` already
        present); web auth is same-origin cookie; native auth is cross-origin bearer.

### H. Conventions

-   [ ] All code follows `conductor/code_styleguides/` (Tailwind-only, no `<style>`/CSS vars,
        `cn()`, `svelte-sonner`, UPPERCASE comments, strict import groups + section headers),
        `trailingSlash:'always'`, and `.prettierrc`. `npm run check`, `lint`, `format` pass.

## Dependencies

-   **Neon** project (Launch plan; min CU 0.25–0.5, autoscale on, scale-to-zero OFF for prod; three
    connection strings: pooled, direct, replica). Region matched to the Fly app region.
-   **Firebase** project with Email/Password + Google providers enabled; a **service-account
    credential** for `firebase-admin` (server env); Android `google-services.json` + SHA-1/SHA-256
    fingerprints registered; Google Cloud OAuth consent configured.
-   **Fly.io** account/org; **Cloudflare** zone for `xianslate.com` + an **R2** bucket; **Upstash**
    (or other) **Redis** for Phase E.
-   **Capacitor** + Android SDK / Android Studio toolchain for the mobile build.
-   New npm deps (approx): `postgres` (postgres.js), `firebase` (web SDK), `firebase-admin`,
    `@capacitor/core` + `@capacitor/cli` + `@capacitor/android`, `@capacitor-firebase/authentication`,
    `bullmq` + `ioredis`, `@sveltejs/adapter-static`. Drizzle stays (it has both dialects).
-   **Windows tooling caveats (this dev box — see `memory/windows-node-tooling-path.md`):** node/npm
    are not on PATH (use `C:\Program Files\nodejs\node.exe`; prepend it + `C:\Windows\System32` to
    `PATH` when invoking `npm run ...`). For migrations, prefer `drizzle-kit generate` + a scripted
    `migrate()` over interactive `db:push`.
-   **DeepSeek v4 thinking must stay disabled** (`thinking:{type:'disabled'}`, already in
    `deepseek.ts`) — see `memory/deepseek-v4-hybrid-reasoner.md`.

## Out of Scope

-   iOS Capacitor build; Stripe/usage-based billing and the free-tier paywall UX; the shared
    base-translation cache cost optimization (separate track); multi-region; advanced admin RBAC;
    moving off DeepSeek; rewriting the scraper/Playwright logic (it stays as-is, just isolated to
    the scraper image — see `memory/scraper-engine-and-tooling.md`).

## Technical Notes (decisions, verbatim from planning)

-   **Why not Cloudflare Workers for the API:** Playwright/Chromium (`headless.ts`), the curl
    subprocess + Node `dns` SSRF guard (`fetcher.ts`), minutes-long detached SSE jobs + the
    in-memory job registry, and native `@libsql`/`postgres` clients are all incompatible with the
    Workers runtime. Cloudflare is used as **edge + static host + R2 + DNS**; the API needs a Node
    host (Fly).
-   **Single-origin auth benefit:** web `/app`→`/api` is same-origin → cookie sessions "just work"
    (no CORS/`SameSite=None`); only the native client is cross-origin (bearer).
-   **Postgres type mapping:** `integer().primaryKey({autoIncrement})` → `bigserial`/`bigint
    identity` (use bigint for high-volume `chapters`/`translations`); `text('uuid').$defaultFn(randomUUID)`
    → native `uuid().defaultRandom()`; ms-epoch `integer` timestamps → **`bigint({mode:'number'})`**
    (keeps all `Date.now()` + stat math unchanged — do NOT churn to `timestamptz`); `real('cost_usd')`
    → `doublePrecision`; `text(enum)`, partial `uniqueIndex().where()`, cascades port as-is.
-   **Pooler caveat:** transaction-mode pooling requires postgres.js `prepare:false` and **does not
    support `LISTEN/NOTIFY`** (only relevant if a future pg-native queue is considered; this track
    uses Redis/BullMQ).
-   **Tenancy roots:** ownership lives only on `books` + `glossary`; everything else inherits via
    FK cascade. `site_adapters`/`site_events` stay global so a learned selector map is shared (no
    re-learn cost per user). The translation cache (`translations`) is content-addressed and stays
    per-user via the chapter FK (cross-user dedup is the deferred base-cache optimization).
-   **Cost reality:** ~`$0.002`/fresh chapter (Flash, real pricing); re-reads are free
    (`contentTarget` fast-path); ~`$1.30`/active reader/month all-in; infra floor ~`$60–80`/month;
    DeepSeek dominates only from ~1k readers up. Per-user quotas are non-negotiable in the
    private-library model.
-   **Provider list pricing captured (2026-06):** Fly shared-cpu-1x 512MB `$3.32`/mo, 1GB `$5.92`;
    shared-cpu-2x 1GB `$6.64`; egress NA/EU `$0.02`/GB; IPv4 `$2`. Neon Launch `$0.106`/CU-hour +
    `$0.35`/GB-mo (pooling/replicas/7-day PITR incl.). Upstash Fixed 1GB `$20`/mo (unlimited
    commands). Cloudflare proxied bandwidth free; R2 `$0.015`/GB-mo, egress free, 10GB free.
    Firebase Auth free ≤ 50k MAU.

---

_Generated by Conductor. Review and edit as needed._
