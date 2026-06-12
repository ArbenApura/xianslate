# Track: Multi-User Scale-Up & Cross-Platform Delivery

**ID:** scale-up-multitenant_20260613
**Status:** Implementation complete (Phases 0–7; `check`/`lint`/`build` green). Live E2E + external
provisioning (Neon/Firebase/Redis/Fly/Cloudflare/Android SDK) pending — see [DEPLOYMENT.md](../../../DEPLOYMENT.md).

## Documents

-   [Specification](./spec.md)
-   [Implementation Plan](./plan.md)

## Progress

-   Phases: 8/8 code-complete (live E2E pending external provisioning)
-   Tasks: 50/52 (the 2 open are pure operator provisioning — Neon 2.1, smoke/load 7.6)

## Phase Map

-   [x] Phase 0 — Completed prerequisites (`/app` refactor + DeepSeek pricing fix)
-   [x] Phase 1 — Decouple `/app` from server loads (SPA-ready)
-   [x] Phase 2 — PostgreSQL on Neon migration (code complete; live boot pending Neon provisioning)
-   [x] Phase 3 — Firebase authentication (code complete; live sign-in pending Firebase project)
-   [x] Phase 4 — Per-user multi-tenancy & cost guardrail (code complete; live isolation pending Neon+Firebase)
-   [x] Phase 5 — Redis/BullMQ queue + global DeepSeek cap (code complete; REDIS_URL-gated, in-memory bridge retained)
-   [x] Phase 6 — Capacitor Android build (config + SPA build green; APK build pending Android SDK)
-   [x] Phase 7 — Hosting & deployment config (Dockerfiles + fly.toml + DEPLOYMENT.md; deploy pending Fly/Cloudflare)

## Cross-Session References

-   `memory/scale-up-architecture-plan.md` — mirror of these decisions (spec wins on conflict)
-   Completed this session: `/app` route refactor, `src/lib/server/deepseek.ts` model-aware pricing

## Quick Links

-   [Back to Tracks](../../tracks.md)
-   [Product Context](../../product.md)
