# Autoresearch Rules — L3 (Playwright) coverage growth & stability

## Goal
Grow the **passing L3 (browser E2E) test count** while keeping the suite
**stable** (no regressions in previously-passing tests). The starting baseline
suffers from Turbopack cold-compile cascades that time-out heavy routes; the
first job is to stabilise the existing suite, then add new cases that exercise
under-covered user journeys.

## Primary Metric
- `passing_l3` — number of L3 specs that ended in `passed` per
  `bun scripts/bench-l3.ts`.
- Higher is better.

## Secondary Metrics (monitoring)
- `failing_l3` — must **not** regress against the running best. A keep is only
  valid if `failing_l3` ≤ best-so-far.
- `flaky_l3` — runs that needed a retry. Treat increases as suspicious.
- `total_l3`, `skipped_l3` — sanity.

## Scope
- Forum-side L3 only (`tests/e2e/*.spec.ts`, projects `stateless` + `stateful`).
- Admin L3 (`tests/e2e/admin/*.spec.ts`) needs a separate dev server on
  :7032 and is **excluded from the bench**. Admin spec additions are still
  welcome but must be sanity-checked manually with `bun run test:e2e:admin`
  before keeping.

## Hard Gates (must pass)
1. Bench runs to completion and the JSON report is produced.
2. `passing_l3` must not decrease. If a change makes a previously-passing test
   regress, discard it.
3. `failing_l3` must not increase.
4. New spec files MUST be additive — do **not** modify existing spec files
   except to fix obvious flakes (e.g. selector races) or to upgrade outdated
   selectors. Document any such fix in the commit body.

## Anti-Cheating Guardrails
- Do not add tests that assert nothing useful (`expect(true).toBe(true)`,
  trivial `expect(page).toBeTruthy()`).
- Do not skip / xfail tests to boost the passing count.
- Do not raise expect/test timeouts to mask real product regressions. Timeout
  bumps are only acceptable as part of an explicit Turbopack cold-compile
  stabilisation (e.g. a server prewarm step). Document the rationale.
- New tests must hit real product code paths and assert visible behaviour
  (page text, navigation outcome, network response). No mocking of the dev
  server.
- Do **not** modify `scripts/bench-l3.ts` or `playwright.config.ts` to
  artificially count more tests. Changes to those files must keep the same
  measurement semantics (status == "passed" => +1).
- Do **not** make the bench cheaper (e.g. by filtering to a subset of specs).

## Useful Commands
- Bench: `bun scripts/bench-l3.ts`
- Single spec dev cycle:
  `bun run scripts/run-l3.ts -g "<grep>" --reporter=list`
- Full forum L3 (manual): `bun run test:e2e:browser`
- Admin L3 (manual, separate server on :7032): `bun run test:e2e:admin`
- L1 sanity (occasional): `bun run test`

## Backpressure Checks
`autoresearch.checks.sh` runs lightweight gates that catch obvious breakage
without paying the full bench cost twice:
- typecheck (`bash scripts/typecheck.sh`)
- biome lint on the touched test files (best-effort)

## Notes / Known Issues
- Turbopack first-compile of `/forums/[id]`, `/threads/[id]`, `/users/[id]`,
  `/me`, `/search` can exceed Playwright's default 30 s navigation timeout in
  parallel runs. The first stabilisation iteration prewarms those routes
  after the dev server is ready (`scripts/run-l3.ts`).
- The bench is intentionally tolerant of failures — it always reports the
  metric. The autoresearch operator must reject runs where `failing_l3`
  regresses.
