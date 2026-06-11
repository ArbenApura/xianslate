# Product Guidelines — Xianslate

## Voice and Tone

**Concise and direct.** UI labels and documentation are minimal and no-fluff. Prefer short,
plain verbs ("Fetch", "Translate", "Import CSV") over decorative copy. Error messages state
what happened and what to do next.

## Design Principles

1. **Performance first** — instant, no-layout-shift interactions; stream long work; cache
   everything that can be cached; never block the reader on a network call when a cached result
   exists.
2. **Exceptional reading UX** — the reader is the product. Fully customizable typography, themes,
   and layout; mobile-responsive and accessible (WCAG AA contrast, keyboard + touch, respects
   `prefers-color-scheme` / `prefers-reduced-motion`).
3. **Reliable, consistent translations** — glossary-pinned terminology and gender-aware pronouns
   keep names and terms stable across an entire book.

## Standards

-   Reader settings apply instantly via CSS custom properties; no full re-render.
-   Costs are transparent: surface token usage and DeepSeek cache-hit rate in the UI.
-   Secrets (API keys) stay server-side and never reach the client bundle.
