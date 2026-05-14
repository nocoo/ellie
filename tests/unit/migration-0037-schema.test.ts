import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for migration 0037 — idx_threads_sticky.
 *
 * Phase 1 of 全站公告 widens the `/api/v1/threads?forumId=X` WHERE
 * clause from `forum_id = ?` to `(forum_id = ? OR sticky = 2)` so a
 * sticky=2 announcement appears on every forum's list. Without a
 * sticky-leading index the OR forces SQLite/D1 to fall back to a
 * covering scan of `idx_threads_forum`, which on prod D1 measured
 * ~77ms COUNT / ~51ms SELECT against ~986k threads. This migration
 * adds `idx_threads_sticky(sticky, last_post_at DESC, id DESC)` so
 * the planner can use a MULTI-INDEX OR plan instead.
 *
 * The index MUST exist in every place that materializes the schema:
 *   1. apps/worker/migrations/0037_idx_threads_sticky.sql
 *      (applied via `wrangler d1 migrations apply` to live DBs)
 *   2. apps/worker/migrations/0000_init_schema.sql
 *      (baseline schema used to bootstrap new / test DBs)
 *   3. packages/db/src/schema.ts
 *      (used to bootstrap fresh DBs without replaying migrations)
 *   4. packages/migrate/src/load/schema.ts
 *      + scripts/migrate/load/schema.ts
 *      (load-from-MySQL migration paths)
 *
 * If any one drifts, that bootstrap path silently regresses the
 * thread-list endpoint back to a full-table scan — and the failure
 * mode (slow but correct) would never trip a functional test.
 */
describe("migration 0037 — idx_threads_sticky drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationPath = join(repoRoot, "apps/worker/migrations/0037_idx_threads_sticky.sql");
	const baselinePath = join(repoRoot, "apps/worker/migrations/0000_init_schema.sql");
	const dbSchemaPath = join(repoRoot, "packages/db/src/schema.ts");
	const migrateLoaderPath = join(repoRoot, "packages/migrate/src/load/schema.ts");
	const scriptsLoaderPath = join(repoRoot, "scripts/migrate/load/schema.ts");

	// (sticky, last_post_at DESC, id DESC) — leading equality column on
	// `sticky` is required for MULTI-INDEX OR; trailing pair matches
	// the read query's ORDER BY (CASE WHEN sticky=2 THEN 4 ELSE sticky
	// END DESC, last_post_at DESC, id DESC) so streaming reads stay
	// index-only on the sticky branch.
	const indexShape =
		/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_threads_sticky[\s\S]*?ON\s+threads\s*\(\s*sticky\s*,\s*last_post_at\s+DESC\s*,\s*id\s+DESC\s*\)/i;

	test("migration 0037 declares the sticky+last_post_at+id index", () => {
		const sql = readFileSync(migrationPath, "utf8");
		expect(sql).toMatch(indexShape);
	});

	test("baseline 0000_init_schema.sql mirrors the same index", () => {
		const sql = readFileSync(baselinePath, "utf8");
		expect(sql).toMatch(indexShape);
	});

	test("packages/db/src/schema.ts mirrors the same index", () => {
		const src = readFileSync(dbSchemaPath, "utf8");
		expect(src).toMatch(indexShape);
	});

	test("packages/migrate/src/load/schema.ts mirrors the same index", () => {
		const src = readFileSync(migrateLoaderPath, "utf8");
		expect(src).toMatch(indexShape);
	});

	test("scripts/migrate/load/schema.ts mirrors the same index", () => {
		const src = readFileSync(scriptsLoaderPath, "utf8");
		expect(src).toMatch(indexShape);
	});

	test("column order is non-negotiable — sticky must lead so MULTI-INDEX OR is usable", () => {
		// A regression that put forum_id or last_post_at first would
		// silently kill the MULTI-INDEX OR plan: SQLite needs an
		// equality probe on the leading column to enter index range
		// scan on the sticky=2 side of the OR.
		//
		// We anchor the search to the `idx_threads_sticky` statement
		// itself (terminated by `)` or end-of-line) so unrelated
		// indexes that happen to lead with forum_id (e.g. the
		// 0038 idx_threads_forum_type) cannot satisfy the regex.
		const stickyStmt =
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_threads_sticky\b[^;)]*?ON\s+threads\s*\(([^)]*)\)/i;
		for (const path of [
			migrationPath,
			baselinePath,
			dbSchemaPath,
			migrateLoaderPath,
			scriptsLoaderPath,
		]) {
			const src = readFileSync(path, "utf8");
			const m = src.match(stickyStmt);
			expect(m).not.toBeNull();
			const cols = m?.[1] ?? "";
			// First column inside the parens must be `sticky`.
			expect(cols.trim()).toMatch(/^sticky\b/i);
		}
	});
});
