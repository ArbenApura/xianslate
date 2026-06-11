# Svelte Component Style Guide — Xianslate

Adopted from the `unistar-monorepo` `svelte-guidelines` skill. These rules apply to **every**
`.svelte` and `.ts` file without exception. (TypeScript-specific conventions: see
[typescript.md](./typescript.md).)

## 1. Comments

-   All comments (script + template) are **UPPERCASE**. Technical terms (variable/function/CSS/
    framework names) keep their original casing.
-   Template blocks labelled with `<!-- LABEL -->`. Note mobile/desktop context when relevant
    (e.g. `<!-- READER PANES: TABBED ON MOBILE, SIDE-BY-SIDE ON DESKTOP -->`).
-   Any kept `style` attribute requires an explanatory UPPERCASE comment.

## 2. Styling — Tailwind only

-   **Never** use `style=""` for anything a Tailwind class can express. **Never** add a `<style>`
    block. **No CSS variables** of any kind (component-scoped, `:global(:root)`, `:global(.dark)`).
-   One-off / non-standard values use arbitrary classes: `text-[#2d7d7b]`, `w-[360px]`,
    `text-[19px]`, `shadow-[0_2px_8px_rgba(0,0,0,0.1)]`.
-   Non-standard colors: always `text-[#HEX]` / `bg-[#HEX]` — never invent a Tailwind color name.
-   **Only 2 permitted `style` exceptions** (each needs an explanatory comment):
    1. `linear-gradient()` with multiple colors.
    2. **Runtime-dynamic per-item values** (e.g. `item.color`).

> **Reader theming (project-specific application):** user-chosen reader settings (font family,
> size, weight, line-height, letter-spacing, custom colors, measure/width) are **runtime-dynamic
> values** → set them via a single inline `style` on the reader root (with an UPPERCASE comment)
> and rely on **CSS inheritance** for child text. Theme _presets_ (light/sepia/dark/OLED) toggle
> a class and use Tailwind `dark:` variants. **Do not** introduce CSS custom properties or a
> `<style>` block to achieve theming.

### Border vs outline

Use `border-*` for all visible boundaries (buttons, inputs, cards, containers). Use `outline`
only to suppress native rings (`outline-none` + `ring-*`) or rare offset decorative strokes.

## 3. Dark mode

Prefer Tailwind `dark:` variants. Import an `isDark` store only when `dark:` cannot express the
value (e.g. a theme-dependent gradient).

## 4. Snippets

Extract into `{#snippet}` only when markup is **both complex and highly reused** (non-trivial,
3+ lines with logic/nesting, and appears 3+ times). Otherwise inline it.

## 5. Images

Network `<img>` use `use:imgLoad`; **all** `<img>` have `alt=""` (empty string).

## 6. Dynamic classes — `cn()` only

Never interpolate class strings or build fragments at runtime (`'text-' + c`, `` `bg-${s}` ``).
All Tailwind class names are complete literal strings; compose conditionals with `cn()`.

```svelte
<div class={cn('flex flex-col', isMobile ? 'px-4' : 'px-6')}>  ✓
<div class="flex flex-col {isMobile ? 'px-4' : 'px-6'}">        ✗
```

## 7. Script structure

**Import groups** — in this order, no blank lines within the block, omit unused groups:
`// IMPORTED ASSETS` → `DEP-TYPES` → `TYPES` → `ENVS` → `CONSTANTS` → `DEP-MODULES` →
`MODULES` → `DEP-COMPONENTS` → `COMPONENTS`.

**Section headers** — format `// -- NAME -- //`, one blank line below, one blank line between
items. Each header appears **at most once**, in **exactly this order**, omit empty sections:
`REQUIRED PROPS` → `OPTIONAL PROPS` → `DEBUGGING` → `TYPES` → `CONSTANTS` → `STATES` →
`PERSISTED STORES` → `STORES` → `REACTIVE STATES` → `REACTIVE STATEMENTS` → `FUNCTIONS` →
`SUBSCRIPTIONS` → `LIFECYCLES`.

## 8. Notifications

Use `svelte-sonner` `toast` for notifications. Messages must be user-friendly and specific
("Couldn't load the chapter. Check the URL.") — never `'Error'` / `'Done'`. `toast.promise` is
fire-and-format (do not await); assign as an arrow-function handler.

## 9. Structure efficiency

Audit markup/script for redundancy before finishing. Collapse repeated wrappers, remove
unnecessary nesting, prefer fewer elements with well-composed Tailwind classes.

## Checklist

-   [ ] Comments UPPERCASE (technical terms exempt); kept `style` has explanatory comment
-   [ ] Tailwind-only; no `<style>`; **no CSS variables**; arbitrary `[#HEX]`/`[19px]` for one-offs
-   [ ] Reader settings via runtime-dynamic inline style + inheritance; presets via `dark:`/class
-   [ ] `border` for boundaries; `cn()` for dynamic classes (no interpolation)
-   [ ] Import groups + `// -- NAME -- //` sections in strict order, no duplicates, omit empty
-   [ ] Network `<img>` `use:imgLoad`; all `<img>` `alt=""`
-   [ ] `svelte-sonner` toasts, user-friendly copy
-   [ ] Snippets only for complex + highly-reused markup; structure is efficient
