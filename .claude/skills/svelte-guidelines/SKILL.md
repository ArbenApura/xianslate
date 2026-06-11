---
name: svelte-guidelines
description: >
  Enforces strict coding conventions for Svelte (.svelte) and TypeScript (.ts) files. Covers:
  UPPERCASE comments (technical terms exempt), Tailwind-only styling (no inline styles except
  linear-gradient or runtime-dynamic values), NO style blocks or CSS variables, cn() for dynamic
  classes, border over outline, 5-theme system (light/sepia/dark/oled/contrast) styled with dark:
  variants plus the $settings.theme store for per-theme distinctions (THEME_CLASS at the root),
  arbitrary [#HEX] values for non-standard colors (never invent Tailwind color names), alt="" on
  all images, use:ripple on every clickable element (from $lib/actions/ripple),
  svelte-sonner toast for notifications, import groups in order (ASSETS, DEP-TYPES, TYPES, ENVS,
  CONSTANTS, DEP-MODULES, MODULES, DEP-COMPONENTS, COMPONENTS), section headers "// -- NAME -- //"
  in strict order (REQUIRED PROPS, OPTIONAL PROPS, DEBUGGING, TYPES, CONSTANTS, STATES, PERSISTED
  STORES, STORES, REACTIVE STATES, REACTIVE STATEMENTS, FUNCTIONS, SUBSCRIPTIONS, LIFECYCLES) with
  each section appearing at most once (no duplicates, order never rearranged), and full-file
  artifact output. Apply for ANY task touching Svelte or TypeScript — creating, editing,
  refactoring, or styling.
---

# Svelte Component Coding Guidelines

Every AI-assisted modification must follow these rules without exception.

---

## 1. COMMENTS
- All comments (script + template) must be **UPPERCASE**. Technical terms (variable/function/CSS/framework names) keep original casing.
- Template blocks: `<!-- LABEL -->`
- Any kept `style` attribute requires an explanatory uppercase comment.

```svelte
<!-- TIMELINE ITEMS -->   ✓        <!-- Timeline items -->   ✗
// FEATURE CARD DATA      ✓        // Feature card data      ✗
```

---

## 2. STYLING — TAILWIND ONLY

**Never** use `style=""` for anything a Tailwind class can express. **Never** add a `<style>` block. **No CSS variables** of any kind (component-scoped, `:global(:root)`, `:global(.dark)`).

Use arbitrary-value classes for one-off values: `text-[#2d7d7b]`, `w-[360px]`, `shadow-[0_2px_8px_rgba(0,0,0,0.1)]`.

**Non-standard colors:** If a color is not a default Tailwind palette color (e.g. `red-500`, `zinc-900`), always use `text-[#HEX]` / `bg-[#HEX]` etc. Never invent or guess a Tailwind color name mapping.

**Only 2 permitted `style` exceptions** (must include explanatory comment):
1. `linear-gradient()` with multiple color values
2. Runtime-dynamic per-item values (e.g. `item.color`)

```svelte
<!-- VERTICAL LINE — linear-gradient() WITH TWO COLORS CANNOT BE EXPRESSED AS A TAILWIND CLASS -->
<div style="background: linear-gradient(#2d7d7b, #4aa8a6);"></div>

<!-- BADGE COLOR IS DYNAMIC PER ITEM -->
<span style="background: {item.bgAlpha}; color: {item.color};">
```

### BORDER VS OUTLINE
Use `border-*` for all visible boundaries (buttons, inputs, cards, containers). Only use `outline` to suppress native rings (`outline-none` + `ring-*`) or for truly offset decorative strokes (rare — add comment).

---

## 3. THEMING
This app has **five themes** (`Theme` in `$lib/stores/settings`): `light` and `sepia` (light group); `dark`, `oled`, `contrast` (dark group). The `dark` class lives on `<html>` — set client-side by `applyThemeClass()` and at SSR by `src/hooks.server.ts` — so Tailwind `dark:` variants flip the **entire dark group at once**.

**Rules:**
- **Default to `dark:` variants.** `dark:` only splits the dark group vs the light group — it *cannot* tell `sepia` from `light`, nor `oled`/`contrast` from `dark`. Use it for the common two-state case.
- **Never re-declare page surface colours.** Per-theme background/foreground come from the `THEME_CLASS` map applied once at the layout root (`src/routes/+layout.svelte`); pages and panels inherit them. Only set a surface colour when a component legitimately needs its own (then prefer `THEME_CLASS[$settings.theme]`).
- **For per-theme distinctions beyond the binary**, read the store reactively — `$settings.theme === 'light' ? … : …` inside `cn()` — or use the `isDarkTheme(theme)` helper for a boolean. Never hard-code a theme list in a component; import from the store.
- **Theme hex values** use arbitrary classes (`bg-[#0e131c]`) or the centralised `THEME_CLASS` / `THEME_BG` maps — never a `<style>` block or CSS variable.

```svelte
// IMPORTED MODULES
import { settings, isDarkTheme } from '$lib/stores/settings';
import { cn } from '$lib/utils/cn';

<!-- TWO-STATE: dark: COVERS THE WHOLE DARK GROUP -->
<div class="border-black/[0.06] dark:border-white/[0.045]"></div>

<!-- PER-THEME: dark: CANNOT ISOLATE light, SO READ THE STORE -->
<header class={cn('backdrop-blur', $settings.theme === 'light' ? 'bg-white/70' : 'bg-black/20')}></header>

<!-- THEME-DEPENDENT GRADIENT — linear-gradient() CANNOT BE A dark: CLASS (SEE §2 STYLE EXCEPTION) -->
<div style="background: linear-gradient(to bottom, transparent, {isDarkTheme($settings.theme) ? '#0e131c' : '#f4ecd8'});"></div>
```

---

## 4. IMAGES
All `<img>` elements must have `alt=""` (empty string, no exceptions).

```svelte
<img src={photoUrl} alt="" class="h-full w-full object-cover" />     ✓
<img src={photoUrl} alt="photo" class="h-full w-full object-cover" />  ✗
```

---

## 5. INTERACTIVE FEEDBACK — RIPPLE
**Every clickable element must have a ripple effect.** Apply `use:ripple` to every button, icon button, link-styled-as-button, tab, menu item, selectable list row, and any element with an `on:click` activation. No bare clickable surfaces.

```svelte
// IMPORTED MODULES
import { ripple } from '$lib/actions/ripple';

<button class="rounded-md px-4 py-2" use:ripple>Save</button>
<a href="/library" class="rounded-md p-2" use:ripple aria-label="Library"><ArrowLeft size={18} /></a>
```

- The action lives at `$lib/actions/ripple` and self-injects its keyframes **once** into `<head>` — this is the only sanctioned runtime style injection; components themselves still never contain a `<style>` block (see §2).
- The default neutral grey reads on every theme. Override only when a surface needs it — e.g. a lighter fill on `oled`/`contrast`: `use:ripple={{ background: 'rgb(255,255,255)', opacity: 0.3 }}`.
- Toggle per-state via the option, don't strip the action: `use:ripple={{ disabled: isLoading }}`.
- Skip ripple only on non-interactive elements (plain text, static containers) and native form controls that can't host child nodes (`<input>`, `<select>`, `<textarea>`).

---

## 6. DYNAMIC CLASSES — `cn()` ONLY
Never use template-literal interpolation. Never construct class name fragments at runtime (`'text-' + color`, `` `bg-${size}` ``). All Tailwind class names must be complete literal strings.

```svelte
<div class={cn('flex flex-col', $isMobileView ? 'px-4' : 'px-6')}>  ✓
<div class="flex flex-col {$isMobileView ? 'px-4' : 'px-6'}">        ✗
```

---

## 7. SCRIPT STRUCTURE

### Import groups — in this order, no blank lines within block:

| # | Label | Contents |
|---|---|---|
| 1 | `// IMPORTED ASSETS` | Images, SVGs, fonts, static assets |
| 2 | `// IMPORTED DEP-TYPES` | `import type` from npm |
| 3 | `// IMPORTED TYPES` | `import type` from internal |
| 4 | `// IMPORTED ENVS` | `$env/...` |
| 5 | `// IMPORTED CONSTANTS` | Constant-only named imports |
| 6 | `// IMPORTED DEP-MODULES` | Runtime imports from npm |
| 7 | `// IMPORTED MODULES` | Runtime imports from internal/relative |
| 8 | `// IMPORTED DEP-COMPONENTS` | Svelte components from npm |
| 9 | `// IMPORTED COMPONENTS` | Svelte components from internal |

```typescript
// IMPORTED DEP-MODULES
import { updateProfile } from 'firebase/auth';
import { writable } from 'svelte/store';
// IMPORTED MODULES
import { cn } from '$lib/utils';
// IMPORTED COMPONENTS
import Avatar from '$lib/components/Avatar.svelte';
```

### Section headers — format `// -- NAME -- //`, one blank line below, one blank line between items:

**Rules (strictly enforced):**
- Each section header may appear **at most once** — no duplicates ever.
- Sections must appear in **exactly this order** — never rearranged, never out of sequence.
- **Omit** any section that has no content — do not include empty sections.
- Never split a section's content across multiple blocks under the same header.

| # | Section | Contents |
|---|---|---|
| 1 | `// -- REQUIRED PROPS -- //` | `export let` with no default |
| 2 | `// -- OPTIONAL PROPS -- //` | `export let` with default |
| 3 | `// -- DEBUGGING -- //` | `FILE_PATH` and debug-only constants |
| 4 | `// -- TYPES -- //` | `type` / `interface` declarations |
| 5 | `// -- CONSTANTS -- //` | Immutable module-level `const` |
| 6 | `// -- STATES -- //` | Mutable local `let` variables |
| 7 | `// -- PERSISTED STORES -- //` | `persisted()` stores |
| 8 | `// -- STORES -- //` | `writable`, `readable`, `derived` |
| 9 | `// -- REACTIVE STATES -- //` | `$:` assignments |
| 10 | `// -- REACTIVE STATEMENTS -- //` | `$:` side-effect statements |
| 11 | `// -- FUNCTIONS -- //` | All function declarations |
| 12 | `// -- SUBSCRIPTIONS -- //` | Store subscriptions |
| 13 | `// -- LIFECYCLES -- //` | `onMount`, `onDestroy`, etc. |

**Example of correct usage** (only sections with content are included, in order):
```typescript
// -- TYPES -- //

type CardVariant = 'default' | 'outlined';

// -- CONSTANTS -- //

const MAX_ITEMS = 50;

// -- STATES -- //

let isOpen = false;
let count = 0;

// -- FUNCTIONS -- //

function toggle() { isOpen = !isOpen; }

// -- LIFECYCLES -- //

onMount(() => { /* ... */ });
```

**Common violations to avoid:**
```typescript
// -- STATES -- //
let x = 0;
// -- CONSTANTS -- //   ✗ WRONG ORDER — CONSTANTS must come before STATES
const Y = 10;

// -- FUNCTIONS -- //
function a() {}
// -- FUNCTIONS -- //   ✗ DUPLICATE — merge all functions under one header
function b() {}
```

---

## 8. NOTIFICATIONS
Use `svelte-sonner` toast unless a custom notification system already exists in the codebase (prefer consistency).

```typescript
import { toast } from 'svelte-sonner';

toast.success('Profile saved');
toast.error('Something went wrong');

// toast.promise IS FIRE-AND-FORMAT — DOES NOT RETURN A PROMISE, DO NOT AWAIT IT
// CORRECT PATTERN: ASSIGN AS ARROW FUNCTION EVENT HANDLER
const handleSubmit = () => toast.promise(saveProfile(data), { loading: 'Saving...', success: 'Saved!', error: 'Failed' });
```

**Toast messages must be user-friendly** — clear, human, and specific to the action. Avoid generic or technical wording.

| ✗ Bad | ✓ Good |
|---|---|
| `'Error'` | `'Couldn't save your profile. Try again.'` |
| `'Success'` | `'Profile updated!'` |
| `'Loading'` | `'Saving your changes...'` |
| `'Failed to fetch'` | `'Unable to load posts. Check your connection.'` |
| `'Done'` | `'Message sent!'` |

---

## 9. TEMPLATE COMMENTS
Label every major template block with uppercase HTML comments. Note mobile/desktop context when relevant.

```svelte
<!-- TOP SECTION: STACKED ON MOBILE, SIDE-BY-SIDE ON DESKTOP -->
<!-- GHOST PLACEHOLDER ITEM (SHOWN AT BOTTOM OF TIMELINE AS A TEASER) -->
```

---

## 10. STRUCTURE EFFICIENCY
Before outputting, audit the markup and script for redundancy. Collapse repeated wrappers, remove unnecessary nesting, and simplify where possible. Prefer fewer elements with well-composed Tailwind classes over deeply nested structures.

---

## CHECKLIST
- [ ] All comments UPPERCASE (technical terms exempt)
- [ ] Imports: correct group labels in order, no blank lines within import block, omit unused groups
- [ ] Section headers: `// -- NAME -- //` format, **strict order** (1–13), **each appears at most once** (no duplicates), one blank line below header, one blank line between items, omit unused
- [ ] No `style=""` where Tailwind works; every kept `style` has explanatory comment
- [ ] `border` for all visible boundaries; `outline` only for offset decorative strokes or `outline-none` + `ring-*`
- [ ] No `<style>` block in any component — zero exceptions (the `ripple` action's one-time `<head>` injection is the sole sanctioned runtime styling)
- [ ] No CSS variables of any kind
- [ ] Theming: `dark:` for the two-state case, `$settings.theme` / `isDarkTheme()` for per-theme distinctions; never re-declare root surface colours or hard-code theme lists
- [ ] Non-standard colors use arbitrary syntax `bg-[#HEX]`, `text-[#HEX]` — never invent Tailwind color names
- [ ] All `<img>` have `alt=""`
- [ ] Every clickable element has `use:ripple` (from `$lib/actions/ripple`); disable via `{{ disabled }}`, never by removing the action
- [ ] One-off values use arbitrary Tailwind syntax: `bg-[#hex]`, `text-[13px]`
- [ ] Dynamic classes use `cn()` — no template-literal interpolation, no fragment construction
- [ ] Notifications use `svelte-sonner` toast (unless custom system exists)
- [ ] Structure is efficient — no redundant nesting, collapsed where possible
