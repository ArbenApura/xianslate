# Product Definition — Xianslate

## Description

A local web app that fetches web novels in any supported language, builds a per-book and global
glossary, and translates them with DeepSeek — wrapped in a cutting-edge, fully customizable,
mobile-responsive reader. The translation direction is per-book data (source + target language),
not a fixed Chinese→English assumption.

## Problem Statement

Machine-translated Chinese web novels suffer from inconsistent names and terms across chapters
and a clunky reading experience. Readers want translations where proper nouns, cultivation
terms, and characters stay consistent — presented in a reader that's pleasant to use.

## Target Users

English-speaking readers of Chinese web novels, plus Chinese-language learners who use the
bilingual side-by-side view and glossaries to study.

## Key Goals

1. **Glossary-consistent, high-quality translations** — names/terms pinned across chapters,
   gender-aware pronouns.
2. **Minimal cost** — aggressive caching, translation memoization, and relevant-term-only
   glossary injection (Aho-Corasick) keep token spend low.
3. **A blazing-fast, fully customizable, mobile-responsive reader** — instant theme/font/layout
   changes, streaming translation, next-chapter prefetch.

## Scope Notes

-   Languages are data, defined in `src/lib/languages.ts` (code, script, romanization, charset hints,
    Accept-Language, TTS tag, reading speed). Initial set: Traditional/Simplified Chinese, Japanese,
    Korean, English. Each book stores its own `sourceLang` + `targetLang`; a global default seeds new books.
-   Prompts, source-script-leak repair, fetch charset/Accept-Language, fonts, TTS, and reading-time all
    derive their behaviour from the book's language pair rather than a hardcoded Chinese→English direction.
-   First supported source site: `uukanshu.cc` (fetch title, content, prev/next/index links).
-   Glossary supports CSV import/export; term schema is `source`, `target`, `gender`
    (neuter | masculine | feminine) plus `sourceLang`/`targetLang`, with per-book and global scopes (book
    overrides global; global is partitioned per language pair). Legacy `raw`/`translation` CSV headers still import.
