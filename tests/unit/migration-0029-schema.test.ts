import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for Phase 4c (docs/17 §10.1, §12 phase 4c).
 *
 * The partial unique index `users_email_normalized_uniq` is the real
 * safety net behind the email-change endpoint (Phase 5). It MUST exist in
 * BOTH places that materialize the schema:
 *   1. apps/worker/migrations/0029_email_normalized_unique_index.sql
 *      (applied via `wrangler d1 migrations apply` to live DBs)
 *   2. packages/db/src/schema.ts
 *      (used to bootstrap fresh / test DBs without replaying migrations)
 *
 * If only one is updated, fresh DBs and migrated DBs diverge and the
 * email-change endpoint loses its uniqueness guarantee on whichever path
 * is missing the index — exactly the race §10.1 calls out. The shape also
 * matters: dropping `WHERE email_normalized != ''` would reject legacy /
 * cleared-duplicate rows that legitimately share the empty sentinel.
 */
describe("migration 0029 — users_email_normalized_uniq drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationPath = join(
		repoRoot,
		"apps/worker/migrations/0029_email_normalized_unique_index.sql",
	);
	const schemaPath = join(repoRoot, "packages/db/src/schema.ts");

	const migrationSql = readFileSync(migrationPath, "utf8");
	const schemaSrc = readFileSync(schemaPath, "utf8");

	test("migration declares CREATE UNIQUE INDEX with the partial WHERE", () => {
		expect(migrationSql).toMatch(
			/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?users_email_normalized_uniq[\s\S]*?ON\s+users\s*\(\s*email_normalized\s*\)[\s\S]*?WHERE\s+email_normalized\s*!=\s*''/i,
		);
	});

	test("packages/db/src/schema.ts mirrors the same unique partial index", () => {
		expect(schemaSrc).toMatch(
			/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?users_email_normalized_uniq[\s\S]*?ON\s+users\s*\(\s*email_normalized\s*\)[\s\S]*?WHERE\s+email_normalized\s*!=\s*''/i,
		);
	});

	test("partial WHERE clause is non-negotiable (would reject legacy '' rows otherwise)", () => {
		// A regression that dropped the WHERE turns the index into a full
		// uniqueness constraint, which fails the moment a second user has
		// no email — see Phase 4b cleanup output where 2355 cleared rows
		// share '' on purpose.
		expect(migrationSql).toMatch(/WHERE\s+email_normalized\s*!=\s*''/i);
		expect(schemaSrc).toMatch(/WHERE\s+email_normalized\s*!=\s*''/i);
	});
});
