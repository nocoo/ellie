# UT Speed/Stability/Meaning Optimization Ideas

## Completed (~78% faster: 4516ms → ~1006ms best)

| Optimization | Impact |
|--------------|--------|
| ✅ vitest --experimental.fsModuleCache | vitest_ms 1100→800 (-27%) on warm runs; transform 5.4s→1.2s |
| ✅ vitest threads pool + isolate=false | vitest_ms 2150→1100 (-49%) |
| ✅ Run vitest + bun:test in parallel | total saves ~2s sequential |
| ✅ Pass absolute paths to bun test | bun_ms 2900→17 (-99%) — bun does 2s scan from relative path in monorepo |
| ✅ In-memory SQLite for loader/verify tests | minor |
| ✅ Configurable PBKDF2 iterations | password.test.ts 258→82ms |
| ✅ Strengthen weak-smoke tests + delete duplicates | meaningless 19→0 |
| ✅ chai.includeStack=false + truncateThreshold=200 | minor |
| ✅ All test scripts updated (test:unit, test:worker, etc.) | consistent perf |

## Failed Experiments (DO NOT REPEAT)

- ❌ `pool: vmThreads` for worker — 4 test failures (mocks don't share state)
- ❌ `maxWorkers: 8` — 13 test failures (race conditions with isolate=false)
- ❌ `NODE_ENV=production` — breaks tests
- ❌ `sequence.concurrent: true` — 176 failures (tests share state)
- ❌ Separate vitest invocations per project — 6x process startup overhead
- ❌ `--no-experimental.nodeLoader` — slower
- ❌ `--no-experimental.viteModuleRunner` — alias resolution breaks
- ❌ `--experimental.preParse` — adds startup overhead
- ❌ `optimizeDeps.include` — no measurable gain
- ❌ `pool: forks` — slower than threads
- ❌ Reduce waitFor `interval` in jsdom hook tests — file already not in slowest top 10

## Outstanding (deferred)

- [ ] Switch jsdom→happy-dom (need to add dep, refactor 6 `// @vitest-environment` comments) — likely 10-20% wall savings
- [ ] Branch coverage 91.25% → 95% target (would require ~178 new tests across worker/web)
  - Worst: thread.ts -31, ipBan.ts -24, announcement.ts -20, forum.ts -19, me.ts -19
- [ ] Splitting `apps/worker/tests/unit/router.test.ts` (250ms — current floor would be lower)
- [ ] Parallelize `test:coverage` 5 sequential invocations (currently serial)
- [ ] Vitest daemon mode (doesn't exist; CLI startup ~200ms is the floor)

## Key Findings

1. **vitest fsModuleCache is huge**: `--experimental.fsModuleCache` persists transformed modules to disk between runs. Saves >250ms per warm run. Should be a default IMO.
2. **Bun test relative-path tax**: `bun test path/to/x.test.ts` scans the project (~2s for 1.9GB node_modules). Pass `$(pwd)/path/to/x.test.ts` to skip the scan. Massive impact in monorepos.
3. **Vitest 4 changed `poolOptions`**: now flat `test.isolate`, `test.maxWorkers`, etc. Old `poolOptions.threads.isolate` is silently ignored.
4. **isolate=false is fast but fragile**: Some tests rely on per-file module isolation. With shared modules across files, race conditions can appear when adding more workers.
5. **vmThreads is faster but breaks vi.mock-based tests** in this codebase.
6. **Audit duplicates need body-hash within describe**: 285 same-name tests are usually different scenarios in different `describe` blocks; only ~5 were actual duplicate bodies. Within-describe scope eliminates false positives.
7. **bun:test setup overhead is ~20ms** when invoked correctly (absolute paths). This is the floor for 34 tests.
