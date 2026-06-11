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
    **@sveltejs/adapter-node**. All fetching, LLM calls, DB access, and the API key live
    server-side.
-   **Routing convention:** `export const trailingSlash = 'always';` in the root `+layout.ts`.

## Database

-   **SQLite** via **better-sqlite3** (sync driver), opened in **WAL mode**
    (`journal_mode=WAL`, `synchronous=NORMAL`) with prepared statements.
-   **Drizzle ORM** + **drizzle-kit** for schema/migrations.
-   DB layer kept swappable — Drizzle dialect can move SQLite → Postgres for the future online
    scale-out without rewriting query code.

## External Services

-   **DeepSeek** (OpenAI-compatible API) via the **openai** SDK pointed at
    `https://api.deepseek.com`. Default model `deepseek-v4-flash` (configurable via `.env`).
    Relies on DeepSeek automatic prefix (KV) caching — prompts are ordered stable-prefix-first.

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

## Tooling

-   **Prettier** — project `.prettierrc` (adopted from `unistar-monorepo`): **tabs**, `tabWidth: 4`,
    `singleQuote`, `trailingComma: all`, `printWidth: 120`, `arrowParens: always`, plugins
    `prettier-plugin-svelte` + `prettier-plugin-tailwindcss`, `tailwindFunctions: [cn, tv, clsx, cva]`.
-   **ESLint** for linting.
-   **Code style:** Svelte/TS conventions in `conductor/code_styleguides/` (Tailwind-only,
    no `<style>` / no CSS variables, `cn()` for dynamic classes, UPPERCASE comments, strict import
    groups + section headers) — adopted from the `unistar-monorepo` `svelte-guidelines` skill.

## Infrastructure

-   **Now:** local / self-hosted via `adapter-node` (`npm run dev` or built Node server); SQLite
    file on disk; local-first.
-   **Future:** scale online — anticipated path is containerize (Docker) + migrate the DB layer
    to Postgres; keep secrets server-side and stateless-friendly.
