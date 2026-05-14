import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for migration 0038 — Discuz 主题分类 (thread categories).
 *
 * Restores per-forum category configuration that lived in PHP-serialized
 * `pre_forum_forumfield.threadtypes` plus `pre_forum_threadclass`, plus the
 * per-thread `pre_forum_thread.typeid` column. The migration adds:
 *   • threads.type_id INTEGER NOT NULL DEFAULT 0
 *   • forums.thread_types_{enabled,required,listable,prefix} INTEGER
 *   • new table forum_thread_types (PK = Discuz typeid)
 *   • idx_forum_thread_types_forum (forum_id, display_order, id)
 *   • idx_threads_forum_type (forum_id, type_id, last_post_at DESC, id DESC)
 *
 * Materializations that MUST stay in lockstep with the migration:
 *   1. apps/worker/migrations/0038_thread_categories.sql
 *      (applied via `wrangler d1 migrations apply` to live DBs)
 *   2. packages/db/src/schema.ts
 *      (used to bootstrap fresh DBs without replaying migrations)
 *   3. packages/migrate/src/load/schema.ts
 *      + scripts/migrate/load/schema.ts
 *      (load-from-MySQL migration paths — must include the new columns
 *      so dry-run loads don't crash on missing-column inserts)
 *
 * `apps/worker/migrations/0000_init_schema.sql` deliberately does NOT
 * mirror ALTER-added columns from later migrations (same convention as
 * 0024_add_campus_field / 0026_add_has_avatar / 0032_add_coins): a
 * fresh DB replays the full migration chain 0000 → 0038, and inlining
 * the columns into 0000 would make 0038's `ALTER TABLE ... ADD COLUMN`
 * fail with `duplicate column name`. The drift guard for the baseline
 * therefore only checks the migration file itself for these columns;
 * the canonical/load-path schemas (which are read at runtime by
 * `packages/db` and the migrate scripts) are required to mirror the
 * final shape so newly-bootstrapped DBs match prod after replay.
 *
 * If any one of the canonical/load-path schemas drifts the bootstrap
 * path silently breaks: a fresh test DB without `thread_types_enabled`
 * would fail Worker handlers; a load-path schema missing
 * `forum_thread_types` would drop the entire category dataset on
 * re-import without any functional test catching it.
 */
describe("migration 0038 — thread categories drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationPath = join(repoRoot, "apps/worker/migrations/0038_thread_categories.sql");
	const dbSchemaPath = join(repoRoot, "packages/db/src/schema.ts");
	const migrateLoaderPath = join(repoRoot, "packages/migrate/src/load/schema.ts");
	const scriptsLoaderPath = join(repoRoot, "scripts/migrate/load/schema.ts");

	// Schema materializations that must mirror the migration's final
	// shape via inline CREATE TABLE form. The baseline 0000 migration
	// is excluded deliberately — see header comment.
	const bootstrapPaths = [dbSchemaPath, migrateLoaderPath, scriptsLoaderPath];

	test("migration 0038 declares threads.type_id ALTER", () => {
		const sql = readFileSync(migrationPath, "utf8");
		expect(sql).toMatch(
			/ALTER\s+TABLE\s+threads\s+ADD\s+COLUMN\s+type_id\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i,
		);
	});

	test("migration 0038 declares 4 forums thread_types_* columns", () => {
		const sql = readFileSync(migrationPath, "utf8");
		for (const col of [
			"thread_types_enabled",
			"thread_types_required",
			"thread_types_listable",
			"thread_types_prefix",
		]) {
			expect(sql).toMatch(
				new RegExp(
					`ALTER\\s+TABLE\\s+forums\\s+ADD\\s+COLUMN\\s+${col}\\s+INTEGER\\s+NOT\\s+NULL\\s+DEFAULT\\s+0`,
					"i",
				),
			);
		}
	});

	test("migration 0038 creates forum_thread_types with id as plain PK (no AUTOINCREMENT)", () => {
		const sql = readFileSync(migrationPath, "utf8");
		expect(sql).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?forum_thread_types/i);
		// Reviewer constraint: PK reuses Discuz typeid → cannot be
		// AUTOINCREMENT (would steal the rowid space and break id reuse).
		// SQLite's plain `INTEGER PRIMARY KEY` already auto-allocates from
		// max(id)+1 for admin-created rows.
		const tableMatch = sql.match(/CREATE\s+TABLE[\s\S]*?forum_thread_types[\s\S]*?\);/i);
		expect(tableMatch).not.toBeNull();
		expect(tableMatch?.[0] ?? "").not.toMatch(/AUTOINCREMENT/i);
	});

	test("migration 0038 declares both indexes", () => {
		const sql = readFileSync(migrationPath, "utf8");
		expect(sql).toMatch(
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_forum_thread_types_forum[\s\S]*?ON\s+forum_thread_types\s*\(\s*forum_id\s*,\s*display_order\s*,\s*id\s*\)/i,
		);
		expect(sql).toMatch(
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_threads_forum_type[\s\S]*?ON\s+threads\s*\(\s*forum_id\s*,\s*type_id\s*,\s*last_post_at\s+DESC\s*,\s*id\s+DESC\s*\)/i,
		);
	});

	test("bootstrap paths declare threads.type_id", () => {
		for (const path of bootstrapPaths) {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(/type_id\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i);
		}
	});

	test("bootstrap paths declare all 4 forums.thread_types_* columns", () => {
		for (const path of bootstrapPaths) {
			const src = readFileSync(path, "utf8");
			for (const col of [
				"thread_types_enabled",
				"thread_types_required",
				"thread_types_listable",
				"thread_types_prefix",
			]) {
				expect(src).toMatch(new RegExp(`${col}\\s+INTEGER\\s+NOT\\s+NULL\\s+DEFAULT\\s+0`, "i"));
			}
		}
	});

	test("bootstrap paths declare forum_thread_types CREATE TABLE", () => {
		for (const path of bootstrapPaths) {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?forum_thread_types/i);
			// No AUTOINCREMENT on the forum_thread_types PK — same
			// reviewer constraint as the migration. Anchor specifically on
			// the forum_thread_types block so unrelated AUTOINCREMENT tables
			// (ip_bans, etc.) earlier in the file don't trip the regex.
			const blockMatch = src.match(
				/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?forum_thread_types\s*\([\s\S]*?\)\s*[`;]/i,
			);
			expect(blockMatch).not.toBeNull();
			expect(blockMatch?.[0] ?? "").not.toMatch(/AUTOINCREMENT/i);
		}
	});

	test("bootstrap paths declare idx_forum_thread_types_forum", () => {
		for (const path of bootstrapPaths) {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(
				/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_forum_thread_types_forum[\s\S]*?ON\s+forum_thread_types\s*\(\s*forum_id\s*,\s*display_order\s*,\s*id\s*\)/i,
			);
		}
	});

	test("bootstrap paths declare idx_threads_forum_type with correct column order", () => {
		// Column order is non-negotiable: leading (forum_id, type_id) is
		// the equality probe for /api/v1/threads?forumId=X&typeId=Y;
		// trailing (last_post_at DESC, id DESC) lets the streamer skip a
		// sort step. A regression that put type_id or last_post_at first
		// would silently kill the planner's ability to use this index.
		const shape =
			/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_threads_forum_type[\s\S]*?ON\s+threads\s*\(\s*forum_id\s*,\s*type_id\s*,\s*last_post_at\s+DESC\s*,\s*id\s+DESC\s*\)/i;
		for (const path of bootstrapPaths) {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(shape);
		}
	});

	test("type_id is plain INTEGER, NOT a FOREIGN KEY (reviewer constraint)", () => {
		// Threads with `enabled=0` (tombstone) categories must keep their
		// typeName resolvable, and an admin-deleted category should not
		// orphan thousands of threads. Asserting absence of a FK clause
		// on type_id pins this guarantee against silent drift to a
		// stricter schema.
		//
		// Locate the `type_id` line / ALTER explicitly, then check the
		// rest of THAT statement for REFERENCES. We deliberately do not
		// regex over arbitrary blocks because comments / unrelated FKs
		// (e.g. forum_thread_types.forum_id REFERENCES forums(id)) would
		// give false positives.
		for (const path of [migrationPath, ...bootstrapPaths]) {
			const src = readFileSync(path, "utf8");
			// Match either a CREATE-TABLE column definition line
			// (`type_id ... ,` / `type_id ... )`) or an ALTER ADD COLUMN
			// type_id statement. Capture just the statement scope.
			const stmtMatches = src.matchAll(
				/(?:^|[\n,])\s*type_id\s+INTEGER[^,;)\n]*|ALTER\s+TABLE\s+threads\s+ADD\s+COLUMN\s+type_id[^;]*/gi,
			);
			let saw = false;
			for (const m of stmtMatches) {
				saw = true;
				expect(m[0]).not.toMatch(/REFERENCES/i);
			}
			expect(saw).toBe(true);
		}
	});

	test("load-path TABLE_COLUMNS include new forums + threads columns", () => {
		// The load path enumerates columns explicitly for batch INSERTs.
		// Forgetting to add the new columns here would silently leave
		// them at DEFAULT 0 even when the source data has values, so
		// drift-guard at the array level too.
		for (const path of [migrateLoaderPath, scriptsLoaderPath]) {
			const src = readFileSync(path, "utf8");
			for (const col of [
				"thread_types_enabled",
				"thread_types_required",
				"thread_types_listable",
				"thread_types_prefix",
			]) {
				expect(src).toMatch(new RegExp(`"${col}"`));
			}
			expect(src).toMatch(/"type_id"/);
			expect(src).toMatch(/forum_thread_types:\s*\[/);
		}
	});
});
