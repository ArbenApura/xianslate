# Xianslate

A multi-user web app that **fetches Chinese (and other) web novels, builds per-book & global glossaries,
and translates them to English** with DeepSeek — in a fast, fully customizable, mobile-responsive reader.
Built for consistent, glossary-pinned translations (names/terms stay stable across a whole book) at minimal
cost.

## Features

-   **Ingest from 3 sources**: paste a chapter URL from supported sites (self-healing AI-learned parsers),
    import an **EPUB**, or import a **TXT** (auto-split into chapters by headings).
-   **Private library** per account (Firebase sign-in): many books, each with its own glossary; resumes
    your last-read chapter.
-   **Glossary** with `source` / `target` / `gender` (neuter·masculine·feminine):
    -   **Per-book** and **global** scopes — a book term overrides a global term on the same `source`.
    -   **CSV import / export** (`source,target,description`; gender derived from `#masculine` /
        `#feminine` tags). Bulk import is a single fast transaction.
    -   Auto **term extraction** from a chapter via DeepSeek, with gender.
-   **Translation** (DeepSeek, streaming):
    -   Injects **only the chapter-relevant glossary terms** via an Aho-Corasick scan (e.g. ~130 of
        7,000+), so prompts stay small, cheap, and on-topic — with gender-aware pronouns.
    -   **Memoized**: re-reading a translated chapter is instant and free; re-billed only if the text,
        matched glossary, model, or prompt changes.
    -   Prompts are ordered **stable-prefix-first** to maximize DeepSeek context-cache reuse.
    -   Live **token/cost meter** per chapter.
-   **Reader**: theme presets (light · sepia · dark · OLED · high-contrast), font family/size/weight,
    line-height, letter/paragraph spacing, measure width, alignment/indent; layout modes
    **side-by-side / interleaved / English-only / Chinese-only**; keyboard shortcuts; **TTS**
    (sentence/word highlighting); fully **mobile-responsive**.
-   **Chapter analytics**: per-chapter token/cost breakdown, translation run history, glossary coverage.

## Tech stack

SvelteKit 2 (Svelte 4) · TypeScript · TailwindCSS · Vite · **PostgreSQL** (Neon) via **postgres.js** +
Drizzle ORM · **Firebase** auth (email/password + Google) · DeepSeek via the OpenAI-compatible SDK ·
`node-html-parser` · `ahocorasick` · `papaparse` · `svelte-sonner`. Deployed with `@sveltejs/adapter-node`
on Fly.io behind Cloudflare.

> **Single-instance & in-process:** translations run in-process on one server (no Redis/queue/worker —
> a stateful in-memory job map with SSE streams). Keep deployments to **one instance**; scale up, not out.

## Setup

Requires **Node 22.18+** (the `db:migrate` script runs TypeScript directly via Node's built-in type
stripping) and **Yarn** (classic), plus three external services: **PostgreSQL** (any Postgres — Neon is
recommended), **Firebase** (auth), and a **DeepSeek** API key. Zyte is optional. Everything below takes
about 15 minutes the first time.

### 1. DeepSeek (translation provider)

1. Create an account at <https://platform.deepseek.com> and top up a small balance (API access requires
   prepaid credits).
2. Go to **API Keys** → **Create API key**, copy it. It looks like `sk-...`.
3. You're done — that key is the only thing `DEEPSEEK_API_KEY` needs. The app defaults to
   `deepseek-v4-flash`; you can switch users to a Pro model from the reader's settings drawer, so no
   extra setup is needed for it.

### 2. Firebase (authentication)

1. Go to <https://console.firebase.google.com> → **Add project** (name it anything; Google Analytics is
   not needed).
2. **Enable the sign-in providers** — _Build → Authentication → Sign-in method_:
    - Turn on **Email/Password**.
    - Turn on **Google** (optional but recommended — the login page shows a Google button).
    - The default **Authorized domains** already include `localhost`; add your production domain later.
3. **Register a Web app** — _Project settings → Your apps → Add app → Web_ (the `</>` icon). The console
   shows a config snippet containing exactly the four values you need:
   `apiKey`, `authDomain`, `projectId`, `appId`. Copy them into `PUBLIC_FIREBASE_API_KEY`,
   `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID`, `PUBLIC_FIREBASE_APP_ID`.
4. **Create a service-account key** — _Project settings → Service accounts → Generate new private key_.
   This downloads a JSON file. Its **entire contents** (including the `\n` escapes in `private_key` —
   do not reformat it) must become the single-line `FIREBASE_SERVICE_ACCOUNT` env var. On macOS/Linux:

    ```bash
    jq -c . firebase-adminsdk-key.json          # compact one-line JSON — paste into .env
    ```

    On Windows PowerShell:

    ```powershell
    (Get-Content firebase-adminsdk-key.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress)
    ```

5. **Email templates (optional but recommended)** — the app triggers Firebase's verification
   ("Confirm your email", sent at sign-up) and password-reset emails. Their default templates are fine
   for development; customize them at _Authentication → Templates_ before going public.
6. New users start with `role = 'user'`; there is no admin panel in this build, so nothing else is
   needed here.

### 3. PostgreSQL (data)

Any Postgres 14+ works; the app is developed against **Neon** (serverless, free tier is fine):

1. Create a project at <https://console.neon.tech> (any region).
2. Open **Connection details** and pick the **Prisma** tab (it shows the pooled URL). You need **three**
   connection strings with the same credentials, differing only in host:
    - `DATABASE_URL` — the **pooled** URL (`...-pooler.region.aws.neon.tech`), used at runtime.
    - `DATABASE_URL_DIRECT` — the **direct** URL (no `-pooler`), used by migrations.
    - `DATABASE_URL_REPLICA` — the direct/pooled URL again (the app reads from the primary until you add
      a real read replica).
      All three keep `?sslmode=require` (the app requires TLS).
3. Don't create any tables — `yarn db:migrate` applies the schema from `drizzle/` (see step 5).

### 4. Zyte (optional — paid fetch transport)

The app can fetch chapter pages with plain `node fetch` + a system `curl` fallback, which works for most
static novel sites. When a site blocks that (Cloudflare/JS walls), set `ZYTE_API_KEY` from
<https://www.zyte.com> and fetches go through Zyte's managed proxies instead. Skipping Zyte is fine to
start; `ZYTE_COST_PER_REQUEST` defaults to a Tier-3 estimate and is billed against each user's cost
guardrail.

### 5. Assemble `.env` and run

```bash
yarn install
cp .env.example .env     # then fill in every value — it is fully commented
# .env must contain: DEEPSEEK_API_KEY, DATABASE_URL, DATABASE_URL_DIRECT, DATABASE_URL_REPLICA,
#                    PUBLIC_FIREBASE_API_KEY, PUBLIC_FIREBASE_AUTH_DOMAIN,
#                    PUBLIC_FIREBASE_PROJECT_ID, PUBLIC_FIREBASE_APP_ID, FIREBASE_SERVICE_ACCOUNT
yarn db:migrate          # applies drizzle/*.sql to Postgres — uses DATABASE_URL_DIRECT
yarn dev                 # http://localhost:5173
```

Then sign up at <http://localhost:5173/signup/> — you'll get a Firebase verification email, and after
confirming you can add a book (URL, EPUB, or TXT) and translate.

### Environment reference (`.env`)

| Var                           | Purpose                                                                  | Default                    |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| `DEEPSEEK_API_KEY`            | DeepSeek API key (server-side only)                                      | —                          |
| `DEEPSEEK_BASE_URL`           | API base URL                                                             | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL`              | Model id                                                                 | `deepseek-v4-flash`        |
| `DEEPSEEK_REASONING`          | `enabled` allows the model's chain-of-thought; anything else disables it | `disabled`                 |
| `DATABASE_URL`                | Pooled Postgres URL (runtime)                                            | —                          |
| `DATABASE_URL_DIRECT`         | Direct/session Postgres URL (migrations)                                 | —                          |
| `DATABASE_URL_REPLICA`        | Read-replica URL (= the pooled primary until a replica is added)         | —                          |
| `PUBLIC_FIREBASE_API_KEY`     | Firebase web-app `apiKey` (public)                                       | —                          |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase web-app `authDomain` (public)                                   | —                          |
| `PUBLIC_FIREBASE_PROJECT_ID`  | Firebase web-app `projectId` (public)                                    | —                          |
| `PUBLIC_FIREBASE_APP_ID`      | Firebase web-app `appId` (public)                                        | —                          |
| `FIREBASE_SERVICE_ACCOUNT`    | The whole service-account JSON as a single-line string (server-only)     | —                          |
| `ZYTE_API_KEY`                | Optional paid fetch transport; unset → free fetch→curl path              | —                          |
| `ZYTE_COST_PER_REQUEST`       | Pass-through Zyte cost estimate per successful fetch (USD)               | `0.00044`                  |
| `DEEPSEEK_CONCURRENCY`        | Max parallel translation calls (single process)                          | `64`                       |
| `DB_POOL_MAX`                 | postgres.js connections per role                                         | `25`                       |

Optional per-model price overrides (USD per 1M tokens) for the cost meter — these default to DeepSeek's
published Flash/Pro rates, override only to track price changes:
`DEEPSEEK_PRICE_FLASH_INPUT` / `_FLASH_CACHED` / `_FLASH_OUTPUT` (cache-miss input / cache-hit input / output)
and `DEEPSEEK_PRICE_PRO_INPUT` / `_PRO_CACHED` / `_PRO_OUTPUT`.

> **Security:** `.env` is gitignored. The Firebase web-config values are public by design (they ship in
> the browser bundle); `DEEPSEEK_API_KEY` and `FIREBASE_SERVICE_ACCOUNT` are **server-only** and must
> never be committed or exposed. If a key ever leaks, rotate it in the provider console.

## Scripts

| Script                              | Does                                  |
| ----------------------------------- | ------------------------------------- |
| `yarn dev`                          | Dev server                            |
| `yarn build` / `yarn start`         | Production build / run (`node build`) |
| `yarn run check`                    | `svelte-check` type-check             |
| `yarn run lint` / `yarn run format` | Prettier + ESLint                     |
| `yarn db:push` / `yarn db:studio`   | Apply schema / open Drizzle Studio    |
| `yarn db:migrate`                   | Apply `drizzle/*.sql` migrations      |

## How it works

```
Ingest (web fetch / EPUB / TXT)
  └─ books + chapters (PostgreSQL)
Glossary (per-book ⊕ global → effective)
  └─ Aho-Corasick automaton ─► match only terms present in the chapter
Translate (DeepSeek, streamed)
  └─ [stable system prompt][matched glossary][chapter] ─► target language
  └─ memoized by sha256(content + glossary + model + prompt)
Reader (Svelte) ─ themes/typography/layout, TTS, mobile-responsive
```

## API (internal)

`POST /api/fetch` (optional `fromChapterId`+`dir` to place a fetched neighbor) ·
`POST /api/import/epub` · `POST /api/import/txt` (both accept an optional `bookId` to append into an
existing book) · `GET/POST/DELETE /api/books[/:id]` (`POST /api/books` creates an empty book) ·
`POST/PATCH /api/books/:id/chapters` (add a chapter / reorder) · `PATCH/DELETE /api/chapters/:uuid`
(rename·edit / delete) · `GET /api/chapter?id=` · `GET/POST /api/glossary` ·
`PUT/DELETE /api/glossary/:id` · `POST /api/glossary/import` ·
`GET /api/glossary/export?scope=global|book|effective` · `POST /api/extract` ·
`POST /api/translate` (SSE).

## Notes

-   The fetch layer is SSRF-hardened (DNS pinning, private-IP rejection, redirect re-validation) and
    self-healing: on a new host it asks DeepSeek to map the page's selectors once, then caches them.
-   Web sources are generic — any static, server-rendered novel site works (the classic Chinese hosts
    like `uukanshu.cc` are well covered); JS-rendered sites need Zyte.
-   Deployment runbook: [`DEPLOYMENT.md`](./DEPLOYMENT.md).
