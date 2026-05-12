import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for Phase D (checkin history).
 *
 * The `checkin_history` table created in migration 0036 is the per-day
 * audit log behind the public POST /api/v1/checkin handler and the future
 * admin recompute helper. It MUST exist in BOTH places that materialize
 * the schema:
 *   1. apps/worker/migrations/0036_create_checkin_history.sql
 *      (applied via `wrangler d1 migrations apply` to live DBs)
 *   2. packages/db/src/schema.ts
 *      (used to bootstrap fresh / test DBs without replaying migrations)
 *   3. apps/worker/migrations/0000_init_schema.sql
 *      (baseline schema used to build new instances incl. test DB)
 *
 * The composite PK `(user_id, date_local)` is the at-most-one-per-day
 * idempotency the public POST handler relies on via `ON CONFLICT(user_id,
 * date_local) DO NOTHING`. Dropping the PK or splitting it would let two
 * concurrent same-day requests both insert, breaking the streak invariant.
 *
 * The `idx_checkin_history_date` index covers admin date-range queries
 * (gap detection, "who checked in on day D") since the composite PK only
 * helps the per-user lookup path.
 */
describe("migration 0036 — checkin_history drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationPath = join(repoRoot, "apps/worker/migrations/0036_create_checkin_history.sql");
	const baselinePath = join(repoRoot, "apps/worker/migrations/0000_init_schema.sql");
	const schemaPath = join(repoRoot, "packages/db/src/schema.ts");

	const migrationSql = readFileSync(migrationPath, "utf8");
	const baselineSql = readFileSync(baselinePath, "utf8");
	const schemaSrc = readFileSync(schemaPath, "utf8");

	test("migration creates checkin_history with composite PK (user_id, date_local)", () => {
		expect(migrationSql).toMatch(
			/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?checkin_history[\s\S]*?PRIMARY\s+KEY\s*\(\s*user_id\s*,\s*date_local\s*\)/i,
		);
	});

	test("migration creates idx_checkin_history_date on date_local", () => {
		expect(migrationSql).toMatch(
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_checkin_history_date[\s\S]*?ON\s+checkin_history\s*\(\s*date_local\s*\)/i,
		);
	});

	test("baseline 0000_init_schema.sql mirrors checkin_history table + PK", () => {
		expect(baselineSql).toMatch(
			/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?checkin_history[\s\S]*?PRIMARY\s+KEY\s*\(\s*user_id\s*,\s*date_local\s*\)/i,
		);
		expect(baselineSql).toMatch(
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_checkin_history_date[\s\S]*?ON\s+checkin_history\s*\(\s*date_local\s*\)/i,
		);
	});

	test("packages/db/src/schema.ts mirrors checkin_history table + PK + index", () => {
		expect(schemaSrc).toMatch(
			/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?checkin_history[\s\S]*?PRIMARY\s+KEY\s*\(\s*user_id\s*,\s*date_local\s*\)/i,
		);
		expect(schemaSrc).toMatch(
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_checkin_history_date[\s\S]*?ON\s+checkin_history\s*\(\s*date_local\s*\)/i,
		);
	});

	test("date_local column typed as TEXT in all three places (Asia/Shanghai YYYY-MM-DD)", () => {
		// Storing day as TEXT keeps the unique constraint trivial and
		// timezone-stable. A regression to INTEGER would break the
		// `ON CONFLICT(user_id, date_local) DO NOTHING` contract relied on
		// by the public POST handler.
		const dateLocalText = /date_local\s+TEXT\s+NOT\s+NULL/i;
		expect(migrationSql).toMatch(dateLocalText);
		expect(baselineSql).toMatch(dateLocalText);
		expect(schemaSrc).toMatch(dateLocalText);
	});
});
