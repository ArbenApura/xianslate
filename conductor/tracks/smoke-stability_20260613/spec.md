# Specification: Smoke Test & Stability Verification — Scale-Up

**Track ID:** smoke-stability_20260613
**Type:** Chore (QA / stability verification)
**Created:** 2026-06-13
**Status:** Draft

## Summary

A thorough, **reproducible** end-to-end smoke-test + stability pass for the
`scale-up-multitenant_20260613` implementation (Phases 1–7: `/app` SPA decoupling, PostgreSQL/Neon,
Firebase auth, per-user multi-tenancy + cost guardrail, Redis/BullMQ queue, Capacitor Android,
Fly/Cloudflare hosting). That track is **code-complete and green** (`npm run check`/`lint`/`build` all
pass for both the web and Capacitor targets) but its **live end-to-end behaviour has not been exercised**
— the external accounts (Neon, Firebase, Upstash Redis, Fly, Cloudflare, the Android SDK) were not
provisioned in the implementing session. This track operationalizes that verification: a phase-by-phase
runbook with exact commands, endpoints, inputs, and **expected results**, plus failure-injection and a
short soak, so the next session can confirm the system actually works and is stable — and triage the
known documented follow-ups.

## Context

Xianslate evolved from a single-user local-first reader into a multi-tenant online app (per-user
private libraries; Firebase sign-in; Postgres on Neon; a Redis-backed BullMQ translation queue with a
per-user USD cost guardrail; a Capacitor Android build; Cloudflare + Fly hosting). The authoritative
references for **how to run it** are:

- `DEPLOYMENT.md` (repo root) — the provisioning + deploy runbook (this track executes its §7 checklist
  in depth and extends it).
- `conductor/tracks/scale-up-multitenant_20260613/{spec,plan}.md` — what was built + the deliberate
  deviations and remaining follow-ups (in-component `apiFetch` routing, scraper split, R2 covers).
- `conductor/tech-stack.md` — the current stack (Postgres/postgres.js, Firebase, Redis/BullMQ, Capacitor).

**Key behaviours to confirm (verified against the code, not assumptions):**

- `/app` reaches **no** server load — all data flows through `/api/*` (web SSR via the SvelteKit fetch;
  native via `apiFetch` + bearer).
- DB is Postgres via `dbWrite`/`dbRead`; ms-epoch `bigint` timestamps; `chapters_url_unq` is **per-book**
  `(bookId, chapterUrl)`; glossary search uses **`ILIKE`**.
- Auth: web = httpOnly session cookie (same-origin); native = `Authorization: Bearer` ID token; hooks
  guard `/app`,`/admin`,`/api`.
- Tenancy: every `/api/*` data path is owner-scoped (cross-user → 404/403); `/api/translate` asserts
  chapter ownership **before** attaching to the SSE stream; quota gate refuses over-budget translates.
- Queue: **`REDIS_URL`-gated** — unset → in-memory single-instance bridge (must still work); set →
  BullMQ queue + Redis SSE replay + cross-instance cache bus; global DeepSeek cap = worker concurrency
  (runtime-adjustable); completion persists to Postgres (Redis loss is safe).
- Native: `BUILD_TARGET=capacitor` static SPA in `build-capacitor/`; committed `android/` project
  (appId `com.xianslate.app`); native Google sign-in via `@capacitor-firebase/authentication`.

## Problem Description (why this track exists)

Code passing type-check + build does **not** prove the live system works: the auth handshake, Postgres
query semantics under real data, per-user isolation, SSE streaming through a proxy, the BullMQ worker,
cross-instance cache invalidation, and the Android WebView↔API bridge can only be validated against the
real services. Bugs in these paths are most likely at the **dialect/SQL**, **ownership-scoping**,
**SSE-replay/ordering**, and **cross-origin/CORS/cookie** seams. This track finds them methodically.

## Acceptance Criteria

- [ ] **Provisioning + boot:** all services provisioned per `DEPLOYMENT.md`; `npm run db:migrate` applies
      cleanly to Neon; the app boots and the landing/`/app` render.
- [ ] **Regression gate:** `npm run check`, `npm run lint`, `npm run format --check`-equivalent, and both
      builds (`npm run build` + `BUILD_TARGET=capacitor npm run build`) are green; `npm run db:generate`
      produces **no** un-committed schema drift.
- [ ] **Auth (web):** email/password sign-up (with verification) + Google sign-in work; session persists
      across reload; logout clears it; password reset emails; `/app`→`/login/` when signed out, `/admin`
      requires `role==='admin'`, `/api/*` returns 401 (and `/api/admin/*` 403) when unauthorized.
- [ ] **Tenancy + cost:** two users cannot see/mutate each other's books, chapters, or glossary (book +
      global scopes); a guessed numeric `chapterId` can't attach to another user's translate stream;
      over-budget translate is refused; deleting a user cascades their library but leaves
      `site_adapters`/`site_events`.
- [ ] **Translation/data (Postgres):** fetch URL + import EPUB/TXT + manual add → extract → translate
      (fresh) → re-read is **free** (cached fast-path) → residue-repair/realign self-heal works; glossary
      search is **case-insensitive**; cascade delete (book→chapters→translations→glossary) verified; two
      users can hold the **same** source URL in their own books.
- [ ] **Queue/cache (Redis) + bridge:** the no-Redis in-memory bridge translates end-to-end; with Redis,
      two web instances + one worker stream a translation correctly across an SSE reconnect to the other
      instance; the global cap serializes at concurrency=1; a glossary edit on A invalidates B; killing
      Redis mid-run still leaves a persisted translation.
- [ ] **Android:** APK builds + boots to `/app/`; native Google + email/password sign-in succeed;
      library/reader/streaming translation work cross-origin with the bearer token; `/` and `/admin` are
      unreachable in-app; favicon/logo present.
- [ ] **Hosting:** web + translation-worker deploy on Fly; SSE streams cleanly through Cloudflare
      (heartbeat); cache rule + `/api` bypass behave; multi-instance web is correct.
- [ ] **Stability:** a short soak + failure-injection (DeepSeek/DB/Redis blips, SSE reconnect storm,
      quota-window rollover) shows no crash, leak, stuck job, or data corruption.
- [ ] **Sign-off:** results recorded; any bugs filed as bug tracks; documented follow-ups triaged; docs +
      memory updated; this track marked complete.

## Dependencies

- **`scale-up-multitenant_20260613`** — this verifies its output (code already committed + green).
- **External provisioning (operator, needs accounts):** Neon, Firebase (web config + service account +
  Android app + `google-services.json` + SHA fingerprints), Upstash Redis, Fly.io, Cloudflare zone + R2,
  Android Studio / SDK. A DeepSeek API key (already used).
- **Windows tooling:** node/npm not on PATH — prepend `C:\Program Files\nodejs;C:\Windows\System32`
  (see `memory/windows-node-tooling-path.md`). DeepSeek v4 thinking must stay disabled
  (`memory/deepseek-v4-hybrid-reasoner.md`).

## Out of Scope

- Implementing **new product features** or fixing bugs beyond what smoke testing surfaces (each real bug
  becomes its own `/conductor:new-track` bug track; this track only **finds, records, and triages**).
- The deferred follow-ups themselves (routing all in-component `/app` fetches through `apiFetch`, the
  Chromium **scraper split**, **R2 cover** proxying, iOS) — verify they're *documented*, don't *build* them.
- Load/performance benchmarking beyond a light soak (a dedicated perf track if needed).
- Building a CI pipeline (a separate chore) — though writing the recommended automated tests for the
  breakage-prone logic IS in scope (Phase 9, optional-but-recommended).

## Technical Notes

- Many checks need **two accounts** (tenancy) and **two web instances + a worker** (queue/SSE). Locally:
  run `REDIS_URL` set, one process `RUN_TRANSLATE_WORKER=1`, two `npm run preview`/`build` web instances
  on different ports behind anything that can round-robin (or just hit each instance directly and force a
  reconnect). On Fly: `fly scale count web=2 translation-worker=1`.
- Test the **no-Redis bridge** first (simplest: `REDIS_URL` unset, single `npm run dev`/`preview`) to
  isolate Postgres/auth/tenancy from the queue layer, then re-test with Redis.
- Use a **low `QUOTA_USD_PER_WINDOW`** (e.g. `0.01`) to exercise the cost guardrail quickly, and
  set the global concurrency to `1` to verify serialization.
- Keep `costUsd` history caveat in mind: pre-fix rows are inflated ~3.5× and are not backfilled.

---

_Generated by Conductor. Review and edit as needed._
