import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for migration 0042 — admin analytics auth-attempt audit log.
 *
 * Phase P4 of the admin analytics dashboard plan v3 (see #ellie-数据统计:010b1302)
 * persists one row per **observable** auth attempt in `login_history`.
 * The KPI card + masked detail list + audit-logged reveal endpoint all
 * read out of this table.
 *
 * `login_history` is a runtime-only audit table (same pattern as
 * `checkin_history` and `kv_cache_metrics_minute`) — it is NOT imported
 * from the legacy Discuz MySQL source. The loader mirrors at
 * `packages/migrate/src/load/schema.ts` + `scripts/migrate/load/schema.ts`
 * therefore intentionally skip it. The schema MUST exist in 3 places:
 *
 *   1. apps/worker/migrations/0042_create_login_history.sql
 *      (applied via `wrangler d1 migrations apply` to live DBs)
 *   2. apps/worker/migrations/0000_init_schema.sql
 *      (baseline schema used to bootstrap new / test DBs)
 *   3. packages/db/src/schema.ts (TABLES + INDEXES)
 *      (used to bootstrap fresh DBs without replaying migrations)
 *
 * Two structural invariants this guard pins:
 *
 *   - `user_id INTEGER` MUST be NULLABLE: failed-username login (user not
 *     found) and USERNAME_BANNED register attempts have no matching `users`
 *     row, so the audit row carries `user_id = NULL`. Adding `NOT NULL` to
 *     this column would silently drop those rows at insert time and would
 *     fail the auth.ts instrumentation contract.
 *   - `idx_login_history_error_created` is a PARTIAL index — the trailing
 *     `WHERE error_code != ''` clause is what keeps the active subset
 *     tight. A regression that drops the partial clause would explode the
 *     index to full-table size for no read win (the admin filter only
 *     ever queries the failure subset).
 */
describe("migration 0042 — login_history drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationPath = join(repoRoot, "apps/worker/migrations/0042_create_login_history.sql");
	const baselinePath = join(repoRoot, "apps/worker/migrations/0000_init_schema.sql");
	const dbSchemaPath = join(repoRoot, "packages/db/src/schema.ts");

	const mirrorPaths: Array<{ label: string; path: string }> = [
		{ label: "migration 0042", path: migrationPath },
		{ label: "0000_init_schema.sql", path: baselinePath },
		{ label: "packages/db/src/schema.ts", path: dbSchemaPath },
	];

	for (const { label, path } of mirrorPaths) {
		test(`${label} declares login_history table with the expected columns`, () => {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?login_history\s*\(/i);
			// Required columns — order is not material to correctness but
			// every name must be present. Inspect the body once.
			const body = src.match(
				/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?login_history\s*\(([\s\S]*?)\);/i,
			);
			expect(body).not.toBeNull();
			const cols = body?.[1] ?? "";
			for (const col of [
				"id",
				"user_id",
				"username",
				"ok",
				"kind",
				"error_code",
				"ip",
				"user_agent",
				"bot_class",
				"created_at",
			]) {
				expect(cols).toMatch(new RegExp(`\\b${col}\\b`));
			}
		});
	}

	test("user_id is NULLABLE in every mirror (failed-username / USERNAME_BANNED branches)", () => {
		// The `auth.ts` instrumentation writes `user_id = NULL` for branches
		// where no `users` row was matched (login: result === null;
		// register: censor.action === 'ban'). Adding `NOT NULL` here would
		// silently drop those rows. Scope the search to the login_history
		// table body — other tables (e.g. checkin_history) legitimately
		// declare `user_id INTEGER NOT NULL`.
		const tableBody = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?login_history\s*\(([\s\S]*?)\);/i;
		const forbidden = /user_id\s+INTEGER[^,\n]*\bNOT\s+NULL\b/i;
		for (const { label, path } of mirrorPaths) {
			const src = readFileSync(path, "utf8");
			const m = src.match(tableBody);
			expect(m).not.toBeNull();
			const body = m?.[1] ?? "";
			expect({ label, hasNotNull: forbidden.test(body) }).toEqual({
				label,
				hasNotNull: false,
			});
		}
	});

	test("username + ok + kind + created_at are NOT NULL in the login_history body of every mirror", () => {
		// These four are the minimum non-null set the auth instrumentation
		// always supplies. Dropping NOT NULL would let a buggy caller insert
		// rows that crash the KPI count-by GROUP BY. Scope to login_history
		// table body so unrelated tables in the same file don't satisfy this.
		const tableBody = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?login_history\s*\(([\s\S]*?)\);/i;
		const checks: Array<[string, RegExp]> = [
			["username NOT NULL", /username\s+TEXT\s+NOT\s+NULL/i],
			["ok NOT NULL", /ok\s+INTEGER\s+NOT\s+NULL/i],
			["kind NOT NULL", /kind\s+TEXT\s+NOT\s+NULL/i],
			["created_at NOT NULL", /created_at\s+INTEGER\s+NOT\s+NULL/i],
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
			name: "idx_login_history_created",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_login_history_created[\s\S]*?ON\s+login_history\s*\(\s*created_at\s+DESC\s*\)/i,
		},
		{
			name: "idx_login_history_user_created",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_login_history_user_created[\s\S]*?ON\s+login_history\s*\(\s*user_id\s*,\s*created_at\s+DESC\s*\)/i,
		},
		{
			name: "idx_login_history_kind_created",
			pattern:
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_login_history_kind_created[\s\S]*?ON\s+login_history\s*\(\s*kind\s*,\s*created_at\s+DESC\s*\)/i,
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

	test("idx_login_history_error_created is a PARTIAL index — WHERE clause non-negotiable", () => {
		// Without the partial WHERE the index would cover every successful
		// login (~one row per active visit), which inflates write cost and
		// gives the admin "失败明细" filter nothing back (the planner still
		// scans the same range). The shape below MUST match across all 3
		// mirrors so a fresh DB and a migrated DB stay byte-identical on
		// this query's plan.
		const partialIdx =
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_login_history_error_created[\s\S]*?ON\s+login_history\s*\(\s*error_code\s*,\s*created_at\s+DESC\s*\)[\s\S]*?WHERE\s+error_code\s*!=\s*''/i;
		for (const { label, path } of mirrorPaths) {
			const src = readFileSync(path, "utf8");
			expect({ label, matches: partialIdx.test(src) }).toEqual({ label, matches: true });
		}
	});

	test("loader mirrors intentionally DO NOT declare login_history (runtime-only audit table)", () => {
		// login_history is appended at runtime by the worker auth handlers
		// and lives only in the worker D1. The MySQL-import loader scripts
		// MUST NOT carry it — same pattern as checkin_history and
		// kv_cache_metrics_minute. If a future refactor adds it to the
		// loader, that loader will fail at runtime because there is no
		// MySQL source table to read FROM. This guard catches that drift.
		const loaderPaths = [
			join(repoRoot, "packages/migrate/src/load/schema.ts"),
			join(repoRoot, "scripts/migrate/load/schema.ts"),
		];
		for (const p of loaderPaths) {
			const src = readFileSync(p, "utf8");
			expect(src).not.toMatch(/\blogin_history\b/);
		}
	});
});
