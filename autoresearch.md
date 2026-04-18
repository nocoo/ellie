# Autoresearch: Pre-commit Performance Optimization

## Summary

Optimized pre-commit checks from **2,657ms to ~650ms** (**75% faster**).

## Final Benchmark Results

| Metric | Baseline | Final | Improvement |
|--------|----------|-------|-------------|
| **total_ms** | 2,657ms | ~650ms | **75% faster** |
| typecheck_ms | 1,189ms | ~100ms | 92% faster |
| worker_test_ms | 469ms | ~250ms | 47% faster |
| rust_ms | 765ms | ~630ms | 18% faster |

## Optimizations Applied

1. **Parallel execution** - All 4 checks run simultaneously
2. **`tsc --build`** - Incremental TypeScript with project references
3. **`bun test --concurrent`** - Parallel test execution
4. **Parallel cargo commands** - fmt, clippy, test run in parallel
5. **Conditional execution** - Skip checks when relevant files unchanged
6. **Proper composite config** - Fixed tsconfig for db/migrate packages

## Pre-commit Components (all parallel)

```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│  lint-staged    │   typecheck     │  worker tests   │   rust checks   │
│    ~150ms       │    ~100ms       │    ~250ms       │    ~630ms       │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
                           │
                     total ≈ max(all) ≈ 650ms
```

## Benchmark

```bash
./scripts/bench-precommit.sh
```

## Files Changed

- `.husky/pre-commit` - Parallel execution with conditional checks
- `package.json` - `typecheck` uses `tsc --build`
- `packages/db/tsconfig.json` - Added `composite: true`
- `packages/migrate/tsconfig.json` - Added `composite: true`
- `biome.json` - Ignore generated .d.ts files
- `.gitignore` - Ignore build outputs from composite projects
