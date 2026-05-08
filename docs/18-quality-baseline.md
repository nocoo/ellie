# 18 — Quality Baseline (L1 / L2 / G1 / G2)

> **Status:** Phase 1A snapshot — coverage scope and skip/exclude rules **frozen** here. No business code or test changes in this commit.

This document is the canonical reference for what counts as "covered" in Ellie.
Any later change to thresholds, includes, excludes, or skip rules must update
this file in the same commit.

---

## 1. Quality tier definitions (6DQ-aligned)

| Tier  | Definition (Ellie scope)                                                                                       | Tooling                                       |
|-------|----------------------------------------------------------------------------------------------------------------|-----------------------------------------------|
| L0    | Buildable: `bun run build` / `bun x tsc --build` succeed.                                                      | tsc, next build, wrangler                     |
| L1    | Unit tests with coverage gate (see §2).                                                                        | Vitest (single runner — see §3)               |
| L2    | API integration tests against the Worker behind `wrangler dev --local`.                                        | `bun run test:l2` (bun test runner)           |
| L3    | UI E2E tests in real browsers.                                                                                 | Playwright                                    |
| G1    | Static analysis gate: typecheck + lint + L1 coverage thresholds (§2.3).                                        | tsc, biome, vitest --coverage                 |
| G2a   | Secret scan gate.                                                                                              | gitleaks                                      |
| G2b   | Dependency vulnerability gate.                                                                                 | osv-scanner                                   |
| D1    | Isolation ≥ 2 layers (worker / web / admin / Playwright).                                                       | architecture                                  |

6DQ default L1 floor is **branch ≥ 80%**; Ellie raises it to **stmt/line/func ≥ 95% / branch ≥ 90%** (per §2.3).

---

## 2. L1 coverage scope (frozen)

### 2.1 In-scope packages and source globs

Every gated package owns its own `vitest.config.ts` whose `coverage.include` is
the **only** denominator. Globs below mirror the configs as of this commit.

| Package              | `coverage.include`                                                                                       |
|----------------------|----------------------------------------------------------------------------------------------------------|
| `apps/worker`        | `src/**/*.ts`                                                                                            |
| `apps/web`           | `src/lib/**/*.ts`, `src/viewmodels/**/*.ts`, `src/hooks/**/*.ts`, `src/auth.ts`, `src/proxy.ts`          |
| `apps/admin`         | `src/lib/**/*.ts`, `src/viewmodels/**/*.ts`                                                              |
| `packages/shared`    | `src/**/*.ts`                                                                                            |
| `packages/test-mocks`| `src/**/*.ts`                                                                                            |
| `packages/types`     | `src/**/*.ts`                                                                                            |
| `packages/migrate`   | `src/extract/**/*.ts`, `src/transform/**/*.ts`                                                           |

### 2.2 View-class exclusion (canonical "not L1" list)

Per Zheng's directive **"UT 95%，不含 View 类"**, the following globs are
**excluded** from every coverage denominator. They are validated by L3
(Playwright) or by L2 (route handlers exercised via API integration), not L1.

| Glob                                  | Reason                                              |
|---------------------------------------|-----------------------------------------------------|
| `apps/web/src/components/**`          | React components — L3 (Playwright)                  |
| `apps/web/src/app/**`                 | Next.js pages / layouts / route handlers — L3       |
| `apps/web/src/contexts/**`            | React context providers — thin wiring               |
| `apps/web/src/actions/**`             | Next.js server actions — exercised via integration  |
| `apps/admin/src/components/**`        | Admin React components — L3                         |
| `apps/admin/src/app/**`               | Admin pages / layouts / route handlers — L3         |
| `packages/ui/**`                      | Wrappers around shadcn/ui primitives                |
| `**/*.d.ts`                           | Generated declaration files                         |

Other per-package excludes (re-exports, type-only files):

| Package              | Additional excludes               | Reason                                                           |
|----------------------|-----------------------------------|------------------------------------------------------------------|
| `packages/shared`    | `src/index.ts`                    | Pure re-export barrel.                                           |
| `packages/test-mocks`| `src/index.ts`                    | Pure re-export barrel.                                           |
| `packages/types`     | `src/index.ts`, `src/types.ts`, `src/version.ts` | Re-export barrels and version constant.            |
| `packages/migrate`   | (only `extract` + `transform` included; rest of `src/**` left out) | The remaining files use `bun:sqlite` and run as one-shot scripts. |

### 2.3 Thresholds (frozen)

| Package              | Stmts | Branch | Funcs | Lines |
|----------------------|-------|--------|-------|-------|
| `apps/worker`        | 95    | 90     | 95    | 95    |
| `apps/web`           | 95    | 90     | 95    | 95    |
| `apps/admin`         | 95    | 90     | 95    | 95    |
| `packages/shared`    | 95    | 90     | 95    | 95    |
| `packages/test-mocks`| 98    | 95     | 98    | 98    |
| `packages/types`     | 95    | 90     | 95    | 95    |
| `packages/migrate`   | 95    | 90     | 95    | 95    |

Notes:

- `packages/test-mocks` keeps a higher floor because the package is small and
  100% achievable; we don't want regressions to slip in.
- `packages/migrate` branch floor was raised from 85 to 90 in Phase 2C after
  parser/bbcode/extractor edge-branch tests landed. Current actual:
  stmt 97.81 / branch 90.20 / func 100 / line 98.60.
- `packages/test-mocks` repository globs intentionally exclude `src/index.ts`
  (re-export); current actual covers 99.58 / 97.07 / 98.73 / 100.

---

## 3. Single runner: Vitest only (skip-rule re-evaluation)

### 3.1 Pre-Phase-1 state (historical)

Before Phase 2A, `scripts/run-tests.sh` ran Vitest **and** three separate
`bun test` invocations because of these files:

| File                                                | Bun-only API used                            |
|-----------------------------------------------------|----------------------------------------------|
| `tests/unit/loader.test.ts`                         | `bun:sqlite`                                 |
| `tests/unit/verify.test.ts`                         | `bun:sqlite`                                 |
| `tests/unit/migration-0029-schema.test.ts`          | `bun:sqlite`                                 |
| `apps/worker/tests/unit/lib/dove.test.ts`           | `globalThis.fetch = mock(…)` (process-global)|
| `apps/worker/tests/unit/lib/email-verify.test.ts`   | `bun:test` import (no mocks)                 |
| `apps/worker/tests/unit/handlers/email.test.ts`     | `mock.module(...)`                           |

The three worker files were excluded from the Vitest v8 coverage denominator
in `apps/worker/vitest.config.ts` so they would not count as 0% covered.

### 3.2 Phase 2A — landed

**Worker `dove` / `email-verify` / `handlers/email`**: migrated to Vitest
(commits `e87f604` + `fe64e27`). The v8-coverage `exclude` entries and the
worker `bun test` lane were removed; only `**/*.d.ts` remains in the worker
coverage exclude list. Mock translation that was applied:

| bun:test API                          | Vitest equivalent                                       |
|---------------------------------------|---------------------------------------------------------|
| `mock.module("…", () => ({ … }))`     | top-level `vi.mock("…", () => ({ … }))`; share state via `vi.hoisted()` |
| `globalThis.fetch = mock(...)`        | `vi.spyOn(globalThis, "fetch").mockImplementation(...)` with `afterEach(() => vi.restoreAllMocks())` |
| `mock(() => {})` (anonymous)          | `vi.fn(() => {})`                                       |

Post-migration baseline (worker package): stmt 95.52 / branch 90.46 / func 97 /
line 96.85 — over the 95/90/95/95 floor.

**Migration-0029 / loader / verify** stay under `bun test` permanently because
they invoke `bun:sqlite` directly. They are **not** in any Vitest coverage
denominator (they exercise `packages/migrate` scripts that are themselves
excluded from `packages/migrate/vitest.config.ts`). The bun lane in
`scripts/run-tests.sh` and `.husky/pre-push` now runs only these three files.

### 3.3 Integration `describe.skipIf` — landed

Files: `apps/worker/tests/unit/integration/online-tracking.test.ts`,
`apps/worker/tests/unit/integration/router.test.ts`.

Phase 2A replaced the `require.resolve("@ellie/types")` side-channel with an
explicit env gate:

```ts
const canRunIntegration =
  process.env.ELLIE_INTEGRATION === undefined
  || process.env.ELLIE_INTEGRATION === "1";
```

Default-on at the monorepo root; an isolated worktree opts out with
`ELLIE_INTEGRATION=0`. CI behavior is now deterministic.

### 3.4 Playwright `test.skip` calls (out-of-scope for L1)

| File                                   | Skip predicate                                                | Verdict   |
|----------------------------------------|---------------------------------------------------------------|-----------|
| `tests/e2e/post-crud.spec.ts:71`       | `editCount === 0` ("No editable posts found")                 | **Keep**: data-dependent precondition. |
| `tests/e2e/post-crud.spec.ts:118`      | `deleteCount === 0` ("No deletable posts found")              | **Keep**: same.                        |
| `tests/e2e/thread-crud.spec.ts:67`     | `!createdThreadUrl` ("TC-01 must pass first")                 | **Keep**: explicit ordering.           |

These are L3 scope and outside this document's enforcement.

---

## 4. Gate scripts (Phase 3 — landed)

Phase 1A froze *what* each gate is; Phase 3 collapses *how* it is invoked
into a single canonical set of `package.json` scripts so hooks, CI, and
humans all run the same definition.

| Script              | Definition                                                                                                                                | Notes |
|---------------------|-------------------------------------------------------------------------------------------------------------------------------------------|-------|
| `bun run gate:g1`   | `bun run typecheck && bun run lint && bun run test:coverage`                                                                              | G1 = typecheck + lint + L1 coverage thresholds (§2.3). |
| `bun run gate:g2`   | `gitleaks detect --no-banner && osv-scanner scan --lockfile bun.lock`                                                                     | G2a + G2b. Filters for G2b live in `osv-scanner.toml`. |
| `bun run gate:full` | `bun run gate:g1 && bun run test:l2 && bun run gate:g2`                                                                                   | Full pre-release sweep (G1 + L2 + G2). |

Husky hooks reuse the same underlying commands but keep them inlined to
preserve parallel execution:

| Hook                | Stages (parallel within each phase)                                                                                                                                        |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `.husky/pre-commit` | lint-staged (incremental biome) + `bun run test:coverage` + `gitleaks protect --staged` + `bun run test:l2` + (conditional) `bun run typecheck` + (conditional) Rust gates |
| `.husky/pre-push`   | Phase 1: `bun run typecheck` + `bun run lint` + `bun run test:coverage` + bun:sqlite migrate lane.<br/>Phase 2: `bun run test:l2` + `osv-scanner` + `gitleaks detect` + (conditional) Rust gates |

Pre-commit gitleaks runs `protect --staged` (commit-time, staged files
only); pre-push runs the full-repo `detect` form, which matches `gate:g2`
exactly. Pre-push L1 lane uses `bun run test:coverage` (was `bunx vitest
run` before Phase 3) so the §2.3 thresholds are now enforced on push as
well as on commit.

**Out of scope for G1 today:** `scripts/audit-l2-coverage.ts
--strict-coverage` is intentionally not part of `gate:g1`. The audit is
green for the existing matched routes but the matrix still has 17
uncovered routes (Phase 4 work); promoting it to gate:g1 before the
matrix is at 100% would block all commits until Phase 4 lands.

---

## 5. L2 / G2 baseline (informational)

Captured for cross-reference; L2 100% scope is owned by `docs/18-l2-coverage-matrix.md`
(Phase 1B), G2 by `osv-scanner.toml` and gitleaks defaults.

| Gate    | Command                                        | Baseline result (2026-05-09 post-Phase-3) |
|---------|------------------------------------------------|--------------------------------------------|
| L1      | `bun run test`                                 | 4498 vitest tests + 37 bun tests passing   |
| L1 cov  | `bun run test:coverage`                        | All 7 packages over §2.3 floors; `packages/migrate` now 97.81 / 90.20 / 100 / 98.60 with the raised branch ≥90 floor; `packages/types` 100/100/100/100 |
| L2      | `bun run test:l2`                              | 258 tests passing                           |
| G1      | `bun run gate:g1` (typecheck + lint + L1 cov)  | clean                                       |
| G2      | `bun run gate:g2` (gitleaks + osv-scanner)     | clean — no leaks (1409 commits), no issues (10 filtered, see `osv-scanner.toml`) |
| Full    | `bun run gate:full` (G1 + L2 + G2)             | composition of the rows above; verified via the constituent commands |

---

## 6. How to change this baseline

1. Open a PR / commit that updates **both** the relevant `vitest.config.ts`
   and the corresponding row in §2.
2. If raising / lowering a threshold, update §2.3 and capture the new actuals
   in §5 in the same commit.
3. If adding a new excluded glob, add a new row in §2.2 with a one-line
   reason. Excludes without a reason will be reverted on review.
4. Skip-rule changes follow §3 — every `it.skip` / `describe.skip` /
   `.skipIf` must be enumerated here.
