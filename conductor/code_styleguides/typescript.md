# TypeScript / JavaScript Style Guide — Xianslate

Source of truth for formatting is the project **`.prettierrc`** (tabs, width 4, single quotes,
`trailingComma: all`, `printWidth: 120`, `arrowParens: always`, plugins
`prettier-plugin-svelte` + `prettier-plugin-tailwindcss`, `tailwindFunctions: [cn, tv, clsx, cva]`)
plus **ESLint**. Svelte-component conventions (comments, styling, import groups, section
headers, `cn()`, toasts, etc.) are defined in **[svelte.md](./svelte.md)** and are mandatory.
This file captures TypeScript conventions those don't cover.

## General TypeScript

-   **`strict: true`.** No implicit `any`; prefer precise types and discriminated unions over
    loose objects. Avoid `as` casts except at trusted boundaries (parsed CSV/JSON, env).
-   Prefer `type` aliases for data shapes; `interface` only when declaration-merging is needed.
-   Use `const` by default; `let` only when reassigned. No `var`.
-   Model absence explicitly (`T | null`), and validate external input with **zod** at the edge
    (endpoint bodies, query params, CSV rows) — return typed data inward.
-   Errors: throw `Error` (or a small typed subclass) with actionable messages; never swallow.
-   No default exports for modules with multiple symbols; prefer named exports. Components may
    default-export (Svelte convention).
-   Async: prefer `async/await`; bound concurrency with `p-queue` rather than unbounded
    `Promise.all` over large arrays.

## Naming

-   `camelCase` for variables/functions, `PascalCase` for types and Svelte components,
    `SCREAMING_SNAKE_CASE` for true constants/env keys.
-   Files: `kebab-case.ts` for modules (`glossary-match.ts`), `PascalCase.svelte` for components.
-   DB columns in schema mirror the domain (`raw`, `translation`, `gender`, `bookId`).

## Project structure conventions

-   Server-only code lives under `src/lib/server/**` (never import into client components).
-   Endpoints are thin: validate → call a `src/lib/server` module → shape the response.
    Business logic belongs in the server modules, not in `+server.ts`.
-   Shared types in `src/lib/types.ts`; persisted stores in `src/lib/stores/`.

## Routing (SvelteKit)

-   **`export const trailingSlash = 'always';`** — set in `src/routes/+layout.ts` (or
    `+layout.server.ts`) so it applies to all routes. Internal links and `fetch` calls use
    trailing slashes accordingly.

## Svelte

-   See **[svelte.md](./svelte.md)** for the full, mandatory component rules. In brief:
    `<script lang="ts">`, `export let x: T;` props (Svelte 4), Tailwind-only styling, **no CSS
    variables / no `<style>`**, `cn()` for dynamic classes, UPPERCASE comments, strict import
    groups + `// -- NAME -- //` section headers, `svelte-sonner` toasts.
-   Reactive `$:` for derivations; avoid side effects beyond state updates in reactive blocks.
-   Cross-component state via small, typed stores (settings, reader, library). Persisted stores
    wrap `localStorage` with SSR-safe guards (`browser` check).
-   **Reader theming**: runtime-dynamic inline `style` on the reader root + CSS inheritance;
    presets via `dark:`/class toggling — never CSS custom properties (per svelte.md §2).
-   Accessibility is not optional: semantic elements, labels for controls, focus states,
    `aria-*` on custom widgets, ≥44px touch targets.

## Comments

-   Comment the _why_, not the _what_. Document non-obvious decisions (e.g. why longest-match,
    why the prompt prefix ordering matters for caching).

## Testing (per workflow.md — complex logic)

-   Co-locate unit tests as `*.test.ts`. Test pure logic directly (parser, matcher, CSV,
    precedence, cache key). Use fixtures of real fetched HTML/CSV snippets.
