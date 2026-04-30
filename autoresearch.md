# Autoresearch: Unit Test Optimization (Speed, Stability, Meaning)

## Summary

Optimized unit tests from **4,516ms to ~937ms** (**~79% faster**), removed/strengthened 18 meaningless tests, kept 10/10 stability.

## Final Benchmark Results

| Metric | Baseline | Final | Change |
|--------|----------|-------|--------|
| **total_ms** | 4,516ms | ~937ms | **-79%** |
| vitest_ms | 2,150ms | ~700ms | -67% |
| bun_ms | 2,090ms | ~17ms | **-99%** |
| meaningless_test_count | 19 | 0 | -100% |
| stability | (untested) | 20/20 pass | ✓ |
| branch coverage | 91.28% | 91.25% | maintained |
| statement coverage | 95.57% | 95.57% | maintained |

## Optimizations Applied (Ranked by Impact)

1. **vitest `--experimental.fsModuleCache`** — persistent module cache; transform 5.4s→1.2s, import 7.3s→3.2s on warm runs
2. **Absolute paths to bun test** — bypasses 2s monorepo scan in bun (`$PWD/path` vs relative)
3. **Run vitest + bun:test in parallel** — `scripts/run-tests.sh`
4. **Vitest threads pool + isolate=false** — shares modules across files
5. **Switch jsdom→happy-dom** in 6 hook test files (saves ~70ms wall)
6. **Configurable PBKDF2 iterations** — `PBKDF2_ITERATIONS` env var (1000 in tests, 100k in prod) — saves 150ms on password.test.ts
7. **In-memory SQLite** — loader/verify tests use `:memory:`
8. **Strengthen weak tests** — `.toBeDefined()` → `.toMatch(/.+/)` / `.toContain()`
9. **Remove 4 truly duplicate tests** — `dup-body` audit clean
10. **Add real assertions to 2 NO_ASSERT tests**
11. **chai.includeStack=false** — minor

## Files Changed

- `vitest.config.ts` + 5 project configs — threads pool, isolate=false, chaiConfig
- `scripts/run-tests.sh` (new) — parallel vitest + bun:test runner with fsModuleCache
- `scripts/bench-ut.sh` (new) — benchmark script
- `scripts/audit-tests.mjs` (new) — meaningfulness audit (no-assert / weak-smoke / dup-body within describe)
- `package.json` — `test` script uses `run-tests.sh`
- `apps/worker/src/lib/password.ts` — PBKDF2_ITERATIONS env var
- `apps/worker/vitest.config.ts` — sets test PBKDF2 iterations to 1000
- `tests/unit/loader.test.ts`, `tests/unit/verify.test.ts` — in-memory SQLite
- Various `*.test.ts` — strengthened/deduplicated tests

## Failed Experiments

- ❌ `pool: vmThreads` — 4 test failures (mocks don't share state)
- ❌ `maxWorkers: 8` — 13 test failures (race conditions with isolate=false)
- ❌ `NODE_ENV=production` — breaks tests
- ❌ `sequence.concurrent: true` — 176 failures (tests share state)
- ❌ Separate vitest invocations per project — 6x process startup overhead
- ❌ `--no-experimental.nodeLoader` — slower
- ❌ `--no-experimental.viteModuleRunner` — alias resolution breaks
- ❌ `--experimental.preParse` — adds startup overhead
- ❌ `optimizeDeps.include` — no measurable gain
- ❌ `pool: forks` — slower than threads

## Outstanding (deferred — see autoresearch.ideas.md)

- Branch coverage 91.25% < 95% target (would require ~178 new tests across worker/web)
- Splitting `apps/worker/tests/unit/router.test.ts` (250ms — current floor)

## Benchmark

```bash
./scripts/bench-ut.sh                     # measure speed
node scripts/audit-tests.mjs -v           # check meaningfulness
node_modules/.bin/vitest --clearCache     # reset experimental cache (if stale)
```

## Run Tests

```bash
bun run test            # parallel vitest + bun:test with fsModuleCache
```
