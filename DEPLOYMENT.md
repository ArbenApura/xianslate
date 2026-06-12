# Xianslate — Deployment & Provisioning

This is the operator runbook for the multi-tenant online deployment
(`scale-up-multitenant_20260613`). The application **code** for every phase is complete and
`npm run check` + `npm run build` are green. What remains is **provisioning external accounts**
(which need your credentials) and the live end-to-end verification.

Topology: a single **Cloudflare** origin `xianslate.com` fronting a **Fly.io** Node app
(`web` + `translation-worker` process groups), **Neon** Postgres, **Upstash** (or other) Redis, and
**Firebase** auth. The **Android** app ships only `/app` as a static SPA against `https://xianslate.com/api`.

---

## 0. One-time provisioning (needs your accounts)

| Service             | What to create                                                                                                                                                                            | Env it produces                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon** (Postgres) | Project (Launch plan; min CU 0.25–0.5; autoscale on; scale-to-zero OFF; PITR 7d). Region = the Fly region.                                                                                | `DATABASE_URL` (pooled `-pooler`), `DATABASE_URL_DIRECT` (direct/session), `DATABASE_URL_REPLICA` (= pooled until a replica exists)                                    |
| **Firebase**        | Project; enable **Email/Password** + **Google**; a **service-account** key (server); an **Android app** with `google-services.json` + SHA-1/256 fingerprints (for native Google sign-in). | `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID`, `PUBLIC_FIREBASE_APP_ID`, `FIREBASE_SERVICE_ACCOUNT` (whole JSON, single line) |
| **Upstash** (Redis) | A Redis database (TLS).                                                                                                                                                                   | `REDIS_URL` (`rediss://…`)                                                                                                                                             |
| **Cloudflare**      | Zone for `xianslate.com`; an **R2** bucket (future cover proxying — see §5).                                                                                                              | —                                                                                                                                                                      |
| **Fly.io**          | Org + the `xianslate` app (+ optional `xianslate-scraper`).                                                                                                                               | —                                                                                                                                                                      |
| **Android**         | Android Studio / SDK toolchain for the APK.                                                                                                                                               | —                                                                                                                                                                      |

All env vars are documented in `.env.example`.

---

## 1. Database (Phase 2)

```bash
# After setting DATABASE_URL_DIRECT (Neon direct endpoint) in .env:
npm run db:migrate          # applies drizzle/*.sql to Neon (creates the schema)
# OPTIONAL — migrate your existing local SQLite library into Neon:
SEED_ADMIN_UID=<your-firebase-uid> SEED_ADMIN_EMAIL=<you@example.com> \
  node --env-file=.env scripts/etl-sqlite-to-pg.mjs
```

The ETL assigns all pre-existing (single-user) books/glossary to the seed admin. Set
`SEED_ADMIN_UID` to your Firebase uid so your library is yours after you sign in. Skip the ETL for a
clean start. After the ETL succeeds you can `npm rm @libsql/client` (the app no longer uses libsql).

---

## 2. Secrets (Fly)

```bash
fly secrets set \
  DATABASE_URL='postgresql://…-pooler…?sslmode=require' \
  DATABASE_URL_DIRECT='postgresql://…(direct)…?sslmode=require' \
  DATABASE_URL_REPLICA='postgresql://…-pooler…?sslmode=require' \
  DEEPSEEK_API_KEY='sk-…' \
  REDIS_URL='rediss://default:…@…:6379' \
  FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",…}' \
  PUBLIC_FIREBASE_API_KEY='…' PUBLIC_FIREBASE_AUTH_DOMAIN='…' \
  PUBLIC_FIREBASE_PROJECT_ID='…' PUBLIC_FIREBASE_APP_ID='…'
```

`REDIS_URL` is optional: **unset → single-instance in-memory bridge** (the app still works, one
process). Set it to enable the distributed BullMQ queue + cross-instance cache bus.

---

## 3. Deploy the API (Phases 5 + 7)

`fly.toml` defines two process groups from one image (`Dockerfile`):

-   **web** — serves HTTP, enqueues translations (does not run the worker).
-   **translation-worker** — same image; `hooks.server.ts` starts the BullMQ worker because Fly sets
    `FLY_PROCESS_GROUP=translation-worker` (or set `RUN_TRANSLATE_WORKER=1`). No public HTTP.

```bash
fly deploy                  # builds Dockerfile, deploys both process groups
fly scale count web=2 translation-worker=1   # stateless web tier scales horizontally
```

Tune the global DeepSeek cap at runtime (no redeploy) via the `config:deepseek_concurrency` Redis
key (`redis.setGlobalConcurrency`); set a requests/min ceiling with `DEEPSEEK_RPM`.

### Scraper split (target topology — remaining code step)

The fetcher currently scrapes **in-process** (Playwright via `headless.ts`), so the deployed image
includes Chromium. The spec's target is a **slim** web/worker image + a separate Chromium scraper app
(`Dockerfile.scraper` / `fly.scraper.toml`, reached at `xianslate-scraper.internal`). Wiring the web
tier to call that scraper over HTTP (instead of `headless.ts` directly) is the remaining code step;
until then deploy the monolithic image above. After the split, remove the `playwright install` line
from `Dockerfile`.

---

## 4. Cloudflare (Phase 7)

1. **DNS:** `xianslate.com` → the Fly app (orange-cloud / proxied).
2. **Cache rule:** cache `/_app/immutable/*` aggressively (immutable, hashed assets); **bypass**
   cache for `/api/*` (dynamic + SSE).
3. **SSE:** the translate stream already sends a 15s heartbeat + `x-accel-buffering:no`, so it streams
   cleanly through the proxy.
4. Web auth is same-origin (cookie); the native app is cross-origin (bearer) — the `/api` CORS handle
   allows the Capacitor origins.

---

## 5. R2 (cover images)

Covers are currently **external URLs** scraped from each source site (hotlinked; the app stores the
URL, not bytes), so no object storage is required for them today. Provision the R2 bucket for the
**future** optimization of proxying/caching covers (avoids dead hotlinks) and any user-uploaded
images. Routing `uploads.ts` / the cover endpoint to R2 (S3 API) is a follow-up; it is not wired yet.

---

## 6. Android (Phases 6 + 7)

Capacitor **8.4.0** (latest stable). The native project (`android/`, appId `com.xianslate.app`) is
**already generated and committed** (`capacitor.config.ts` uses `androidScheme: 'https'`, the
documented best practice). Capacitor's own `android/.gitignore` excludes build outputs,
`local.properties`, and the synced web assets. You only need to (re)sync the web build and build the APK
— which needs the **Android SDK / Android Studio** (not installed on the dev box):

```bash
# point the native app at the hosted API:
echo 'PUBLIC_API_BASE=https://xianslate.com' >> .env
BUILD_TARGET=capacitor npm run build         # -> build-capacitor/ (static SPA, /app only)
npx cap sync android                         # copies the web build + plugins into android/
npx cap run android                          # emulator/device  (or: npx cap open android)
```

Native Google sign-in (`@capacitor-firebase/authentication`, configured in `capacitor.config.ts`)
needs the Firebase **Android app** wired into the native project — a one-time native setup per the
plugin docs:

1. Add the **`google-services.json`** (from the Firebase Android app) to `android/app/`.
2. In `android/build.gradle` add `classpath 'com.google.gms:google-services:4.4.2'`; in
   `android/app/build.gradle` add `apply plugin: 'com.google.gms.google-services'` + the Firebase
   Auth BoM. (Do this only once you have `google-services.json` — applying the plugin without it
   fails the Gradle build.)
3. Register the app's **SHA-1/256** fingerprints in the Firebase console.

The APK boots to `/app/`; `/` and `/admin` are unreachable in-app.

---

## 7. Smoke / verification checklist (whole-track E2E)

Run once provisioning is done:

-   [ ] Sign up (email + verification) and Google sign-in both work; session persists across reloads.
-   [ ] `/app` requires login; `/admin` requires `role==='admin'`; `/api` returns 401 logged out.
-   [ ] Add a book (URL / EPUB / TXT) → extract → translate (streamed) → read (progress saved).
-   [ ] Glossary edit on web instance A is seen by instance B (Redis cache bus).
-   [ ] A second user cannot see/mutate the first user's books/glossary; a guessed `chapterId` translate
        attach is refused (404).
-   [ ] Over-budget translate is refused (set `QUOTA_USD_PER_WINDOW` low to test).
-   [ ] Global cap honoured across workers (set the concurrency to 1 → serialized).
-   [ ] Kill Redis mid-translate → a completed translation is still persisted (next read is free).
-   [ ] Android APK: native sign-in + library + reader + streaming translation work cross-origin with the
        bearer token.
