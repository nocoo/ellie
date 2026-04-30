# 17 — Unit Test Coverage Improvement Plan

> Raise the monorepo-wide UT coverage gate to **95%** (statements, lines, functions) / **90%** (branches), unify all unit tests under **Vitest**, and organize test files by package.

---

## 1. Scope

### 1.1 In-scope (coverage-gated)

| Package | Source paths | Rationale |
|---------|-------------|-----------|
| `apps/worker` | `src/handlers/**`, `src/lib/**`, `src/middleware/**`, `src/index.ts` | Core API logic, already at 60–99% |
| `apps/web` | `src/lib/**`, `src/viewmodels/**`, `src/hooks/**`, `src/auth.ts`, `src/proxy.ts` | Pure logic layer (MVVM viewmodels, utilities, auth) |
| `apps/admin` | `src/lib/**`, `src/viewmodels/**`, `src/hooks/**`, `src/auth.ts` | Admin logic layer |
| `packages/shared` | `src/**` | Shared utilities (formatting, pagination, params, api-error) |
| `packages/test-mocks` | `src/**` | Already at 100%, maintain |

### 1.2 Excluded (remain outside gate)

| Exclusion | Reason |
|-----------|--------|
| `apps/web/src/components/**` | UI components — covered by E2E / visual testing |
| `apps/web/src/app/**` | Next.js pages/layouts — covered by E2E |
| `apps/web/src/contexts/**` | React context providers — thin wiring |
| `apps/web/src/actions/**` | Server actions — covered by integration tests |
| `apps/admin/src/components/**` | UI components — covered by E2E |
| `apps/admin/src/app/**` | Next.js pages/layouts |
| `packages/ui/**` | shadcn/ui primitives — third-party wrappers |
| `packages/types/**` | Type-only package, no runtime logic |
| `packages/cli/**` | CLI tool — tested via integration |
| `packages/db/**` | Schema definitions — tested via integration |
| `packages/migrate/**` | One-shot migration scripts (Bun-specific: `bun:sqlite`) |

---

## 2. Current State

### 2.1 Test framework

| Layer | Runner | Config |
|-------|--------|--------|
| Unit (main) | Vitest v4.1.5 + v8 coverage | Root `vitest.config.ts` |
| Unit (6 files) | Bun test runtime | `bun:test` imports |
| Integration | Bun test + preload | `tests/integration/` |
| E2E | Playwright | `playwright.config.ts` |

### 2.2 Bun-test files requiring migration

| File | Bun-specific APIs | Difficulty |
|------|-------------------|------------|
| `tests/unit/auth-callbacks.test.ts` | `mock()` → `vi.fn()` | Easy |
| `tests/unit/proxy.test.ts` | None (pure logic) | Easy |
| `tests/unit/loader.test.ts` | Source uses `bun:sqlite` | **Keep in Bun** |
| `tests/unit/verify.test.ts` | Source uses `bun:sqlite` | **Keep in Bun** |
| `tests/unit/hooks/use-is-mobile.test.ts` | `mock.module()` → `vi.mock()` | Medium |
| `tests/unit/hooks/use-theme.test.ts` | `mock.module()` → `vi.mock()` | Medium |

**Decision:** Migrate 4 files to Vitest (auth-callbacks, proxy, use-is-mobile, use-theme). Keep 2 files (loader, verify) under Bun because they test `packages/migrate` scripts that depend on `bun:sqlite` — these are excluded from the coverage gate.

### 2.3 Coverage summary (current)

| Scope | Stmts | Branches | Funcs | Lines |
|-------|-------|----------|-------|-------|
| **Overall** | 49.49% | 46.10% | 42.67% | 49.34% |
| `apps/worker/src/lib` | 98.22% | 96.32% | 100% | 98.40% |
| `apps/worker/src/middleware` | 99.31% | 98.85% | 100% | 99.30% |
| `apps/worker/src/handlers` | 73.39% | 66.85% | 73.64% | 73.72% |
| `apps/worker/src/handlers/admin` | 65.24% | 57.75% | 64.81% | 67.55% |
| `apps/web/src/lib` | 71.60% | 60.22% | 73.73% | 73.58% |
| `apps/web/src/viewmodels/forum` | 48.61% | 62.66% | 50.78% | 44.33% |
| `apps/web/src/viewmodels/shared` | 98.52% | 97.77% | 100% | 100% |
| `apps/web/src/hooks` | 1.72% | 0% | 0% | 1.92% |
| `packages/shared/src` | 0% | 0% | 0% | 0% |
| `packages/test-mocks/src` | 100% | 98.26% | 100% | 100% |
| `apps/admin` (not measured) | — | — | — | — |

---

## 3. Target Architecture

### 3.1 Per-package vitest configs

Each gated package gets its own `vitest.config.ts` with independent thresholds:

```
apps/worker/vitest.config.ts        → runs apps/worker/tests/**
apps/web/vitest.config.ts           → runs apps/web/tests/**
apps/admin/vitest.config.ts         → runs apps/admin/tests/**
packages/shared/vitest.config.ts    → runs packages/shared/tests/**
packages/test-mocks/vitest.config.ts → runs packages/test-mocks/tests/**
```

The root `vitest.config.ts` becomes a **workspace orchestrator** that delegates to each package config (or is replaced by `vitest.workspace.ts`).

### 3.2 Test file organization

```
apps/worker/
  tests/unit/
    handlers/       ← existing (well organized)
    lib/            ← existing
    middleware/     ← existing

apps/web/
  tests/unit/
    lib/            ← existing (avatar tests) + migrate from root tests/
    viewmodels/     ← migrate from root tests/unit/viewmodels/
    hooks/          ← migrate from root tests/unit/hooks/ (+ bun→vitest migration)
    auth.test.ts    ← migrate from root tests/unit/auth-callbacks.test.ts (bun→vitest)
    proxy.test.ts   ← migrate from root tests/unit/proxy.test.ts (bun→vitest)

apps/admin/
  tests/unit/
    components/     ← existing (NON-GATED smoke tests, excluded from coverage)
    lib/            ← NEW (gated)
    viewmodels/     ← NEW (gated)
    hooks/          ← NEW (gated)

packages/shared/
  tests/
    api-error.test.ts       ← NEW
    formatting.test.ts      ← migrate from root tests/unit/viewmodels/shared/
    pagination.test.ts      ← migrate from root
    params.test.ts          ← migrate from root

packages/test-mocks/
  tests/
    mocks.test.ts           ← NEW (maintain 98%+ gate)
```

### 3.3 Target thresholds (95% gate)

| Package | Stmts | Lines | Funcs | Branches |
|---------|-------|-------|-------|----------|
| `apps/worker` | 95% | 95% | 95% | 90% |
| `apps/web` | 95% | 95% | 95% | 90% |
| `apps/admin` | 95% | 95% | 95% | 90% |
| `packages/shared` | 95% | 95% | 95% | 90% |
| `packages/test-mocks` | 98% | 98% | 98% | 95% |

### 3.4 Root scripts (updated)

```json
{
  "test": "vitest run --workspace vitest.workspace.ts",
  "test:worker": "vitest run --project worker",
  "test:web": "vitest run --project web",
  "test:admin": "vitest run --project admin",
  "test:shared": "vitest run --project shared",
  "test:test-mocks": "vitest run --project test-mocks",
  "test:coverage": "vitest run --workspace vitest.workspace.ts --coverage",
  "test:bun": "bun test tests/unit/loader.test.ts tests/unit/verify.test.ts"
}
```

---

## 4. Execution Plan (Atomic Commits)

Each Wave is a single commit targeting one package. Dependencies between waves are minimal — Waves 1–5 can run in parallel after Wave 0. Wave 6 is the final gate commit after all packages pass.

### Wave 0: Infrastructure (1 commit) ✅

**Commit: `feat(test): add vitest project configs and per-package coverage gates`**

- Create root `vitest.config.ts` with `test.projects` (Vitest 4 API, replaces deprecated `vitest.workspace.ts`)
- Create per-package `vitest.config.ts` for: worker, web, admin, shared, test-mocks
- Each package config uses `defineConfig` for dual-purpose: project mode + standalone coverage
- Update root `package.json` scripts
- Set initial thresholds: worker at current level, others at 0 (no tests yet)
- Packages without tests use `passWithNoTests: true` until their wave

Changes:
- `vitest.config.ts` (rewritten — Vitest 4 projects mode)
- `apps/worker/vitest.config.ts` (new)
- `apps/web/vitest.config.ts` (new, `passWithNoTests: true`)
- `apps/admin/vitest.config.ts` (new)
- `packages/shared/vitest.config.ts` (new, `passWithNoTests: true`)
- `packages/test-mocks/vitest.config.ts` (new, `passWithNoTests: true`)
- `package.json` (update scripts)
- `apps/web/tsconfig.json`, `apps/admin/tsconfig.json` (exclude vitest.config.ts)

> **Note:** Root `test` script remains hybrid (`vitest run` + `bun test` for 6 excluded files) until Wave 3 migrates 4 of those to Vitest.
> Per-package coverage scripts (`test:coverage:web`, etc.) are available but will report 0% until their wave adds tests.
> Bun→Vitest test file migration happens in Wave 3 (web commit) since all 4 migratable files test web-owned source code.

### Wave 1: `packages/shared` (1 commit)

**Commit: `test(shared): add unit tests and 95% coverage gate`**

- Migrate existing tests from `tests/unit/viewmodels/shared/` to `packages/shared/tests/`
- Update imports to point to `../src/` instead of deep `../../../../apps/web/` paths
- Add `api-error.test.ts` (constructor overloads, message fallback)
- Fix import paths in existing formatting/pagination/params tests
- Ratchet threshold to 95/95/95/90

Coverage work needed:
- `api-error.ts`: ~30 lines, needs 2-3 tests for constructor branches
- `formatting.ts`, `pagination.ts`, `params.ts`: Already tested but tests import from `apps/web` copy — repoint to `packages/shared`

### Wave 2: `apps/worker` (1 commit)

**Commit: `test(worker): fill coverage gaps to reach 95% gate`**

Current gaps (0% coverage):
- `handlers/digest.ts` (238 lines) — digest email generation
- `handlers/message.ts` (403 lines) — private messaging
- `handlers/post-comment.ts` (236 lines) — post comments
- `handlers/user-content.ts` (194 lines) — user content management
- `handlers/admin/adminLog.ts` (162 lines) — admin audit log
- `handlers/admin/announcement.ts` (322 lines) — announcements
- `handlers/admin/report.ts` (281 lines) — admin report handling
- `handlers/admin/statistics.ts` (295 lines) — statistics

Partially covered (needs boost):
- `handlers/forum.ts` (72% → 95%)
- `handlers/thread.ts` (77% → 95%)
- `handlers/admin/forum.ts` (79% → 95%)
- `handlers/admin/ipBan.ts` (85% → 95%)
- `handlers/admin/settings.ts` (76% → 95%)
- `src/index.ts` (60% → 95%)

Estimated new test lines: ~2000–3000 lines across 15+ test files.

### Wave 3: `apps/web` (1 commit)

**Commit: `test(web): migrate tests by package, fill coverage gaps, reach 95% gate`**

Bun→Vitest migration (4 files):
- `tests/unit/auth-callbacks.test.ts` — rewrite `mock()` → `vi.fn()`, move to `apps/web/tests/unit/auth.test.ts`
- `tests/unit/proxy.test.ts` — swap `bun:test` → `vitest`, move to `apps/web/tests/unit/proxy.test.ts`
- `tests/unit/hooks/use-is-mobile.test.ts` — rewrite `mock.module()` → `vi.mock()`, move to `apps/web/tests/unit/hooks/`
- `tests/unit/hooks/use-theme.test.ts` — rewrite `mock.module()` → `vi.mock()`, move to `apps/web/tests/unit/hooks/`

File moves (already vitest-compatible):
- `tests/unit/viewmodels/forum/*.test.ts` → `apps/web/tests/unit/viewmodels/forum/`
- `tests/unit/lib/*.test.ts` → `apps/web/tests/unit/lib/`
- `tests/unit/components/` → `apps/web/tests/unit/components/`

Coverage gaps to fill:
- `src/lib/csrf.ts` (0% → 95%)
- `src/lib/forum-auth.ts` (0% → 95%)
- `src/lib/forum-settings.ts` (0% → 95%)
- `src/lib/avatar-proxy.ts` (0% → 95%)
- `src/lib/avatar.ts` (0% → 95%)
- `src/hooks/feature-flags.ts` (0% → 95%)
- `src/hooks/use-width-mode.ts` (0% → 95%)
- `src/viewmodels/forum/` — multiple files at 0–30% → 95%
- `src/auth.ts` — currently tested but not in vitest scope
- `src/proxy.ts` — currently tested but not in vitest scope

Estimated new test lines: ~1500–2500 lines.

### Wave 4: `apps/admin` (1 commit)

**Commit: `test(admin): add unit tests for lib/viewmodels/hooks, set 95% coverage gate`**

> **Note:** Existing `tests/unit/components/` tests are retained as non-gated smoke tests. They are NOT included in the coverage scope — only `src/lib/**`, `src/viewmodels/**`, `src/hooks/**`, and `src/auth.ts` are gated.

Currently no coverage measurement. Need:
- `tests/unit/lib/admin-api.test.ts` (195 lines source)
- `tests/unit/lib/admin-proxy.test.ts` (109 lines source)
- `tests/unit/lib/api-client.test.ts` (147 lines source)
- `tests/unit/lib/cdn.test.ts` (66 lines source)
- `tests/unit/lib/csrf.test.ts` (59 lines source)
- `tests/unit/lib/navigation.test.ts` (114 lines source)
- `tests/unit/viewmodels/admin/*.test.ts` — 15 viewmodel files (~2000 lines source)
- `tests/unit/hooks/use-is-mobile.test.ts`
- `tests/unit/hooks/use-theme.test.ts`
- `tests/unit/auth.test.ts` (71 lines source)

Estimated new test lines: ~2000–3000 lines.

### Wave 5: `packages/test-mocks` (1 commit)

**Commit: `test(test-mocks): add vitest config and maintain 98% coverage gate`**

Already at 100%/98%/100%/100%. This commit:
- Creates `packages/test-mocks/vitest.config.ts` with 98/98/98/95 thresholds
- Adds minimal `packages/test-mocks/tests/mocks.test.ts` to verify mock factory correctness
- Ensures the package is independently runnable via `vitest run --project test-mocks`

> Rationale: `test-mocks` is already well-covered by transitive usage in other package tests. The dedicated config formalizes the gate and satisfies "每个子包一个 commit".

### Wave 6: Ratchet & Gate (1 commit)

**Commit: `ci(test): ratchet all coverage thresholds to 95% and update CI/hooks`**

- Verify all packages pass 95/95/95/90 (test-mocks: 98/98/98/95)
- Update `.husky/pre-push` to run `vitest run --workspace vitest.workspace.ts --coverage`
- Update `.github/workflows/ci.yml` test step: `bun run test:coverage` (uses workspace)
- Remove legacy `test:unit:bun` script for migrated files (keep only loader/verify)
- Clean up root `tests/unit/` — only `loader.test.ts` and `verify.test.ts` remain
- Update this document with final coverage numbers

---

## 5. Coverage Scope Configuration (per package)

### `apps/worker/vitest.config.ts`

```typescript
coverage: {
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.d.ts"],
  thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
}
```

> Note: `src/index.ts` is the Hono router entrypoint (~540 lines). It contains route wiring AND inline middleware logic. If after testing it proves to be pure wiring with no branching logic worth testing, it can be moved to exclude. Audit during Wave 2.

### `apps/web/vitest.config.ts`

```typescript
coverage: {
  include: [
    "src/lib/**/*.ts",
    "src/viewmodels/**/*.ts",
    "src/hooks/**/*.ts",
    "src/auth.ts",
    "src/proxy.ts",
  ],
  exclude: [
    "src/**/*.d.ts",
    "src/components/**",
    "src/app/**",
    "src/contexts/**",
    "src/actions/**",
  ],
  thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
}
```

### `apps/admin/vitest.config.ts`

```typescript
coverage: {
  include: [
    "src/lib/**/*.ts",
    "src/viewmodels/**/*.ts",
    "src/hooks/**/*.ts",
    "src/auth.ts",
  ],
  exclude: [
    "src/**/*.d.ts",
    "src/components/**",
    "src/app/**",
  ],
  thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
}
```

### `packages/shared/vitest.config.ts`

```typescript
coverage: {
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.d.ts", "src/index.ts"],
  thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
}
```

### `packages/test-mocks/vitest.config.ts`

```typescript
coverage: {
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.d.ts", "src/index.ts"],
  thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
}
```

---

## 6. Scope Audit Checklist

Before ratcheting a package to 95%, verify each included source file is worth unit testing:

| Check | Question |
|-------|----------|
| **Has logic?** | Does the file contain branching, loops, or non-trivial transformations? (Barrel re-exports: exclude) |
| **Not pure wiring?** | Is it more than just connecting A to B? (Thin route handlers that only proxy to a handler: may exclude) |
| **Not a generated file?** | Auto-generated code should be excluded |
| **Not a type-only file?** | `.d.ts` and type-only `.ts` files excluded |
| **Testable in isolation?** | Can it be tested without a full server/browser environment? (If not: integration/E2E, not unit) |

Run this audit at the start of each package wave. Document any files moved to `exclude` with rationale.

---

## 7. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Vitest workspace mode | Native monorepo support; each project runs isolated with its own config, coverage, and environment |
| Per-package thresholds | Avoids averaging effect — each package must independently pass |
| 90% branch threshold (vs 95%) | V8 branch counting is generous (counts `??`, `&&`, `\|\|` as branches); 90% is pragmatic |
| Keep loader/verify in Bun | `bun:sqlite` has no Node equivalent without adding `better-sqlite3` dep |
| Exclude UI components | UI correctness validated by E2E/visual; unit testing shadcn wrappers adds noise not signal |
| Admin component tests non-gated | Existing admin component tests are smoke tests for rendering; not meaningful for logic coverage |
| `*.server.ts` files included | Server-side viewmodels contain real logic (data fetching, transformation) |
| Migrate test file locations | Colocating tests with their package makes ownership clear and enables independent CI |
| Scope audit before ratchet | Each included file must justify its unit-testability; avoids forcing tests on pure wiring code |
| `packages/test-mocks` gated independently | Already high coverage; dedicated commit satisfies per-package atomicity requirement |

---

## 8. Verification Checklist

After each wave, verify:

- [ ] `vitest run --project <name> --coverage` passes threshold
- [ ] No import resolution errors
- [ ] `bun run test` (root script) still runs all tests
- [ ] Pre-commit hook passes
- [ ] No dead/orphaned test files in old locations

Final gate (Wave 6):
- [ ] All 5 packages pass their respective thresholds
- [ ] `bun test tests/unit/loader.test.ts tests/unit/verify.test.ts` still passes
- [ ] `.husky/pre-push` updated to use workspace coverage
- [ ] `.github/workflows/ci.yml` test step uses `bun run test:coverage`
- [ ] This document updated with final actuals
