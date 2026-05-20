import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for migration 0041 — admin analytics trend indexes.
 *
 * Phase 1 of the admin analytics dashboard (see #ellie-数据统计 plan v3)
 * relies on time-bucket aggregation against existing source-of-truth
 * business tables (`users`, `posts`, `threads`). Without dedicated
 * time-leading indexes the trend queries fall back to full-table scans:
 *   - users:   ~270k rows, no `reg_date` index pre-0041
 *   - posts:   ~14M rows, `idx_posts_author (author_id, created_at)` is
 *              author-leading so it cannot answer a global time-bucket
 *              query
 *   - threads: ~990k rows, `idx_threads_author` is author-leading and
 *              `idx_threads_latest` is on `last_post_at` (not
 *              `created_at`), so neither can answer a `created_at`
 *              window
 *
 * Migration 0041 adds four indexes; each MUST exist in every place that
 * materializes the schema:
 *   1. apps/worker/migrations/0041_idx_analytics_trend.sql
 *      (applied via `wrangler d1 migrations apply` to live DBs)
 *   2. apps/worker/migrations/0000_init_schema.sql
 *      (baseline schema used to bootstrap new / test DBs)
 *   3. packages/db/src/schema.ts
 *      (used to bootstrap fresh DBs without replaying migrations)
 *   4. packages/migrate/src/load/schema.ts
 *      + scripts/migrate/load/schema.ts
 *      (load-from-MySQL migration paths)
 *
 * If any one drifts, that bootstrap path silently regresses the admin
 * analytics trend endpoints back to full-table scans — a failure mode
 * (slow but correct) that no functional test would catch.
 */
describe("migration 0041 — admin analytics trend indexes drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationPath = join(repoRoot, "apps/worker/migrations/0041_idx_analytics_trend.sql");
	const baselinePath = join(repoRoot, "apps/worker/migrations/0000_init_schema.sql");
	const dbSchemaPath = join(repoRoot, "packages/db/src/schema.ts");
	const migrateLoaderPath = join(repoRoot, "packages/migrate/src/load/schema.ts");
	const scriptsLoaderPath = join(repoRoot, "scripts/migrate/load/schema.ts");

	// Each index shape:
	// - leading column must match what the trend query filters on so the
	//   planner can do an index range scan.
	// - DESC ordering on time columns matches the natural recency of the
	//   trend window — streaming reads stay sequential.
	const indexShapes: Array<{ name: string; pattern: RegExp }> = [
		{
			name: "idx_users_reg_date",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_users_reg_date[\s\S]*?ON\s+users\s*\(\s*reg_date\s*\)/i,
		},
		{
			name: "idx_posts_created",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_posts_created[\s\S]*?ON\s+posts\s*\(\s*created_at\s+DESC\s*\)/i,
		},
		{
			name: "idx_posts_forum_created",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_posts_forum_created[\s\S]*?ON\s+posts\s*\(\s*forum_id\s*,\s*created_at\s+DESC\s*\)/i,
		},
		{
			name: "idx_threads_created",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_threads_created[\s\S]*?ON\s+threads\s*\(\s*created_at\s+DESC\s*\)/i,
		},
	];

	const mirrorPaths: Array<{ label: string; path: string }> = [
		{ label: "migration 0041", path: migrationPath },
		{ label: "0000_init_schema.sql", path: baselinePath },
		{ label: "packages/db/src/schema.ts", path: dbSchemaPath },
		{ label: "packages/migrate/src/load/schema.ts", path: migrateLoaderPath },
		{ label: "scripts/migrate/load/schema.ts", path: scriptsLoaderPath },
	];

	for (const { name, pattern } of indexShapes) {
		for (const { label, path } of mirrorPaths) {
			test(`${label} declares ${name}`, () => {
				const src = readFileSync(path, "utf8");
				expect(src).toMatch(pattern);
			});
		}
	}

	test("idx_posts_forum_created column order is non-negotiable — forum_id must lead", () => {
		// A regression that put created_at first would make per-forum
		// trend queries (`WHERE forum_id=? AND created_at>=?`) fall back
		// to either a forum-scan or a separate sort — both kill the
		// streaming index-only plan that the dashboard depends on.
		const stmt =
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_posts_forum_created\b[^;)]*?ON\s+posts\s*\(([^)]*)\)/i;
		for (const { path } of mirrorPaths) {
			const src = readFileSync(path, "utf8");
			const m = src.match(stmt);
			expect(m).not.toBeNull();
			const cols = m?.[1] ?? "";
			// First column inside the parens must be `forum_id`.
			expect(cols.trim()).toMatch(/^forum_id\b/i);
		}
	});
});
