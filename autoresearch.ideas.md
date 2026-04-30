# UT Speed/Stability/Meaning Optimization Ideas

## Completed (~70% faster: 4516ms → 1362ms)

| Optimization | Impact |
|--------------|--------|
| ✅ vitest threads pool + isolate=false | vitest_ms 2150→1100 (-49%) |
| ✅ Run vitest + bun:test in parallel | total saves ~2s sequential |
| ✅ Pass absolute paths to bun test | bun_ms 2900→17 (-99%) — bun does 2s scan from relative path in monorepo |
| ✅ In-memory SQLite for loader/verify tests | minor |
| ✅ Strengthen weak-smoke tests + delete duplicates | meaningless 19→1 |
| ✅ Add real assertions to NO_ASSERT tests | quality |
| ✅ chai.includeStack=false + truncateThreshold=200 | minor |

## Failed Experiments (DO NOT REPEAT)

- ❌ `pool: vmThreads` for worker — 4 test failures (mocks don't share state)
- ❌ `maxWorkers: 8` — 13 test failures on first run (race conditions with isolate=false)
- ❌ `NODE_ENV=production` — breaks tests

## Outstanding (deferred)

- [ ] Add ~178 branch coverage tests to reach 95% target (currently 91.28%)
  - Worst: thread.ts 31, ipBan.ts 24, announcement.ts 20, forum.ts 19, me.ts 19 missing branches
- [ ] Reduce PBKDF2 iterations in tests via env var (would speed password.test.ts from 195ms to <50ms — risk: doesn't test prod iteration count)
- [ ] Split apps/worker/tests/unit/router.test.ts (141 tests, 225ms — current floor)
- [ ] Investigate why bun test takes 2s on relative paths in this monorepo (probably node_modules walk)
- [ ] Track coverage in bench script as periodic side metric

## Key Findings

1. **Bun test relative-path tax**: `bun test path/to/x.test.ts` scans the project (~2s for 1.9GB node_modules). Pass `$(pwd)/path/to/x.test.ts` to skip the scan. Massive impact in monorepos.
2. **Vitest 4 changed `poolOptions`**: now flat `test.isolate`, `test.maxWorkers`, etc. Old `poolOptions.threads.isolate` is silently ignored.
3. **isolate=false is fast but fragile**: Some tests rely on per-file module isolation. With shared modules across files, race conditions can appear when adding more workers.
4. **vmThreads is faster but breaks vi.mock-based tests** in this codebase.
5. **Audit duplicates need body-hash, not name-match**: 285 same-name tests are usually different scenarios in different `describe` blocks; only 5 were actual duplicate bodies.
