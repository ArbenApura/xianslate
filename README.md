# Xianslate

A local-first web app that **fetches Chinese web novels, builds per-book & global glossaries,
and translates them to English** with DeepSeek — in a fast, fully customizable, mobile-responsive
reader. Built for consistent, glossary-pinned translations (names/terms stay stable across a
whole book) at minimal cost.

## Features

-   **Ingest from 3 sources**: paste a `uukanshu.cc` chapter URL, import an **EPUB**, or import a
    **TXT** (auto-split into chapters by headings).
-   **Library** of many books, each with its own glossary; resumes your last-read chapter.
-   **Glossary** with `raw` / `translation` / `gender` (neuter·masculine·feminine):
    -   **Per-book** and **global** scopes — a book term overrides a global term on the same `raw`.
    -   **CSV import / export** (`raw,translation,description`; gender derived from `#masculine` /
        `#feminine` tags). Bulk import is a single fast transaction.
    -   Auto **term extraction** from a chapter via DeepSeek, with gender.
-   **Translation** (DeepSeek, streaming):
    -   Injects **only the chapter-relevant glossary terms** via an Aho-Corasick scan (e.g. ~130 of
        7,000+), so prompts stay small, cheap, and on-topic — with gender-aware pronouns.
    -   **Memoized**: re-reading a translated chapter is instant and free; re-billed only if the text,
        matched glossary, model, or prompt changes.
    -   Prompts are ordered **stable-prefix-first** to maximize DeepSeek context-cache reuse.
    -   Live **token/cost meter**.
-   **Reader**: theme presets (light · sepia · dark · OLED · high-contrast), font family/size/weight,
    line-height, letter/paragraph spacing, measure width, alignment/indent; layout modes
    **side-by-side / interleaved / English-only / Chinese-only**; keyboard shortcuts; fully
    **mobile-responsive** (drawers become bottom sheets, panes stack).

## Tech stack

SvelteKit 2 (Svelte 4) · TypeScript · TailwindCSS · Vite · **libsql** (SQLite, WAL) + Drizzle ORM ·
DeepSeek via the OpenAI-compatible SDK · `node-html-parser` · `ahocorasick` · `papaparse` ·
`svelte-sonner`. Runs on `@sveltejs/adapter-node`.

> The DB layer is **libsql** (not `better-sqlite3`) so it needs **no native compiler** and is a
> drop-in path to a hosted Turso DB for the planned future online scale-out.

## Setup

Requires **Node 18+** and **Yarn**.

```bash
yarn install
cp .env.example .env      # then fill in DEEPSEEK_API_KEY
yarn db:push              # create the SQLite schema
yarn dev                  # http://localhost:5173
```

### Environment (`.env`)

| Var                 | Purpose                             | Default                    |
| ------------------- | ----------------------------------- | -------------------------- |
| `DEEPSEEK_API_KEY`  | DeepSeek API key (server-side only) | —                          |
| `DEEPSEEK_BASE_URL` | API base URL                        | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL`    | Model id                            | `deepseek-v4-flash`        |
| `DEEPSEEK_REASONING`| `enabled` allows the model's chain-of-thought; anything else disables it | `disabled` |
| `DATABASE_URL`      | libsql URL                          | `file:./xianslate.db`      |

Optional per-model price overrides (USD per 1M tokens) for the cost meter — these default to DeepSeek's
published Flash/Pro rates, override only to track price changes:
`DEEPSEEK_PRICE_FLASH_INPUT` / `_FLASH_CACHED` / `_FLASH_OUTPUT` (cache-miss input / cache-hit input / output)
and `DEEPSEEK_PRICE_PRO_INPUT` / `_PRO_CACHED` / `_PRO_OUTPUT`.

## Scripts

| Script                              | Does                                  |
| ----------------------------------- | ------------------------------------- |
| `yarn dev`                          | Dev server                            |
| `yarn build` / `yarn start`         | Production build / run (`node build`) |
| `yarn run check`                    | `svelte-check` type-check             |
| `yarn run lint` / `yarn run format` | Prettier + ESLint                     |
| `yarn db:push` / `yarn db:studio`   | Apply schema / open Drizzle Studio    |

## How it works

```
Ingest (web fetch / EPUB / TXT)
  └─ books + chapters (SQLite, cached)
Glossary (per-book ⊕ global → effective)
  └─ Aho-Corasick automaton ─► match only terms present in the chapter
Translate (DeepSeek, streamed)
  └─ [stable system prompt][matched glossary][chapter] ─► English
  └─ memoized by sha256(content + glossary + model + prompt)
Reader (Svelte) ─ themes/typography/layout, mobile-responsive
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

-   First web source supported is `uukanshu.cc` (Traditional Chinese). The fetcher sends a browser
    User-Agent and falls back to system `curl` when the host's bot check blocks Node's fetch.
-   Project context & decisions live under [`conductor/`](./conductor/).
