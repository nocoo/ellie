# Autoresearch: Unit Test Optimization (Speed, Stability, Meaning)

## Summary

Optimized unit tests from **4,516ms to ~1,330ms** (**~70% faster**), removed/strengthened 18 meaningless tests, kept 10/10 stability.

## Final Benchmark Results

| Metric | Baseline | Final | Change |
|--------|----------|-------|--------|
| **total_ms** | 4,516ms | ~1,330ms | **-70%** |
| vitest_ms | 2,150ms | ~1,100ms | -49% |
| bun_ms | 2,090ms | ~20ms | **-99%** |
| meaningless_test_count | 19 | 1* | -94% |
| stability | (untested) | 10/10 pass | ✓ |
| branch coverage | 91.28% | 91.25% | maintained |
| statement coverage | 95.57% | 95.57% | maintained |

*remaining 1 is a false positive (same body in different `describe` contexts with different env setup).

## Optimizations Applied

1. **Vitest threads pool + isolate=false** — shares modules across files (~50% faster vitest)
2. **Run vitest + bun:test in parallel** — `scripts/run-tests.sh` (saves ~2s sequential)
3. **Absolute paths to bun test** — bypasses 2s monorepo scan in bun (`$(pwd)/path` vs relative)
4. **In-memory SQLite** — loader/verify tests use `:memory:`
5. **Configurable PBKDF2 iterations** — `PBKDF2_ITERATIONS` env var (1000 in tests, 100k in prod)
6. **Strengthen weak tests** — `.toBeDefined()` → `.toMatch(/.+/)` / `.toContain()`
7. **Remove duplicate-body tests** — 5 truly identical tests deleted
8. **Add real assertions to NO_ASSERT tests** — meaningful coverage
9. **chai.includeStack=false** — minor speed win

## Files Changed

- `vitest.config.ts` + 5 project configs — threads pool, isolate=false, chaiConfig
- `scripts/run-tests.sh` (new) — parallel vitest + bun:test runner
- `scripts/bench-ut.sh` (new) — benchmark script
- `scripts/audit-tests.mjs` (new) — meaningfulness audit
- `package.json` — `test` script uses `run-tests.sh`
- `apps/worker/src/lib/password.ts` — PBKDF2_ITERATIONS env var
- `apps/worker/vitest.config.ts` — sets test PBKDF2 iterations to 1000
- `tests/unit/loader.test.ts`, `tests/unit/verify.test.ts` — in-memory SQLite
- Various `*.test.ts` — strengthened/deduplicated tests

## Failed Experiments

- ❌ `pool: vmThreads` for worker — 4 test failures
- ❌ `maxWorkers: 8` — 13 test failures (race conditions with isolate=false)
- ❌ `NODE_ENV=production` — breaks tests

## Outstanding (deferred — see autoresearch.ideas.md)

- Branch coverage 91.25% < 95% target (would require ~178 new tests across worker/web)
- Splitting `apps/worker/tests/unit/router.test.ts` (225ms — current floor)

## Benchmark

```bash
./scripts/bench-ut.sh
```

## Run Tests

```bash
bun run test                # parallel vitest + bun:test
node scripts/audit-tests.mjs -v  # meaningfulness audit
```
