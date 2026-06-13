# Xianslate — UI/UX Design Review

_A professional design audit of the whole app: every surface critiqued, prioritized, with concrete fixes. Responsive (wide + mobile) considered throughout. The "Implemented this pass" section records what actually changed._

---

## TL;DR

Xianslate is a **genuinely well-built reader** — sophisticated reader chrome, immersive auto-hiding mobile bars, thoughtful empty/loading states, a real keyboard layer, portaled popovers that dodge clipping, safe-area handling, and a 5-theme system. The bones are excellent. The gaps are **polish and consistency**, not architecture.

The single most important finding:

> **The 5-theme system was only half-applied.** The _page_ honored all five themes (light / sepia / dark / oled / contrast), but the _overlays_ (modals, dropdowns, sheets, the TTS bar) collapsed to a hardcoded `white` / `slate-900` plane. Because **sepia is the default theme**, the out-of-the-box experience was warm-cream pages interrupted by cold-white modals. That breaks immersion in the exact place a reading app must protect it. **Fixed this pass.**

Everything else is smaller: a generic landing page, plain auth screens, a few consistency slips (raw buttons vs the `Button` component, two different input border weights, `sky-600` vs `sky-700` hovers), and weak keyboard-focus visibility.

---

## How the design system works (so fixes stay consistent)

-   **Surfaces** come from `THEME_CLASS` / `THEME_BG` in `src/lib/stores/settings.ts`, applied once at the layout root. Pages inherit; don't re-declare them.
-   **Two kinds of tint:**
    -   _Translucent_ tints — `bg-black/[0.02]`, `dark:bg-white/[0.02]`, `border-black/[0.06]`, `bg-current/5` — **layer over the theme background and adapt automatically.** Correct; keep.
    -   _Opaque_ neutrals — `bg-white`, `dark:bg-slate-800/900`, `text-slate-700/900`, `border-slate-200/700` — **do not adapt.** The real problem, and almost entirely in overlays (which legitimately need an opaque surface you can't see through).
-   **Text hierarchy** is `opacity-*` over the inherited foreground — theme-safe, _except_ where components hardcode `text-slate-500 dark:text-slate-400` as "muted" (grey-on-cream in sepia).
-   **Accent** is `sky-600`/`sky-500`. A single brand accent across all five reading themes is a legitimate choice — I am **not** re-coloring the accent per theme. Only the **neutral surfaces** were made theme-aware.

Guideline already anticipated the fix: _"Only set a surface colour when a component legitimately needs its own (then prefer `THEME_CLASS[$settings.theme]`)."_

---

## Priority 1 — Theme-aware overlays ✅ done

**Was:** opaque `white`/`slate` surfaces in `Modal`, `ConfirmDialog`, `Select` dropdown, `ActionMenu`, `AccountMenu`, `LanguagePicker` popover, `TocDrawer`, `TtsBar`, plus `surface="bg-white dark:bg-slate-900"` passed into `GlossaryPanel`.

**Now:** three centralized maps in `settings.ts` — `THEME_PANEL` (modals/sheets), `THEME_POPOVER` (dropdowns, one elevation up), `THEME_PANEL_BORDER` — each an _opaque_ surface that sits one step above its theme's page background, with correct text and a border that's bright on `contrast`. Every overlay now reads `THEME_PANEL/POPOVER[$settings.theme]`. Sepia overlays are warm, oled overlays are near-black, contrast overlays gain a crisp white edge — elevation and immersion preserved on all five.

---

## Priority 2 — Landing page (`/`) ✅ done

Richer hero (layered ambient glow, refined eyebrow, dual CTA), a quick-facts strip, a 3-step "how it works", feature cards with accent-tinted icon tiles + hover lift, a closing CTA, and a real multi-column footer. Theme-inheriting, fully responsive.

## Priority 3 — Auth (`/login`, `/signup`, `/verify-email`) ✅ done

Real multi-color Google "G" mark, unified fields with visible focus rings (`focus:ring`), warmer/elevated card with logo glow, trust microcopy. Surfaces stay translucent + `dark:`-driven (no `$settings`) to avoid an SSR theme flash on these server-rendered pages.

## Priority 4 — Consistency micro-fixes ◑ partial

-   Library "Add book" CTA hover unified to `hover:bg-sky-500` (matches the `Button` component; was `sky-700`).
-   Library search + shared `TextField` gained `focus:ring-2 focus:ring-sky-500/30` for keyboard a11y.

---

## Per-surface notes

-   **Library (`/app`)** — Strong. "Continue reading" hero + gradient-cover shelf is excellent. Remaining nit: the header CTA and search are still hand-rolled (could adopt `Button`/`TextField`).
-   **Reader** — The crown jewel; auto-hiding chrome, thumb bar, segmented view-mode, prefetch, scroll-restore, TTS word highlighting. Minimal changes needed.
-   **Manage / Glossary / Stats** — Solid responsive tables (`sm:contents` reflow). Drag-handle / move buttons are sub-44px tap targets on mobile (recommended next).
-   **Admin** — Internal; repeated `MUTED = text-slate-500 dark:text-slate-400` is the one theme-breaker; status badges hardcode color pairs (acceptable for a dashboard).
-   **Components** — `Skeleton`, `RangeField` accent, `SpokenParagraph` highlights, `TranslationStatus` are sky/`bg-current/10` based; fine. `SelectField` hardcodes native `<option>` bg (OS-limited; low impact).

---

## Responsive (wide + mobile)

Generally very good: reader drops bilingual on phones → stacked; modals are bottom-sheets on mobile, centered cards on desktop; safe-area insets handled. Gaps: a few sub-44px tap targets; weak keyboard-focus visibility (partly addressed); desktop reader action row is icon-dense.

## Accessibility quick list

-   Add `focus-visible:ring` to segmented controls + reader icon buttons (forms now covered).
-   44px min touch targets on manage handles.
-   `alt=""` and `use:ripple` discipline already strong.

## Recommended next

1. Tap-target + focus-ring sweep on manage/admin.
2. Replace admin `MUTED` slate constants with opacity-based muted text.
3. Optionally adopt `Button`/`TextField` in the library header for full consistency.

---

## Implemented this pass

-   `src/lib/stores/settings.ts` — added `THEME_PANEL`, `THEME_POPOVER`, `THEME_PANEL_BORDER` maps.
-   Overlays now theme-aware: `Modal`, `ConfirmDialog`, `Select`, `ActionMenu`, `AccountMenu`, `LanguagePicker`, `TocDrawer`, `TtsBar`; `GlossaryPanel` call-sites (reader + manage) pass `THEME_PANEL[$settings.theme]`.
-   `src/routes/+page.svelte` — landing redesign.
-   `src/routes/login|signup|verify-email/+page.svelte` — auth polish + Google mark + focus rings.
-   `src/routes/app/+page.svelte` — CTA hover + search focus ring.
-   `src/lib/components/ui/TextField.svelte` — focus ring.

> ⚠️ Note: during this session an editor/commit event repeatedly reverted uncommitted edits to open files. The work was re-applied and committed to the `refactor/svelte-guidelines` branch so it survives. If a file looks un-changed in your editor, reload it from disk.
