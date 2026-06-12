# Implementation Plan: Smoke Test & Stability Verification — Scale-Up

**Track ID:** smoke-stability_20260613
**Spec:** [spec.md](./spec.md)
**Created:** 2026-06-13
**Status:** [~] In Progress — **Phase 1 + Phase 2 PASS** (Neon + Firebase live, app boots). Driving Phases
3–5 via the API next; Phases 6–8 + browser/Android/deploy steps await Redis/Fly/Cloudflare/Android.

> **⏳ Execution status (2026-06-13).** **Done:** **Phase 2** offline gate (all 5 green); **Phase 1** —
> **Neon** live in Singapore `ap-southeast-1` (migrated + schema-verified, Fly region `sin`) and **Firebase**
> live (project `xianslate`; web config + service account in `.env`, round-trip verified). App boots in
> **bridge mode** (`REDIS_URL` unset) on `:3100`: `/` + `/login/` render, and the signed-out guards already
> pass (`/app/`,`/admin/`→303 `/login`; `/api/books`→401). **Next (agent-drivable, no browser):** Phase 3
> (auth via Firebase REST + bearer), Phase 4 (tenancy — the security-critical, all-`⌨` phase), Phase 5
> (pipeline; translates cost a little DeepSeek credit). **Still needs operator:** `🌐` browser Google-OAuth
> popup / verification + reset emails (Phase 3), **Upstash/Redis** (Phase 6), **Fly/Cloudflare** (Phase 8),
> **Android SDK** (Phase 7). Tasks stay `[ ]` until their observed result matches.

## Overview

A 10-phase, **reproducible** verification runbook for the `scale-up-multitenant_20260613` build. Each
task lists the **exact command / endpoint / input** and the **expected result**; a task is `[x]` only
when the observed result matches. Any mismatch → record it in the per-phase "Findings", and (if it's a
real defect) open a `/conductor:new-track` **bug** track — this track finds + triages, it does not fix.

**Order is deliberate:** offline regression gate → no-Redis bridge (isolates Postgres/auth/tenancy from
the queue) → auth → tenancy → translation/data → Redis queue/cache → Android → hosting → stability →
sign-off. Run Phases 1–5 with `REDIS_URL` **unset** first (single process), then Phase 6 re-runs the
translation paths **with** Redis + two instances.

Per `workflow.md`: flexible TDD (Phase 9 adds the recommended automated tests), Conventional Commits for
any fixtures/tests/doc updates, **manual end-to-end verification** is the whole point of this track. Run
checks via the Windows node-path workaround:
`$env:Path = "C:\Program Files\nodejs;C:\Windows\System32;" + $env:Path` then `npm run …`.

> **Legend:** `⌨` = command, `→` = expected result, `🌐` = browser/UI step, `📱` = Android, `💉` = failure injection.

---

## Phase 1: Provisioning & first boot

Stand up the external services and get the app to boot against them. Depends on: operator accounts.

### Tasks

-   [x] Task 1.1: Provision **Neon** (Launch; min CU 0.25–0.5; autoscale on; scale-to-zero OFF; PITR 7d;
        region = Fly region). Put the three URLs in `.env` (`DATABASE_URL` pooled, `DATABASE_URL_DIRECT`,
        `DATABASE_URL_REPLICA`) per `.env.example`. **Observed (2026-06-13):** Neon project `xianslate` in
        **Singapore `ap-southeast-1`** (`ep-orange-meadow-aouq9zki`); Fly region aligned to `sin` (commit
        `4e9c91f`). All three URLs set in `.env` (pooled `-pooler` host → `DATABASE_URL`/`_REPLICA`, direct
        host → `_DIRECT`); dropped the `&channel_binding=require` flag (unsupported by postgres.js; TLS still
        on via `sslmode=require`).
-   [x] Task 1.2: Provision **Firebase**: enable Email/Password + Google; copy the web config →
        `PUBLIC_FIREBASE_*`; download a service-account key → `FIREBASE_SERVICE_ACCOUNT` (single-line JSON).
        **Observed (2026-06-13):** project `xianslate`; 4 `PUBLIC_FIREBASE_*` + the service-account JSON
        written to `.env` (flattened to single-line via `JSON.stringify(JSON.parse(file))`, stored unquoted).
        Round-trips through node `--env-file` → `JSON.parse` exactly as `admin.ts` does (private_key decodes
        to 28 real lines). `/login/` renders both "Continue with Google" + email/password. Provider toggles
        (Email/Password, Google) confirmed enabled by the rendered UI; a real sign-in is exercised in Phase 3.
-   [~] Task 1.3: Provision **Upstash Redis** → `REDIS_URL` (keep it handy; Phases 1–5 run with it
        **unset** to test the bridge, Phase 6 turns it on). Set `DEEPSEEK_API_KEY`. **Observed:**
        `DEEPSEEK_API_KEY` set ✓; **Upstash deliberately deferred to Phase 6** (Phases 1–5 require `REDIS_URL`
        unset — confirmed unset, server booted in bridge mode with no worker/Redis startup).
-   [x] Task 1.4: ⌨ `npm run db:migrate` → applies `drizzle/0000…0002` to Neon with **no error**; tables
        `users, books, chapters, translations, glossary, site_adapters, site_events, ai_usage` exist with
        the partial unique indexes (`glossary_global_unq WHERE scope='global'`, `chapters_url_unq` on
        `(book_id, chapter_url)`). Inspect via Neon SQL editor or `drizzle-kit studio`. **Observed
        (2026-06-13):** "Migrations applied." (exit 0); 3 migrations recorded. Introspection confirmed all
        **8 tables** present; `chapters_url_unq ON (book_id, chapter_url)` ✓; `glossary_global_unq ON
        (user_id, source_lang, target_lang, source) WHERE scope='global'` ✓; `glossary_book_unq … WHERE
        scope='book'` ✓; `translations_cache_key_unq` ✓. **PASS.**
-   [~] Task 1.5: (Optional, only if migrating existing local data) ⌨
        `SEED_ADMIN_UID=<your-firebase-uid> SEED_ADMIN_EMAIL=<you> node --env-file=.env scripts/etl-sqlite-to-pg.mjs`
        → row counts printed per table; books/glossary get `user_id`=seed admin; identity sequences reset
        (insert a new chapter afterward → no PK collision). **Observed:** **SKIPPED — clean start** (no legacy
        local data to migrate; Neon began empty). Not required.
-   [x] Task 1.6: ⌨ `npm run build && npm run preview` (or `npm run dev`) with `REDIS_URL` **unset** →
        server boots, **no top-level crash**, `console` shows no Redis/worker startup (bridge mode). 🌐
        `/` (landing, logo visible) and `/login/` render. **Observed (2026-06-13):** `npm run preview` on
        `:3100` → "Listening on http://0.0.0.0:3100", clean log (no Redis/worker line, no crash through all
        probes). `GET /` → 200 (brand "Xianslate" + logo + favicon); `GET /login/` → 200 (Google + email/pw UI).

### Verification

-   [x] App boots against Neon; landing + `/login/` load; `db:migrate` schema matches `schema.ts`. **PASS.**
-   [x] **Findings:** Phase 1 green except by-design deferrals: **Upstash/Redis** held for Phase 6 (1–5 run
        the bridge), optional **ETL skipped** (clean start). Bonus — the signed-out half of **Task 3.6** is
        already proven via curl: `GET /app/`→303 `/login/?redirect=%2Fapp%2F`; `GET /admin/`→303
        `/login/?redirect=%2Fadmin%2F`; `GET /api/books`→401 `{"message":"Sign in required."}`. Note: local
        `:3000` was already occupied (a dev server), so preview ran on `:3100`.

---

## Phase 2: Offline regression gate (no services needed)

Confirm the committed code is still green end-to-end before testing behaviour. Depends on: none.

### Tasks

-   [x] Task 2.1: ⌨ `npm run check` → `0 errors`. **Observed:** `COMPLETED 1024 FILES 0 ERRORS 0 WARNINGS`.
-   [x] Task 2.2: ⌨ `npm run lint` → exit 0 (the single pre-existing `headless.ts` `no-var` _warning_ is OK).
        **Observed:** initially exit 1 — but only because two of _this track's own_ Conductor docs
        (`plan.md`, `spec.md`, generated by `/conductor:new-track`) were not prettier-formatted (no app code).
        Ran `prettier --write` on those two docs (trivial doc fix, self-reviewable per `workflow.md`); re-run →
        exit 0 with exactly the one documented `headless.ts` warning (unused `no-var` eslint-disable directive).
-   [x] Task 2.3: ⌨ `npm run db:generate` → prints "No schema changes" / generates nothing new (i.e. the
        committed migrations match `schema.ts`; `git status` shows no new `drizzle/` files).
        **Observed:** "No schema changes, nothing to migrate 😴" (8 tables); `git status drizzle/` clean.
-   [x] Task 2.4: ⌨ `npm run build` (adapter-node) → `✓ built`, "Using @sveltejs/adapter-node".
        **Observed:** `✓ built in 11.50s`, "Using @sveltejs/adapter-node", `✔ done`, exit 0. (Pre-existing vite
        SSR "hydratable/untrack not exported" _warnings_ only — not errors.)
-   [x] Task 2.5: ⌨ `BUILD_TARGET=capacitor npm run build` → `✓ built`, "Wrote site to build-capacitor".
        **Observed:** `✓ built in 11.16s`, adapter-static, `Wrote site to "build-capacitor"`, `✔ done`, exit 0.

### Verification

-   [x] All five green; no schema drift. **Findings:** All five pass. Only finding: `npm run lint` flagged two
        of this track's own freshly-generated Conductor markdown docs (`plan.md`/`spec.md`) as unformatted —
        a documentation-formatting nit in the runbook itself, **not** a regression in the application code
        under test. Fixed in-place with `prettier --write` (trivial, self-reviewed). No schema drift; both the
        adapter-node and Capacitor/adapter-static builds are green. Regression gate **PASS**. Run on
        2026-06-13, Windows, node v24.15.0 (PATH workaround per `memory/windows-node-tooling-path.md`; note
        `db:generate` also needs `…\WindowsPowerShell\v1.0` on PATH — drizzle-kit shells out to `powershell.exe`).

---

## Phase 3: Auth & session smoke (web)

Validate the Firebase handshake + route guards. Depends on: Phase 1.

### Tasks

-   [ ] Task 3.1: 🌐 `/signup/` → create user A (email/password). → verification email sent; lands on
        `/verify-email/`; "Resend" works.
-   [ ] Task 3.2: 🌐 reload `/app/` → still signed in (session cookie persists). DevTools → a httpOnly
        `xianslate_session` cookie exists, `SameSite=Lax`, `Secure` in prod.
-   [ ] Task 3.3: 🌐 `/logout/` → cookie cleared; `/app/` now redirects to `/login/?redirect=%2Fapp%2F`.
-   [ ] Task 3.4: 🌐 `/login/` → sign in with email/password → back to `/app/`. Then "Continue with
        Google" → Google popup → `/app/`. (Native Google is Phase 7.)
-   [ ] Task 3.5: 🌐 "Forgot password?" on `/login/` (enter A's email) → reset email arrives.
-   [ ] Task 3.6: ⌨ guards while **signed out**: `curl -i $BASE/api/books` → **401** JSON `{message}`;
        `curl -i $BASE/api/admin/...`/any admin data → 401/403; `GET /app/book/x/` (no cookie) → 303 →
        `/login/`. While signed in as a non-admin: `/admin/` → 303 → `/app/`; `/api/admin/*` → **403**.
-   [ ] Task 3.7: Promote A to admin (SQL: `update users set role='admin' where email=…`) → `/admin/`
        loads the dashboard; `/api/admin/*` (if any) → 200.

### Verification

-   [ ] Sign-up+verify, both sign-ins, logout, reset, and every guard behave as above. **Findings:** _(…)_

---

## Phase 4: Multi-tenancy isolation & cost guardrail

The security-critical phase. Create a **second** user B. Depends on: Phase 3.

### Tasks

-   [ ] Task 4.1: As A, add a book (any source) + a book-scope glossary term + a global glossary term.
        Note A's `bookId` and a `chapterId`/`uuid`. Sign in as B (separate browser/profile).
-   [ ] Task 4.2: As B, exercise **every** owner-scoped endpoint against A's ids → expect **404** (never
        A's data): `GET /api/chapter?id=<A.uuid>`; `GET /api/books/<A.bookId>`;
        `GET /api/books/<A.bookId>/chapters`; `GET /api/chapters/<A.uuid>/stats`;
        `POST /api/chapters/<A.uuid>/progress`; `PATCH/DELETE /api/chapters/<A.uuid>`;
        `POST /api/books/<A.bookId>/read`; `POST /api/books/<A.bookId>/cover`;
        `POST/PATCH /api/books/<A.bookId>/chapters`; `POST /api/extract {chapterId:<A.id>}`;
        `GET /api/books/<A.bookId>/translating`.
-   [ ] Task 4.3: ⌨ Glossary isolation: as B, `GET /api/glossary?scope=global&sourceLang=…&targetLang=…`
        → only B's globals (not A's); `GET /api/glossary?scope=book&bookId=<A.bookId>` → **404**;
        `PUT/DELETE /api/glossary/<A.termId>` → 404 (term not found for B); CSV
        `GET /api/glossary/export?scope=book&bookId=<A.bookId>` → 404.
-   [ ] Task 4.4: **SSE hijack:** as B, `POST /api/translate {chapterId:<A.id>}` → **404** before any
        stream attaches (B can't observe A's translation).
-   [ ] Task 4.5: **Library scoping:** `GET /api/books` as A vs B → each sees only their own books; counts
        (`chapterCount`, `readChapters`, `translatedChapters`, first/resume uuids) are correct per user.
-   [ ] Task 4.6: **Cost guardrail:** set `QUOTA_USD_PER_WINDOW=0.01`, restart. As a user, translate a few
        fresh chapters until spend ≥ $0.01 → next `POST /api/translate` (fresh) and `POST /api/fetch` →
        **429** with the friendly budget message; a **cached** re-read of an already-translated chapter is
        still **free/allowed** (never hits the gate). Restore the quota.
-   [ ] Task 4.7: **Cascade on user delete:** SQL `delete from users where id=<B.uid>` → B's books,
        chapters, translations, glossary, and chapter-linked `ai_usage` are gone; `site_adapters` +
        `site_events` (and `'map'` ai_usage) remain. Confirm A's data untouched.

### Verification

-   [ ] No cross-user read/write anywhere; SSE hijack refused; over-budget refused; user-delete cascade
        correct + shared tables preserved. **Findings:** _(…)_

---

## Phase 5: Translation pipeline & Postgres data correctness

Exercise the full reader pipeline + the dialect-sensitive SQL. Still `REDIS_URL` unset (bridge).
Depends on: Phase 3.

### Tasks

-   [ ] Task 5.1: **Ingest — URL:** as A, fetch a `uukanshu.cc` chapter URL (reader "add" or
        `POST /api/fetch`) → chapter ingested; a per-user web book `web-<uid>-…` created; prev/next nav
        resolves; the site-adapter learns selectors once (`site_adapters` row; `ai_usage kind='map'`).
-   [ ] Task 5.2: **Ingest — EPUB + TXT + manual:** `POST /api/import/epub`, `/api/import/txt`, and a
        manual paste → books created with `userId`=A; chapters ordered by `seq`; `firstChapterUuid` correct
        (the `selectDistinctOn` path).
-   [ ] Task 5.3: **Extract:** `POST /api/extract {chapterId}` → terms found + added (additive only,
        never overwrites); `extractedAt` set; `GET /api/extract?chapterId=` lists the chapter's terms.
-   [ ] Task 5.4: **Translate (fresh):** open an untranslated chapter → SSE streams `prepare`→(`extracting`)
        →`meta`→`title`→`delta…`→`done`; `contentTarget` + `translatedAt` persisted; `translations` cache
        row written; `ai_usage` rows for extract/title.
-   [ ] Task 5.5: **Cached fast-path:** reload the same chapter → served instantly, **no new billing**
        (`done` with `cached:true`, `usage.costUsd≈0`); reading is free.
-   [ ] Task 5.6: **Self-heal:** (if you have a legacy/edited chapter) confirm source-residue **repair**
        and paragraph **realign** fire on read and persist the cleaned text (`ai_usage kind='repair'`).
-   [ ] Task 5.7: **Glossary search is case-insensitive (ILIKE):** add a term with a mixed-case source;
        `GET /api/glossary?scope=…&q=<lowercase>` → matches it (proves `ILIKE`, not PG case-sensitive `LIKE`).
-   [ ] Task 5.8: **Resume + progress:** read partway, navigate away, return to the book root
        `/app/book/<id>/` → redirects to the resume chapter at the saved scroll; `readProgress` (0..1,
        monotonic via `greatest()`) updates and "mark read/unread" works.
-   [ ] Task 5.9: **Cascade delete (book):** `DELETE /api/books/<id>` → its chapters, translations, and
        book-scope glossary are gone (FK cascade); global glossary + other books untouched.
-   [ ] Task 5.10: **Per-book URL uniqueness:** as A fetch URL X; as B fetch the **same** URL X → B gets
        their **own** copy in their own book (no global `chapters_url_unq` collision). Within one book,
        re-fetching X returns the existing chapter (no duplicate).

### Verification

-   [ ] Every source ingests; fresh translate streams + persists; re-read is free; ILIKE search works;
        resume/progress correct; cascades correct; two users share a URL. **Findings:** _(…)_

---

## Phase 6: Distributed queue, global cap & cache bus (Redis) + bridge parity

Now turn **on** Redis and validate the distributed path + that the bridge stayed correct. Depends on:
Phase 5 (so you know the pipeline works in-memory first).

### Tasks

-   [ ] Task 6.1: **Bridge baseline (recap):** with `REDIS_URL` unset, a fresh translate completed in
        Phase 5 → confirms the in-memory `jobs` Map + per-process `PQueue` path works (the Phase-0 bridge).
-   [ ] Task 6.2: Set `REDIS_URL`; start **one worker** process (`RUN_TRANSLATE_WORKER=1`) + **one** web
        process. Translate a fresh chapter → web `POST /api/translate` enqueues (BullMQ `translate` job,
        id=chapterId); the worker runs `run()` and **publishes** events; the SSE stream shows the same
        `prepare…done` sequence. `translations`/`contentTarget` persisted.
-   [ ] Task 6.3: **Duplicate collapse:** fire two concurrent translates of the same `chapterId` → one
        BullMQ job (no double-billing); both SSE clients see the stream.
-   [ ] Task 6.4: **Two web instances + reconnect replay:** start web instances on :3000 and :3001 (same
        `REDIS_URL`), worker running. Begin a translate via :3000; **mid-stream**, open the SSE for the
        same chapter against :3001 → it **replays** the capped backlog then tails live (ordered, no
        dupes), and reaches `done`. (Proves cross-instance Redis pub/sub + `subscribeToTranslation`.)
-   [ ] Task 6.5: **Global cap = worker concurrency:** set the cap to **1** (`redis.setGlobalConcurrency(1)`
        or seed `config:deepseek_concurrency`=1; restart worker). Trigger 3 chapter translates → they run
        **serially** (BullMQ active=1 at a time; `GET /api/books/<id>/translating` reflects it). Raise to
        4 → parallelism returns. Optionally set `DEEPSEEK_RPM` and confirm the rate limiter.
-   [ ] Task 6.6: **Cache bus:** two web instances. Edit a glossary term on :3000 (`PUT /api/glossary/<id>`
        or the editor) → on :3001 the next read of that book reflects the change (the `cache:invalidate`
        broadcast dropped :3001's stale `glossary-match` cache). Repeat for a site-adapter re-learn.
-   [ ] Task 6.7: 💉 **Redis loss mid-run:** start a translate; kill Redis before `done` → the SSE may drop,
        but the worker's completion still **persists to Postgres**; re-open the chapter → served from
        `contentTarget` (free fast-path). No lost translation, no stuck state.
-   [ ] Task 6.8: **`activeChapterIds` (queue mode):** `GET /api/books/<id>/translating` returns the
        BullMQ active/waiting chapter ids (cross-instance), not just the local process's.

### Verification

-   [ ] Queue path streams correctly; dedup; cross-instance reconnect replay; cap serializes at 1;
        cross-instance glossary/adapter invalidation; Redis-kill leaves a persisted translation.
        **Findings:** _(…)_

---

## Phase 7: Capacitor Android

Build + run the APK against the hosted (or tunneled) API. Depends on: Phases 3 + 6 + Android SDK.

### Tasks

-   [ ] Task 7.1: Wire the Firebase **Android app**: `google-services.json` → `android/app/`; add the
        `com.google.gms:google-services` Gradle plugin (project + app `build.gradle`) per the
        `@capacitor-firebase/authentication` docs; register SHA-1/256 in Firebase. (DEPLOYMENT.md §6.)
-   [ ] Task 7.2: ⌨ `echo PUBLIC_API_BASE=https://xianslate.com >> .env` (or your tunnel) →
        `BUILD_TARGET=capacitor npm run build` → `npx cap sync android`. Confirm `android/app/src/main/assets/public`
        is refreshed (the synced SPA).
-   [ ] Task 7.3: ⌨ `npx cap run android` (emulator/device) → app **boots to `/app/`**; favicon/splash +
        logo render; theme applies from localStorage (no flash).
-   [ ] Task 7.4: 📱 **Native sign-in:** "Continue with Google" → the **native** Google flow (not a webview
        redirect) → signed in; also email/password works. `firebaseAuth().currentUser` populated.
-   [ ] Task 7.5: 📱 **Cross-origin bearer:** library lists, a chapter reads, and a translate **streams**
        — all against `https://xianslate.com/api` with `Authorization: Bearer` (no cookies). Confirm the
        `/api` CORS handle answers the preflight + tags responses for the capacitor origin.
-   [ ] Task 7.6: 📱 `/` (landing) and `/admin` are **not reachable** in-app (start path `/app/`, no nav).

### Verification

-   [ ] APK boots, native + email sign-in work, cross-origin data + streaming work, landing/admin
        unreachable. **Findings:** _(…)_

---

## Phase 8: Hosting smoke (Fly + Cloudflare)

Deploy the real topology and re-run the critical paths through it. Depends on: Phases 1–6 + Fly/Cloudflare.

### Tasks

-   [ ] Task 8.1: ⌨ `fly secrets set …` (all from DEPLOYMENT.md §2) → `fly deploy` → `web` +
        `translation-worker` process groups start; health check on `web` is green; the worker logs
        "[translate-worker] started (concurrency=…)".
-   [ ] Task 8.2: ⌨ `fly scale count web=2 translation-worker=1` → two stateless web machines; re-run the
        Phase-6 reconnect-replay test through the live deployment.
-   [ ] Task 8.3: **Cloudflare:** DNS proxied; `/_app/immutable/*` is cached (response `cf-cache-status:
HIT` on 2nd load); `/api/*` is **bypassed** (never cached). A translate **SSE streams through
        Cloudflare** without buffering (the 15s heartbeat + `x-accel-buffering:no` keep it alive).
-   [ ] Task 8.4: **Auth across the edge:** web cookie is same-origin (works); a cross-origin bearer call
        (simulate the app) succeeds with CORS.
-   [ ] Task 8.5: (If a Neon replica exists) point `DATABASE_URL_REPLICA` at it → heavy reads hit the
        replica; otherwise confirm `dbRead`===primary is harmless.
-   [ ] Task 8.6: (Scraper) confirm web/worker scrape in-process today (Chromium in the image); note the
        scraper-split follow-up is **not** deployed (App B is a template).

### Verification

-   [ ] Live deploy serves the app; multi-instance SSE replay works through Cloudflare; cache rules +
        `/api` bypass correct; auth works both modes. **Findings:** _(…)_

---

## Phase 9: Stability, failure-injection & regression tests

Confirm it doesn't fall over, and lock in the breakage-prone paths with tests. Depends on: Phases 4–6.

### Tasks

-   [ ] Task 9.1: **Light soak:** drive ~20–50 chapter translates over ~20 min across 2 users (script the
        reader's `/api/translate` calls) → no crash; Fly machine memory stable (no leak); Neon/Redis
        connection counts bounded (postgres.js `max:10`, BullMQ pool); no stuck BullMQ jobs (check
        `failed`/`active`).
-   [ ] Task 9.2: 💉 **DeepSeek down:** point `DEEPSEEK_BASE_URL` at a dead host → translate emits a clean
        `error` event + friendly toast; no chapter is half-saved; ret/withRetry backs off; the next valid
        request recovers.
-   [ ] Task 9.3: 💉 **DB blip:** briefly suspend/resume Neon (or kill the pooled connection) → requests
        error gracefully (no unhandled rejection crash); recovers on reconnect (postgres.js).
-   [ ] Task 9.4: 💉 **SSE reconnect storm:** rapidly open/close the translate SSE for one chapter 20×
        (queue mode) → subscriber connections are cleaned up (no leak in `channelHandlers`); the job runs
        once; no orphaned Redis subscriptions.
-   [ ] Task 9.5: **Quota window rollover:** with a short `QUOTA_WINDOW_MS`, confirm spend ages out and a
        previously-blocked user can translate again after the window.
-   [ ] Task 9.6: **(Recommended) Automated tests** for the breakage-prone logic (per `workflow.md`'s
        flexible TDD): Postgres glossary precedence + ILIKE; `translationCacheKey` fingerprint stability;
        tenancy scoping (`assertBookOwner`/`getOwnedChapterByUuid` reject cross-user); auth
        `verifySessionCookie`/`upsertUserFromToken`; queue `subscribeToTranslation` replay+dedup ordering.
        Add a test runner (e.g. Vitest) + a `test` script; wire into `npm run check` or CI later.

### Verification

-   [ ] Soak shows no crash/leak/stuck job; every failure-injection degrades gracefully + recovers; quota
        window rolls over; (if done) tests pass. **Findings:** _(…)_

---

## Phase 10: Sign-off, triage & docs

Capture results and close the loop. Depends on: all.

### Tasks

-   [ ] Task 10.1: Compile a **results summary** (per-phase pass/fail + the "Findings") into this track's
        `index.md` (or a `RESULTS.md`).
-   [ ] Task 10.2: For each real defect found, open a `/conductor:new-track` **bug** track (don't fix here)
        — link them from the summary.
-   [ ] Task 10.3: Triage the **documented follow-ups** (decide do-now vs later): route in-component `/app`
        client fetches through `apiFetch` (full native parity); the Chromium **scraper split**; **R2 cover**
        proxying; automated-test/CI. File tracks for the ones to do.
-   [ ] Task 10.4: Update docs from what you learned (DEPLOYMENT.md gaps, `conductor/tech-stack.md`,
        `memory/scale-up-architecture-plan.md` → flip "code-complete" → "verified" or note live gaps).
-   [ ] Task 10.5: Mark `scale-up-multitenant_20260613`'s **live E2E** items done (or note remaining), and
        mark this track complete in `tracks.md` + `conductor/index.md`.

### Verification

-   [ ] Results recorded; bugs + follow-ups filed; docs/memory updated; both tracks' statuses reflect reality.

## Final Verification

-   [ ] All acceptance criteria (spec) met or each gap captured as a tracked bug/follow-up.
-   [ ] Regression gate (`check`/`lint`/both builds) still green at the end.
-   [ ] Results summary + triage committed; this track marked complete in `tracks.md` + `conductor/index.md`.

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
