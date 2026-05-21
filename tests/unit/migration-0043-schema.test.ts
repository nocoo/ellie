import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for migration 0043 — admin analytics page-view aggregate.
 *
 * Phase P5 of the admin analytics dashboard plan v3 (see
 * #ellie-数据统计:010b1302) persists per-(date_local, path_kind,
 * target_id, user_id, bot_class) page-view counters in
 * `analytics_daily_targets`. The KPI card + list panel of the admin
 * "今日访问名单" feature read out of this table.
 *
 * `analytics_daily_targets` is a runtime-only counter table (same
 * pattern as `login_history`, `checkin_history`, and
 * `kv_cache_metrics_minute`) — it is NOT imported from the legacy
 * Discuz MySQL source. The loader mirrors at
 * `packages/migrate/src/load/schema.ts` + `scripts/migrate/load/schema.ts`
 * therefore intentionally skip it. The schema MUST exist in 3 places:
 *
 *   1. apps/worker/migrations/0043_create_analytics_daily_targets.sql
 *      (applied via `wrangler d1 migrations apply` to live DBs)
 *   2. apps/worker/migrations/0000_init_schema.sql
 *      (baseline schema used to bootstrap new / test DBs)
 *   3. packages/db/src/schema.ts (TABLES + INDEXES)
 *      (used to bootstrap fresh DBs without replaying migrations)
 *
 * Three structural invariants this guard pins:
 *
 *   - The composite PRIMARY KEY `(date_local, path_kind, target_id,
 *     user_id, bot_class)` is the UPSERT conflict target for the D1
 *     flush sink (`apps/worker/src/lib/analytics/flushSink-d1.ts`).
 *     Dropping or reordering a PK column would silently break the
 *     `INSERT ... ON CONFLICT(...)` shape and either double-count or
 *     reject inserts.
 *   - `idx_analytics_daily_targets_list` covers the list endpoint's
 *     `WHERE date_local=? AND path_kind=?` scan; if the column order
 *     drifts the planner falls back to full-table scans.
 *   - `idx_analytics_daily_targets_last_seen` is the retention sweep
 *     index — the 48h cron handler runs `DELETE WHERE last_seen_at <
 *     cutoff`; missing this index turns the daily DELETE into a
 *     full-table scan.
 */
describe("migration 0043 — analytics_daily_targets drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationPath = join(
		repoRoot,
		"apps/worker/migrations/0043_create_analytics_daily_targets.sql",
	);
	const baselinePath = join(repoRoot, "apps/worker/migrations/0000_init_schema.sql");
	const dbSchemaPath = join(repoRoot, "packages/db/src/schema.ts");

	const mirrorPaths: Array<{ label: string; path: string }> = [
		{ label: "migration 0043", path: migrationPath },
		{ label: "0000_init_schema.sql", path: baselinePath },
		{ label: "packages/db/src/schema.ts", path: dbSchemaPath },
	];

	const tableBody =
		/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?analytics_daily_targets\s*\(([\s\S]*?)\);/i;

	for (const { label, path } of mirrorPaths) {
		test(`${label} declares analytics_daily_targets table with the expected columns`, () => {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(
				/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?analytics_daily_targets\s*\(/i,
			);
			const m = src.match(tableBody);
			expect(m).not.toBeNull();
			const cols = m?.[1] ?? "";
			for (const col of [
				"date_local",
				"path_kind",
				"target_id",
				"user_id",
				"bot_class",
				"count",
				"first_seen_at",
				"last_seen_at",
			]) {
				expect(cols).toMatch(new RegExp(`\\b${col}\\b`));
			}
		});
	}

	test("composite PRIMARY KEY column order is (date_local, path_kind, target_id, user_id, bot_class)", () => {
		// The UPSERT conflict target in apps/worker/src/lib/analytics/
		// flushSink-d1.ts MUST exactly match this PK column tuple — if
		// the migration PK reorders, the worker's `ON CONFLICT(...)`
		// clause silently stops matching and inserts begin to fail
		// (or worse, double-count).
		const pkPattern =
			/PRIMARY\s+KEY\s*\(\s*date_local\s*,\s*path_kind\s*,\s*target_id\s*,\s*user_id\s*,\s*bot_class\s*\)/i;
		for (const { label, path } of mirrorPaths) {
			const src = readFileSync(path, "utf8");
			const m = src.match(tableBody);
			expect(m).not.toBeNull();
			const body = m?.[1] ?? "";
			expect({ label, matches: pkPattern.test(body) }).toEqual({ label, matches: true });
		}
	});

	test("count + first_seen_at + last_seen_at are NOT NULL in every mirror", () => {
		// `count` defaults to 0 and is `+=`'d by the UPSERT; the seen-at
		// columns are required so retention + KPI window queries always
		// have a comparable timestamp. NULLability here would let a
		// buggy caller insert a row that the cron sweep cannot evict.
		const checks: Array<[string, RegExp]> = [
			["count NOT NULL", /count\s+INTEGER\s+NOT\s+NULL/i],
			["first_seen_at NOT NULL", /first_seen_at\s+INTEGER\s+NOT\s+NULL/i],
			["last_seen_at NOT NULL", /last_seen_at\s+INTEGER\s+NOT\s+NULL/i],
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
			name: "idx_analytics_daily_targets_list",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_analytics_daily_targets_list[\s\S]*?ON\s+analytics_daily_targets\s*\(\s*date_local\s*,\s*path_kind\s*,\s*target_id\s*\)/i,
		},
		{
			name: "idx_analytics_daily_targets_last_seen",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_analytics_daily_targets_last_seen[\s\S]*?ON\s+analytics_daily_targets\s*\(\s*last_seen_at\s*\)/i,
		},
	];

	for (const { name, pattern } of indexShapes) {
		for (const { label, path } of mirrorPaths) {
			test(`${label} declares ${name}`, () => {
				const src = readFileSync(path, "utf8");
				expect(src).toMatch(pattern);
			});
		}
	}

	test("loader mirrors intentionally DO NOT declare analytics_daily_targets (runtime-only counter table)", () => {
		// analytics_daily_targets is an in-isolate collector → D1 sink
		// runtime counter; it lives only in the worker D1. The
		// MySQL-import loader scripts MUST NOT carry it — same pattern
		// as login_history, checkin_history, and
		// kv_cache_metrics_minute. If a future refactor adds it to the
		// loader, that loader will fail at runtime because there is no
		// MySQL source table to read FROM. This guard catches that
		// drift before it ships.
		const loaderPaths = [
			join(repoRoot, "packages/migrate/src/load/schema.ts"),
			join(repoRoot, "scripts/migrate/load/schema.ts"),
		];
		for (const p of loaderPaths) {
			const src = readFileSync(p, "utf8");
			expect(src).not.toMatch(/\banalytics_daily_targets\b/);
		}
	});
});
