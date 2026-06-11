# Specification: Xianslate MVP — Fetch, Glossary, Translate & Reader

**Track ID:** xianslate-mvp_20260611
**Type:** Feature
**Created:** 2026-06-11
**Status:** Approved

## Summary

Build the full Xianslate app: a local SvelteKit web app that ingests Chinese web-novel chapters
from multiple sources (**URL fetch, EPUB import, plain-text import**), maintains per-book and
global glossaries (with CSV import/export), translates chapters to English with DeepSeek using
only chapter-relevant glossary terms, and presents everything in a cutting-edge, fully
customizable, mobile-responsive reader.

## Context

English-speaking readers (and CN learners) want consistent, glossary-pinned translations of
Chinese web novels in a great reading experience. Machine translation is cheap but produces
inconsistent names/terms and clunky UX. This track delivers the end-to-end MVP described in the
build plan, prioritizing **fast · cheap · cache-optimized · high quality** (see
`conductor/product.md`). Full design lives at `C:\Users\Admin\.claude\plans\kind-marinating-bird.md`.

## User Story

As a reader of Chinese web novels, I want to paste a chapter URL and get a consistent, high-quality
English translation in a customizable reader — with names and terms pinned by a glossary I can
import/export — so that I can read entire novels comfortably and affordably.

## Acceptance Criteria

-   [ ] **Ingest — Web**: Add a book by URL and fetch a `uukanshu.cc` chapter showing the title,
        Traditional-Chinese content, and working **Prev / Index / Next** navigation (browser-UA,
        handles the 403-without-UA case).
-   [ ] **Ingest — EPUB**: Import a `.epub` file → parse its spine into ordered chapters (title +
        text per chapter); Prev/Next navigate by chapter order.
-   [ ] **Ingest — Text**: Import a `.txt` file → split into chapters by heading patterns
        (e.g. `第N章` / `Chapter N`); falls back to a single chapter if no headings; Prev/Next by order.
-   [ ] **Library**: Multiple books (from any source) coexist, each with its own glossary;
        reopening a book resumes the last-read chapter.
-   [ ] **Glossary schema** `raw` / `translation` / `gender` (neuter|masculine|feminine), with
        **per-book and global** scopes where a book entry overrides the global entry on the same
        `raw`.
-   [ ] **CSV import/export**: import the two provided ~7.4k-row files (gender derived from
        `#masculine`/`#feminine` tags), fast single-transaction upsert, re-import updates rather
        than duplicates; export round-trips (`raw,translation,description`).
-   [ ] **Term extraction**: auto-extract proper nouns with gender from a chapter and persist them.
-   [ ] **Translate**: streams English output, injects **only chapter-relevant** glossary terms
        (Aho-Corasick), uses correct gendered pronouns; re-translating an unchanged chapter is
        served from the memo cache ($0); DeepSeek `prompt_cache_hit_tokens` > 0 on later calls.
-   [ ] **Reader**: fully customizable (font family/size/weight, line-height, spacing, themes
        incl. OLED/sepia, side-by-side / interleaved / single-language, scroll/paginated, TOC,
        progress, TTS); settings persist; **mobile-responsive** (panes → tabs, drawers → bottom
        sheets, tap zones).
-   [ ] **Conventions**: code conforms to `conductor/code_styleguides/` (Tailwind-only, no
        `<style>`/CSS variables, `cn()`, `svelte-sonner`), `trailingSlash: 'always'`, and the
        project `.prettierrc`; `npm run format` and `npm run lint` pass.

## Dependencies

-   **Node.js + npm** with native build toolchain (better-sqlite3 compiles native bindings on
    Windows) — **currently NOT on PATH; must be installed before scaffolding.**
-   **DeepSeek API key** (provided) + reachable `https://api.deepseek.com`.
-   The two glossary CSVs in `C:\Users\Admin\Downloads\`.
-   External site `uukanshu.cc` reachable (for web ingestion).
-   EPUB/TXT parsing libraries (server-side unzip + OPF/NCX parse for EPUB).

## Out of Scope

-   Web source sites other than `uukanshu.cc` (parser is structured to add more later, but only
    this site is implemented now). EPUB/TXT import is source-agnostic.
-   PDF / other ingestion formats beyond EPUB and TXT.
-   Authentication / multi-user accounts.
-   Online hosting and Postgres migration (future scale-out; DB layer kept swappable only).
-   EPUB/PDF **export** of translations; native mobile apps.

## Technical Notes

-   SvelteKit 2 (Svelte 4) + Tailwind + TS + Vite; better-sqlite3 (WAL) + Drizzle; openai SDK →
    DeepSeek; node-html-parser + undici; aho-corasick; papaparse; p-queue; zod; svelte-sonner; cn().
-   Ingestion abstraction: a `source_type` of `'web' | 'epub' | 'txt'` on books; chapters carry a
    `seq` order. Web nav uses prev/next URLs; EPUB/TXT nav uses `seq`. EPUB parsed server-side via
    unzip + OPF spine / NCX; TXT split by chapter-heading regex.
-   Prompt ordering = stable system prefix → sorted matched glossary → chapter (maximizes DeepSeek
    prefix cache). Translation memoized by `sha256(contentHash+glossaryFingerprint+model+promptVersion)`.
-   API key server-side only. Reader theming via runtime-dynamic inline style + inheritance (no CSS
    variables, per style guide).

---

_Generated by Conductor. Review and edit as needed._
