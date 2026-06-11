# Product Definition — Xianslate

## Description

A local web app that fetches Chinese web novels, builds a per-book and global glossary, and
translates them to English with DeepSeek — wrapped in a cutting-edge, fully customizable,
mobile-responsive reader.

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

-   Source language: Traditional Chinese (xianxia/xuanhuan); target: English.
-   First supported source site: `uukanshu.cc` (fetch title, content, prev/next/index links).
-   Glossary supports CSV import/export; term schema is `raw`, `translation`, `gender`
    (neuter | masculine | feminine), with per-book and global scopes (book overrides global).
