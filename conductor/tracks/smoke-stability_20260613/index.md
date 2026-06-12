# Track: Smoke Test & Stability Verification — Scale-Up

**ID:** smoke-stability_20260613
**Status:** Pending (run next session, once external services are provisioned)

## Documents

-   [Specification](./spec.md)
-   [Implementation Plan](./plan.md) — the 10-phase runbook with exact commands + expected results

## Progress

-   Phases: 0/10 complete
-   Tasks: 0/66 complete

## Phase Map

-   [ ] Phase 1 — Provisioning & first boot (Neon/Firebase/Redis env; `db:migrate`; bridge boot)
-   [ ] Phase 2 — Offline regression gate (`check`/`lint`/`db:generate`/both builds)
-   [ ] Phase 3 — Auth & session smoke (web): sign-up/verify, sign-in, logout, reset, route guards
-   [ ] Phase 4 — Multi-tenancy isolation & cost guardrail (two users; cross-user 404s; SSE hijack; quota; cascade)
-   [ ] Phase 5 — Translation pipeline & Postgres correctness (ingest/extract/translate/cache/ILIKE/cascades)
-   [ ] Phase 6 — Redis queue, global cap & cache bus + bridge parity (reconnect replay, cap=1, invalidation, Redis-kill)
-   [ ] Phase 7 — Capacitor Android (APK boot, native + email sign-in, cross-origin bearer)
-   [ ] Phase 8 — Hosting smoke (Fly web+worker, Cloudflare cache + SSE, multi-instance)
-   [ ] Phase 9 — Stability, failure-injection & recommended regression tests
-   [ ] Phase 10 — Sign-off, triage (file bug tracks / follow-ups), docs

## Context

-   Verifies the output of [scale-up-multitenant_20260613](../scale-up-multitenant_20260613/index.md)
    (code-complete + green; live behaviour unverified).
-   Run **Phases 1–5 with `REDIS_URL` unset** (in-memory bridge) first, then Phase 6 re-runs with Redis.
-   Authoritative how-to-run: [`DEPLOYMENT.md`](../../../DEPLOYMENT.md).

## Quick Links

-   [Back to Tracks](../../tracks.md)
-   [Product Context](../../product.md)
-   [Tech Stack](../../tech-stack.md)
