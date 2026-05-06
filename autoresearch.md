# Autoresearch Rules — Ellie List Loading Performance

## Goal
Find and remove performance bottlenecks affecting **list loading** across web,
admin and worker layers. Refactor duplicated code into shared helpers when it
helps clarity or hot-path performance, but **do not change behaviour** and
**do not break tests** (L1, L2, L3).

## Primary Metric
- `total_µs` from `bun scripts/bench-list.ts` — combined wall time of N
  iterations of representative list handlers (forum.list + thread.list with
  varied dataset sizes).
- Lower is better.

## Secondary Metrics (monitoring only)
- `forum_list_µs` — per-call time for forum tree list
- `thread_list_µs` — per-call time for thread list
- `worker_test_ms` — duration of `bunx vitest run -c apps/worker/vitest.config.ts`
  on a smoke subset (only run on the gate, not every iteration)

## Hard Gates (must pass)
1. The benchmark itself must finish without errors and JSON output of handlers
   must keep the same shape (the bench includes a sanity check).
2. Worker unit tests for the touched handlers must pass:
   `bunx vitest run -c apps/worker/vitest.config.ts tests/unit/handlers/forum.test.ts tests/unit/handlers/thread.test.ts tests/unit/lib`
   Run this gate **before keeping** any change that modifies
   `apps/worker/src/handlers/forum.ts`, `apps/worker/src/handlers/thread.ts`, or
   anything under `apps/worker/src/lib/`.
3. Once per ~10 keeps (or before a meaningful refactor PR), run full L1
   `bun run test` to make sure nothing else regressed.

## Anti-Cheating Guardrails
- Do **not** short-circuit handlers to skip work for benchmark inputs.
- Do **not** memoize cross-call (handler must remain stateless per request)
  unless the cache is also valid in production (KV-backed, TTL'd, etc.).
- Do **not** edit `scripts/bench-list.ts` to make it cheaper to run unless the
  change is clearly fairer (e.g. measuring more representative work). Any edit
  to the bench must keep the same set of operations.
- Optimisations should generalise: if a change only helps the bench's exact
  dataset shape, reject it.
- Behavioural changes require new/updated unit tests in the same commit.

## Useful Commands
- Bench: `bun scripts/bench-list.ts`
- Worker handler tests: `bunx vitest run -c apps/worker/vitest.config.ts tests/unit/handlers tests/unit/lib`
- Full L1: `bun run test`

## Notes
- Worker handlers are mostly pure functions that take `(Request, Env, ctx)` and
  talk to a mocked `D1Database` in benches. We can therefore measure handler
  cost directly without a worker runtime.
- The bench also covers admin/web shared code transitively (mappers,
  pagination, response builders, censor, visibility) which are imported by the
  same handlers.
