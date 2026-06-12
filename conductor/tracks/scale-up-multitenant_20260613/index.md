# Track: Multi-User Scale-Up & Cross-Platform Delivery

**ID:** scale-up-multitenant_20260613
**Status:** Pending (Phase 0 complete)

## Documents

-   [Specification](./spec.md)
-   [Implementation Plan](./plan.md)

## Progress

-   Phases: 1/8 complete (Phase 0 prerequisites done)
-   Tasks: 2/52 complete

## Phase Map

-   [x] Phase 0 — Completed prerequisites (`/app` refactor + DeepSeek pricing fix)
-   [x] Phase 1 — Decouple `/app` from server loads (SPA-ready)
-   [x] Phase 2 — PostgreSQL on Neon migration (code complete; live boot pending Neon provisioning)
-   [x] Phase 3 — Firebase authentication (code complete; live sign-in pending Firebase project)
-   [ ] Phase 4 — Per-user multi-tenancy & cost guardrail
-   [ ] Phase 5 — Redis/BullMQ queue + global DeepSeek cap
-   [ ] Phase 6 — Capacitor Android build
-   [ ] Phase 7 — Hosting & deployment + final verification

## Cross-Session References

-   `memory/scale-up-architecture-plan.md` — mirror of these decisions (spec wins on conflict)
-   Completed this session: `/app` route refactor, `src/lib/server/deepseek.ts` model-aware pricing

## Quick Links

-   [Back to Tracks](../../tracks.md)
-   [Product Context](../../product.md)
