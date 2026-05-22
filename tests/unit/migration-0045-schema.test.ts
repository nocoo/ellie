import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for migration 0045 — forum_recommended_threads.
 *
 * Restores the per-forum "推荐主题" card driven by a (forum_id,
 * thread_id) allowlist plus a display-layer LIMIT 6 ORDER BY
 * thread_id DESC. The Worker layer reads this table on
 *   - `GET /api/v1/forums/:id/recommended-threads` (top card)
 *   - `thread.getById` (`isRecommended` EXISTS probe)
 * and writes it on `POST/DELETE /api/v1/moderation/threads/:id/recommend`
 * plus `moveThread` / `deleteThread` child cleanup.
 *
 * `forum_recommended_threads` is a runtime-only allowlist counter table
 * (same loader-stance pattern as `analytics_daily_targets` in
 * migration 0043). It is NOT imported by the MySQL→D1 loader; the
 * legacy Discuz rows are landed by a one-shot dry-run script
 * (`scripts/import-forum-recommended-threads-2026-05-22.ts`). The
 * loader mirrors at `packages/migrate/src/load/schema.ts` +
 * `scripts/migrate/load/schema.ts` therefore intentionally skip it.
 *
 * The schema MUST exist in 3 places:
 *
 *   1. apps/worker/migrations/0045_create_forum_recommended_threads.sql
 *      (applied via `wrangler d1 migrations apply` to live DBs)
 *   2. apps/worker/migrations/0000_init_schema.sql
 *      (baseline schema used to bootstrap new / test DBs)
 *   3. packages/db/src/schema.ts (TABLES + INDEXES)
 *      (used to bootstrap fresh DBs without replaying migrations)
 *
 * Structural invariants this guard pins:
 *
 *   - The composite PRIMARY KEY `(forum_id, thread_id)` is the
 *     `INSERT OR IGNORE` conflict target in
 *     `apps/worker/src/handlers/recommended.ts`. Dropping or
 *     reordering a PK column would silently break idempotence and
 *     either allow duplicate recommendations or reject valid
 *     toggles.
 *   - `idx_forum_recommended_threads_forum_tid (forum_id,
 *     thread_id DESC)` covers the display-layer `WHERE forum_id=?
 *     ORDER BY thread_id DESC LIMIT 6` read pattern; if the column
 *     order or DESC direction drifts the planner falls back to a
 *     full table read on every forum-page render.
 *   - All four columns (`forum_id`, `thread_id`, `recommended_at`,
 *     `recommended_by`) are `NOT NULL`. `recommended_by = 0` is the
 *     SYSTEM-IMPORT sentinel from the backfill script; live mod
 *     writes always pass the authenticated `users.id`. A NULL slip
 *     here would silently lose audit attribution.
 *
 * Both the table and the index MUST use `IF NOT EXISTS` because 0000
 * and 0045 carry the same DDL — wrangler replays 0000 first on a
 * fresh D1, and a bare `CREATE TABLE` in 0045 fails with
 * `SQLITE_ERROR: table forum_recommended_threads already exists`.
 * This guard pins that gotcha so a future "tidy up" amend cannot
 * accidentally regress the L2 migrate hook.
 */
describe("migration 0045 — forum_recommended_threads drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationPath = join(
		repoRoot,
		"apps/worker/migrations/0045_create_forum_recommended_threads.sql",
	);
	const baselinePath = join(repoRoot, "apps/worker/migrations/0000_init_schema.sql");
	const dbSchemaPath = join(repoRoot, "packages/db/src/schema.ts");

	const mirrorPaths: Array<{ label: string; path: string }> = [
		{ label: "migration 0045", path: migrationPath },
		{ label: "0000_init_schema.sql", path: baselinePath },
		{ label: "packages/db/src/schema.ts", path: dbSchemaPath },
	];

	// Match the table body across all three mirror styles. 0045 / 0000
	// emit plain SQL; packages/db/src/schema.ts wraps each DDL in a JS
	// template-literal so we anchor on the `CREATE TABLE` keyword and
	// the trailing `);` regardless of surrounding code. The `\)\s*;`
	// anchor is important because the body contains its own
	// `PRIMARY KEY (forum_id, thread_id)` inner parens — a non-greedy
	// `\)` alone would stop at the first inner `)` and the captured
	// body would be missing the PK row.
	const tableBody =
		/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?forum_recommended_threads\s*\(([\s\S]*?)\)\s*;/i;

	for (const { label, path } of mirrorPaths) {
		test(`${label} declares forum_recommended_threads table with the expected columns`, () => {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+forum_recommended_threads\s*\(/i);
			const m = src.match(tableBody);
			expect(m).not.toBeNull();
			const cols = m?.[1] ?? "";
			for (const col of ["forum_id", "thread_id", "recommended_at", "recommended_by"]) {
				expect(cols).toMatch(new RegExp(`\\b${col}\\b`));
			}
		});
	}

	test("composite PRIMARY KEY column order is (forum_id, thread_id)", () => {
		// `INSERT OR IGNORE INTO forum_recommended_threads ...` in
		// apps/worker/src/handlers/recommended.ts relies on this exact
		// PK tuple as the conflict target. Reordering to
		// (thread_id, forum_id) would still compile but a thread that
		// is recommended in two different forums would then be
		// permanently blocked from one of them.
		const pkPattern = /PRIMARY\s+KEY\s*\(\s*forum_id\s*,\s*thread_id\s*\)/i;
		for (const { label, path } of mirrorPaths) {
			const src = readFileSync(path, "utf8");
			const m = src.match(tableBody);
			expect(m).not.toBeNull();
			const body = m?.[1] ?? "";
			expect({ label, matches: pkPattern.test(body) }).toEqual({ label, matches: true });
		}
	});

	test("all four columns are NOT NULL in every mirror", () => {
		// `recommended_by = 0` is the SYSTEM-IMPORT sentinel; allowing
		// NULL here would erase the audit trail (mod click vs. legacy
		// import). The two id columns must be NOT NULL or the
		// composite PK is meaningless.
		const checks: Array<[string, RegExp]> = [
			["forum_id NOT NULL", /forum_id\s+INTEGER\s+NOT\s+NULL/i],
			["thread_id NOT NULL", /thread_id\s+INTEGER\s+NOT\s+NULL/i],
			["recommended_at NOT NULL", /recommended_at\s+INTEGER\s+NOT\s+NULL/i],
			["recommended_by NOT NULL", /recommended_by\s+INTEGER\s+NOT\s+NULL/i],
		];
		for (const [label, pat] of checks) {
			for (const { label: mirror, path } of mirrorPaths) {
				const src = readFileSync(path, "utf8");
				const m = src.match(tableBody);
				expect(m).not.toBeNull();
				const body = m?.[1] ?? "";
				expect({ mirror, col: label, matches: pat.test(body) }).toEqual({
					mirror,
					col: label,
					matches: true,
				});
			}
		}
	});

	const indexShapes: Array<{ name: string; pattern: RegExp }> = [
		{
			name: "idx_forum_recommended_threads_forum_tid",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_forum_recommended_threads_forum_tid[\s\S]*?ON\s+forum_recommended_threads\s*\(\s*forum_id\s*,\s*thread_id\s+DESC\s*\)/i,
		},
	];

	for (const { name, pattern } of indexShapes) {
		for (const { label, path } of mirrorPaths) {
			test(`${label} declares ${name} with (forum_id, thread_id DESC)`, () => {
				const src = readFileSync(path, "utf8");
				expect(src).toMatch(pattern);
			});
		}
	}

	test("table + index use IF NOT EXISTS in 0045 (coexists with 0000 mirror)", () => {
		// 0000_init_schema.sql carries the same DDL as a cumulative
		// mirror. On a fresh D1, wrangler applies 0000 first, then
		// 0045 — a bare `CREATE TABLE` / `CREATE INDEX` in 0045 would
		// fail with `SQLITE_ERROR: table already exists`, breaking
		// the L2 migrate hook in the pre-commit gate. This pin
		// prevents a future cleanup pass from regressing that.
		const src = readFileSync(migrationPath, "utf8");
		expect(src).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+forum_recommended_threads/i);
		expect(src).toMatch(
			/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_forum_recommended_threads_forum_tid/i,
		);
	});

	test("loader mirrors intentionally DO NOT declare forum_recommended_threads (runtime-only allowlist)", () => {
		// forum_recommended_threads is a moderator-driven allowlist
		// that lives only in the worker D1. The MySQL→D1 loader
		// scripts MUST NOT carry it — the legacy data lands via a
		// one-shot import script
		// (`scripts/import-forum-recommended-threads-2026-05-22.ts`)
		// that talks to the worker D1 directly. Same loader stance as
		// `analytics_daily_targets` (migration 0043). If a future
		// refactor adds it to the loader, the loader will either
		// fail (no MySQL source table to read FROM) or write stale
		// rows on every re-import.
		const loaderPaths = [
			join(repoRoot, "packages/migrate/src/load/schema.ts"),
			join(repoRoot, "scripts/migrate/load/schema.ts"),
		];
		for (const p of loaderPaths) {
			const src = readFileSync(p, "utf8");
			expect(src).not.toMatch(/\bforum_recommended_threads\b/);
		}
	});
});
