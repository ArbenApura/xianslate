# Workflow — Xianslate

## TDD Policy

**Flexible.** Tests are recommended (not gated) and focused on the complex, breakage-prone
logic where they pay off most:

-   HTML fetcher/parser (uukanshu.cc selectors, nav-link resolution, ad stripping)
-   Aho-Corasick glossary matcher (longest-match, effective-glossary merge)
-   CSV import/export (gender derivation from `#tags`, round-trip fidelity)
-   Glossary precedence (book overrides global)
-   Translation cache-key fingerprinting

Trivial UI/glue code does not require tests before implementation.

## Commit Strategy

**Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, …).
Keep commits scoped and descriptive. (The `conventional-commit` skill can generate messages.)

## Code Review

**Required for non-trivial changes** — substantive logic (parsers, translation pipeline, DB
schema, glossary system) gets reviewed before merge. Trivial tweaks (copy, formatting, small
style fixes) may be self-reviewed.

## Verification Checkpoints

**At track completion.** Manual end-to-end verification is required once a track/feature is
complete (not per-task). Use the verification steps defined in the track's `plan.md` and the
build plan's verification section (fetch → import glossary → extract → translate → reader/mobile).

## Task Lifecycle

1. Create a track with `/conductor:new-track` (writes `spec.md` + `plan.md`).
2. Implement tasks/phases (tests for complex logic per the TDD policy above).
3. Commit per task using Conventional Commits.
4. Review non-trivial changes.
5. At track completion, run the manual verification checklist, then mark the track done in
   `tracks.md`.
