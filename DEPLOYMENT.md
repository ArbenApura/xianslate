# Xianslate — Deployment & Provisioning

Operator runbook for the multi-tenant online deployment. The application **code** is complete and
`npm run check` + `npm run build` are green. What remains is **provisioning external accounts** (which
need your credentials).

Topology: a single **Cloudflare** origin fronting a **single Fly.io** Node machine that serves HTTP and
runs translations in-process, **Neon** Postgres, and **Firebase** auth. (No Redis/queue — translation is
in-process; the app runs as one instance.)

---

## 0. One-time provisioning (needs your accounts)

| Service             | What to create                                                                                             | Env it produces                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon** (Postgres) | Project (Launch plan; min CU 0.25–0.5; autoscale on; scale-to-zero OFF; PITR 7d). Region = the Fly region. | `DATABASE_URL` (pooled `-pooler`), `DATABASE_URL_DIRECT` (direct/session), `DATABASE_URL_REPLICA` (= pooled until a replica exists)                                    |
| **Firebase**        | Project; enable **Email/Password** + **Google**; a **service-account** key (server).                       | `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID`, `PUBLIC_FIREBASE_APP_ID`, `FIREBASE_SERVICE_ACCOUNT` (whole JSON, single line) |
| **Cloudflare**      | Zone for your domain.                                                                                      | —                                                                                                                                                                      |
| **Fly.io**          | Org + the app.                                                                                             | —                                                                                                                                                                      |

All env vars are documented in `.env.example`.

---

## 1. Database

```bash
# After setting DATABASE_URL_DIRECT (Neon direct endpoint) in .env:
npm run db:migrate          # applies drizzle/*.sql to Neon (creates the schema)
```

---

## 2. Secrets (Fly)

```bash
fly secrets set \
  DATABASE_URL='postgresql://…-pooler…?sslmode=require' \
  DATABASE_URL_DIRECT='postgresql://…(direct)…?sslmode=require' \
  DATABASE_URL_REPLICA='postgresql://…-pooler…?sslmode=require' \
  DEEPSEEK_API_KEY='sk-…' \
  ZYTE_API_KEY='…' \
  FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",…}' \
  PUBLIC_FIREBASE_API_KEY='…' PUBLIC_FIREBASE_AUTH_DOMAIN='…' \
  PUBLIC_FIREBASE_PROJECT_ID='…' PUBLIC_FIREBASE_APP_ID='…'
```

`ZYTE_API_KEY` enables the managed-fetch transport (managed proxies + HTTP tier). Leave it unset to run on
the free `node fetch → curl` path only (fine for the static novel hosts; JS-rendered sites won't work
without it).

Optional: `DEEPSEEK_CONCURRENCY` (max parallel DeepSeek calls),
`ZYTE_RPS` (per-key rate cap, default 2 — see `fly.toml`), `ZYTE_MAX_RETRIES` (429/503 backoff retries),
`ZYTE_COST_PER_REQUEST` (pass-through cost estimate recorded per fetch).

---

## 3. Deploy the API

`fly.toml` runs **one** `node build` machine (`Dockerfile`) that serves HTTP and runs translations
in-process — no Redis, queue, or worker.

```bash
fly deploy   # builds Dockerfile, deploys the single web machine
```

Translation state is per-machine (in-memory), so **keep this to one instance** — `fly scale vm` UP
(bigger machine) for more headroom, do **not** `fly scale count > 1`. Horizontal scaling would require
re-introducing a shared queue.

Tune the max parallel DeepSeek calls with the `DEEPSEEK_CONCURRENCY` env (restart to apply).

### Fetching (Zyte primary; no local Chromium)

When `ZYTE_API_KEY` is set, **Zyte** is the primary transport via its static `httpResponseBody` tier (managed
proxies + Cloudflare unblocking). All Zyte calls are paced to `ZYTE_RPS` (default 2/s, the per-key limit) by
an in-process queue, with 429/503 backoff. Each successful Zyte fetch records a pass-through cost against the
chapter's stats ledger.

There is **no headless browser and no browser-render tier** — the image stays slim (~1 GB RAM floor, small
shared-CPU VM). If `ZYTE_API_KEY` is unset, or Zyte is unreachable, the fetcher degrades to the free path:
plain Node `fetch` with a system `curl` fallback for bot-walled hosts (Cloudflare 403/503). JS-rendered sites
with no static chapter (in the page HTML) surface as `unsupported_site` / `parse_failed`; static,
server-rendered hosts (most target novel sites) work normally.

> The Zyte rate-limit queue and the per-host caches are **per machine**, which is another reason to keep
> this a single instance (see the scaling note above and in `fly.toml`).

---

## 4. Cloudflare

1. **DNS:** your domain → the Fly app (orange-cloud / proxied).
2. **Cache rule:** cache `/_app/immutable/*` aggressively (immutable, hashed assets); **bypass**
   cache for `/api/*` (dynamic + SSE).
3. **SSE:** the translate stream already sends a 15s heartbeat + `x-accel-buffering:no`, so it streams
   cleanly through the proxy.

---

## 5. Mobile app (Capacitor)

The Android/iOS apps are a **static SPA** of the same codebase that talks to this deployed API cross-origin.
Deploying the API/web is **unchanged** (one instance, same secrets); the only server-side requirements are
already in the code:

-   **CORS**: `src/hooks.server.ts` answers preflights and stamps `Access-Control-Allow-*` for the two WebView
    origins `capacitor://localhost` (Android) and `https://localhost` (iOS). No credentials flag — the app
    authenticates with a **Bearer Firebase ID token** (accepted by `hooks.server.ts` alongside the web session
    cookie).
-   **`PUBLIC_API_BASE`**: the mobile build bakes the live API origin into its bundle at build time. Set it in
    a gitignored `.env.capacitor` (e.g. `PUBLIC_API_BASE=https://xianslate.fly.dev`) — **not** in `.env`, which
    would redirect local web dev at the live API. Then `yarn build:capacitor && npx cap sync` and build the
    native project (`android/` is committed; `ios/` is generated on a Mac).
-   **Firebase console**: add the Android app (package `dev.xianslate.app`) and its debug-keystore SHA-1 for
    native Google sign-in; iOS needs `GoogleService-Info.plist`.

Full build/run instructions: README → _Mobile apps (Capacitor)_.

---

## 6. Smoke / verification checklist

Run once provisioning is done:

-   [ ] Sign up (email + verification) and Google sign-in both work; session persists across reloads.
-   [ ] `/app` requires login; `/api` returns 401 logged out.
-   [ ] Add a book (URL / EPUB / TXT) → extract → translate (streamed) → read (progress saved).
-   [ ] A glossary edit is reflected on the next read of that book.
-   [ ] A second user cannot see/mutate the first user's books/glossary; a guessed `chapterId` translate
        attach is refused (404).
