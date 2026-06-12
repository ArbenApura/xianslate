# Tech Stack — Xianslate

## Languages

-   **TypeScript** (strict) — the only application language; Svelte components use TS.

## Frontend

-   **SvelteKit 2** with **Svelte 4**
-   **TailwindCSS** (mobile-first; design tokens via CSS custom properties for instant theming)
-   **Vite** (bundler, dev server)
-   Self-hosted webfonts via **@fontsource** (Latin reading faces + OpenDyslexic; CJK faces
    Noto Serif/Sans TC, LXGW WenKai for the source pane) — offline, no layout shift

## Backend

-   **SvelteKit server endpoints** (`+server.ts`) running on **Node** via
    **@sveltejs/adapter-node** (web build). All fetching, LLM calls, DB access, and secrets live
    server-side.
-   **Routing convention:** `export const trailingSlash = 'always';` in the root `+layout.ts`.
-   **Auth:** **Firebase** (Email/Password + Google) — `firebase` web SDK on the client,
    `firebase-admin` on the server. Web uses a httpOnly **session cookie** (same-origin); native uses
    an `Authorization: Bearer` **ID token**. `hooks.server.ts` populates `event.locals.user` and
    guards `/app`, `/admin`, `/api`.
-   **Translation jobs:** a **Redis-backed BullMQ** queue + Redis pub/sub for SSE replay and
    cross-instance cache invalidation, **gated on `REDIS_URL`**. Unset → an in-memory single-instance
    bridge (the original per-process path) so the app runs without Redis too.

## Database

-   **PostgreSQL** (managed by **Neon**) via **postgres.js** (`postgres`) + **Drizzle ORM**
    (`drizzle-orm/pg-core`). Three connection roles: `dbWrite` (pooled primary, `prepare:false`),
    `dbRead` (replica endpoint), and a direct-endpoint `migrator` (in `db/migrate.ts`).
-   ms-epoch timestamps stay `bigint({mode:'number'})` (not `timestamptz`) so `Date.now()` + stat math
    are unchanged; `bigserial` PKs; native `uuid`; partial unique indexes for the glossary scopes.
-   **drizzle-kit** generates SQL migrations (`drizzle/`), applied via `npm run db:migrate` (no
    interactive `db:push`). (Migrated from the original local SQLite/libsql layer.)

## External Services

-   **DeepSeek** (OpenAI-compatible API) via the **openai** SDK pointed at
    `https://api.deepseek.com`. Default model `deepseek-v4-flash` (configurable via `.env`).
    Relies on DeepSeek automatic prefix (KV) caching — prompts are ordered stable-prefix-first.
    The global concurrency cap is the BullMQ worker concurrency (runtime-adjustable via Redis) when
    Redis is configured; a per-process `PQueue` otherwise.
-   **Neon** (Postgres), **Upstash** (or other) **Redis**, **Firebase** (auth), **Cloudflare**
    (edge + R2), **Fly.io** (Node host) — see `DEPLOYMENT.md`.

## Key Dependencies

-   `node-html-parser` + `undici` — fast chapter fetch + parse (uukanshu.cc selectors).
-   `aho-corasick` — match only chapter-relevant glossary terms (out of ~7k) for cheap, focused
    prompts.
-   `papaparse` — robust glossary CSV import/export.
-   `p-queue` — bounded concurrency for prefetch / batch translate.
-   `zod` — request validation in endpoints.
-   `clsx` (or `tailwind-merge`) exposed as **`cn()`** — the only allowed way to compose dynamic
    Tailwind classes (per the Svelte style guide).
-   `svelte-sonner` — toast notifications.
-   `postgres` (postgres.js) — Postgres driver; `firebase` + `firebase-admin` — auth; `bullmq` +
    `ioredis` — the translation queue + pub/sub; `@capacitor/{core,cli,android}` +
    `@capacitor-firebase/authentication` — the Android build + native sign-in;
    `@sveltejs/adapter-static` — the Capacitor SPA build.

## Tooling

-   **Prettier** — project `.prettierrc` (adopted from `unistar-monorepo`): **tabs**, `tabWidth: 4`,
    `singleQuote`, `trailingComma: all`, `printWidth: 120`, `arrowParens: always`, plugins
    `prettier-plugin-svelte` + `prettier-plugin-tailwindcss`, `tailwindFunctions: [cn, tv, clsx, cva]`.
-   **ESLint** for linting.
-   **Code style:** Svelte/TS conventions in `conductor/code_styleguides/` (Tailwind-only,
    no `<style>` / no CSS variables, `cn()` for dynamic classes, UPPERCASE comments, strict import
    groups + section headers) — adopted from the `unistar-monorepo` `svelte-guidelines` skill.

## Infrastructure

-   **Online (multi-tenant):** single **Cloudflare** origin `xianslate.com` fronting a **Fly.io** Node
    app (`web` + `translation-worker` process groups from one `Dockerfile`), **Neon** Postgres,
    **Upstash** Redis, **Firebase** auth, **R2** for future cover proxying. Stateless web tier scales
    horizontally. See `DEPLOYMENT.md` for the runbook + provisioning.
-   **Android:** a **Capacitor** static-SPA build (`BUILD_TARGET=capacitor`, `adapter-static`) ships
    only `/app` against `https://xianslate.com/api` with a bearer token.
-   **Local / single-instance:** still runs via `adapter-node` with `REDIS_URL` unset (in-memory
    translation bridge) — the original local-first path remains intact.
