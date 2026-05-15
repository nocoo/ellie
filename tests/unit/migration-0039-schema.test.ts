import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Drift guard for migration 0039 — synthetic-id correction for
 * forum_thread_types.
 *
 * 0038 originally treated `forum_thread_types.id` as the imported Discuz
 * `typeid`. A dry-run on 2026-05-14 against
 * `reference/db/2026-05-14/db_tongji_main_full.sql.gz` proved Discuz
 * `typeid` is forum-LOCAL (typeid=1 reused across fid=111+113, typeid=2
 * across fid=113+134, typeid=0 in PUB fid=113), causing a UNIQUE
 * constraint failure on the single-PK table. 0039 splits the identity:
 *   • `id`              — D1 synthetic global id, minted by
 *                          `migrateForumThreadTypes` over the union of
 *                          (forumfield.types ∪ threadclass) source
 *                          typeids in (fid ASC, source_typeid ASC) order,
 *                          excluding source_typeid=0.
 *   • `source_typeid`   — Discuz local typeid preserved for admin/debug
 *                          and recovery. NEW column added by 0039.
 *   • UNIQUE(forum_id, source_typeid) — enforces the natural key and
 *                          catches double-mint regressions.
 *
 * Materializations that MUST stay in lockstep:
 *   1. apps/worker/migrations/0039_thread_categories_synthetic_id.sql
 *   2. packages/db/src/schema.ts
 *   3. packages/migrate/src/load/schema.ts
 *   4. scripts/migrate/load/schema.ts
 *
 * Replay path remains a single line: 0000 → ... → 0038 → 0039. CI / fresh
 * DBs MUST replay every migration in order; do NOT skip 0038 even though
 * 0039 supersedes its semantics, because the `_migrations` ledger needs
 * to stay sequential or it will drift from the live schema.
 */
describe("migration 0039 — synthetic-id correction drift guard", () => {
	const repoRoot = join(import.meta.dir, "..", "..");
	const migrationsDir = join(repoRoot, "apps/worker/migrations");
	const migrationPath = join(migrationsDir, "0039_thread_categories_synthetic_id.sql");
	const dbSchemaPath = join(repoRoot, "packages/db/src/schema.ts");
	const migrateLoaderPath = join(repoRoot, "packages/migrate/src/load/schema.ts");
	const scriptsLoaderPath = join(repoRoot, "scripts/migrate/load/schema.ts");

	const bootstrapPaths = [dbSchemaPath, migrateLoaderPath, scriptsLoaderPath];

	test("migration 0039 file exists and adds source_typeid column", () => {
		const sql = readFileSync(migrationPath, "utf8");
		expect(sql).toMatch(
			/ALTER\s+TABLE\s+forum_thread_types\s+ADD\s+COLUMN\s+source_typeid\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i,
		);
	});

	test("migration 0039 creates UNIQUE INDEX on (forum_id, source_typeid)", () => {
		const sql = readFileSync(migrationPath, "utf8");
		expect(sql).toMatch(
			/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_forum_thread_types_source[\s\S]*?ON\s+forum_thread_types\s*\(\s*forum_id\s*,\s*source_typeid\s*\)/i,
		);
	});

	test("bootstrap paths declare source_typeid column on forum_thread_types", () => {
		for (const path of bootstrapPaths) {
			const src = readFileSync(path, "utf8");
			// Anchor on the forum_thread_types CREATE TABLE block so a
			// stray `source_typeid` in a comment elsewhere can't satisfy
			// the assertion.
			const blockMatch = src.match(
				/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?forum_thread_types\s*\(([\s\S]*?)\)\s*[`;]/i,
			);
			expect(blockMatch).not.toBeNull();
			expect(blockMatch?.[1] ?? "").toMatch(/source_typeid\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i);
		}
	});

	test("bootstrap paths declare idx_forum_thread_types_source UNIQUE index", () => {
		for (const path of bootstrapPaths) {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(
				/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_forum_thread_types_source[\s\S]*?ON\s+forum_thread_types\s*\(\s*forum_id\s*,\s*source_typeid\s*\)/i,
			);
		}
	});

	test("load-path TABLE_COLUMNS include source_typeid for forum_thread_types", () => {
		// Without this entry the batch INSERT would write NULL/skip the
		// column, and admin/debug paths that reverse-resolve `(fid,
		// source_typeid)` would return rubbish.
		for (const path of [migrateLoaderPath, scriptsLoaderPath]) {
			const src = readFileSync(path, "utf8");
			expect(src).toMatch(/"source_typeid"/);
			// Sanity: the entry sits inside the forum_thread_types array.
			const arrMatch = src.match(/forum_thread_types:\s*\[([\s\S]*?)\]/);
			expect(arrMatch).not.toBeNull();
			expect(arrMatch?.[1] ?? "").toMatch(/"source_typeid"/);
		}
	});

	test("forum_thread_types PK stays plain INTEGER (no AUTOINCREMENT)", () => {
		// Same reviewer constraint as 0038: synthetic id allocation is
		// done by `migrateForumThreadTypes`; admin-created rows lean on
		// SQLite's plain `INTEGER PRIMARY KEY` (max(id)+1). AUTOINCREMENT
		// would steal a separate sqlite_sequence row and complicate the
		// reset path on re-import.
		for (const path of bootstrapPaths) {
			const src = readFileSync(path, "utf8");
			const blockMatch = src.match(
				/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?forum_thread_types\s*\([\s\S]*?\)\s*[`;]/i,
			);
			expect(blockMatch).not.toBeNull();
			expect(blockMatch?.[0] ?? "").not.toMatch(/AUTOINCREMENT/i);
		}
	});

	test("0039 ALTER survives a forum_thread_types table with one source_typeid=0 row per fid", () => {
		// Reviewer pin (3b432ac4 #2): the forward `ALTER TABLE ... ADD
		// COLUMN source_typeid INTEGER NOT NULL DEFAULT 0` is safe ONLY
		// when no single fid has multiple rows under 0038. The supported
		// path is empty / never-populated 0038 (prod) or single-row-per-
		// forum residue. Cross-forum rows that DEFAULT to 0 are still
		// distinct under (forum_id, source_typeid) because forum_id
		// differs, so the UNIQUE INDEX accepts them.
		const db = new Database(":memory:");
		try {
			// Bootstrap 0038 shape (id reused as Discuz typeid).
			db.exec(`
				CREATE TABLE forum_thread_types (
					id              INTEGER PRIMARY KEY,
					forum_id        INTEGER NOT NULL,
					name            TEXT    NOT NULL,
					display_order   INTEGER NOT NULL DEFAULT 0,
					icon            TEXT    NOT NULL DEFAULT '',
					enabled         INTEGER NOT NULL DEFAULT 1,
					moderator_only  INTEGER NOT NULL DEFAULT 0
				);
			`);
			// Cross-forum residue: typeid=1 reused across fid=111 and
			// fid=113 (the exact 0038 bug shape). Both rows DEFAULT to
			// source_typeid=0 after the bare ALTER ADD COLUMN, but
			// forum_id differs so the UNIQUE INDEX still passes.
			db.prepare("INSERT INTO forum_thread_types (id, forum_id, name) VALUES (?, ?, ?)").run(
				1,
				111,
				"Question",
			);
			db.prepare("INSERT INTO forum_thread_types (id, forum_id, name) VALUES (?, ?, ?)").run(
				2,
				113,
				"Answer",
			);

			// Apply 0039 ALTER + UNIQUE INDEX exactly as the migration writes them.
			const sql0039 = readFileSync(migrationPath, "utf8");
			expect(() => db.exec(sql0039)).not.toThrow();

			const rows = db
				.prepare("SELECT id, forum_id, source_typeid FROM forum_thread_types ORDER BY id")
				.all() as Array<{ id: number; forum_id: number; source_typeid: number }>;
			expect(rows).toEqual([
				{ id: 1, forum_id: 111, source_typeid: 0 },
				{ id: 2, forum_id: 113, source_typeid: 0 },
			]);
		} finally {
			db.close();
		}
	});

	test("0039 ALTER FAILS on out-of-scope populated 0038 (multiple rows in same fid)", () => {
		// Reviewer pin (3b432ac4 #2): explicitly pin the failure mode so
		// the supported scope is unambiguous. If a staging box somehow
		// inserted multiple rows for the same fid under 0038, the bare
		// ALTER + UNIQUE INDEX path will collide. There is no in-
		// migration backfill — the recovery path is to wipe the table
		// and re-run the migrate pipeline.
		const db = new Database(":memory:");
		try {
			db.exec(`
				CREATE TABLE forum_thread_types (
					id              INTEGER PRIMARY KEY,
					forum_id        INTEGER NOT NULL,
					name            TEXT    NOT NULL,
					display_order   INTEGER NOT NULL DEFAULT 0,
					icon            TEXT    NOT NULL DEFAULT '',
					enabled         INTEGER NOT NULL DEFAULT 1,
					moderator_only  INTEGER NOT NULL DEFAULT 0
				);
			`);
			// Two rows in the SAME fid — both DEFAULT to source_typeid=0
			// post-ALTER, which collides on the UNIQUE INDEX.
			db.prepare("INSERT INTO forum_thread_types (id, forum_id, name) VALUES (?, ?, ?)").run(
				1,
				111,
				"Question",
			);
			db.prepare("INSERT INTO forum_thread_types (id, forum_id, name) VALUES (?, ?, ?)").run(
				2,
				111,
				"Answer",
			);

			// Apply 0039 statements individually so errors on the UNIQUE
			// INDEX surface — `db.exec` on a multi-statement script can
			// swallow late errors.
			const sql0039 = readFileSync(migrationPath, "utf8");
			const statements = sql0039
				.split(/;\s*\n/)
				.map((s) => s.trim())
				.filter((s) => s && !s.split("\n").every((l) => l.startsWith("--") || l === ""));
			expect(() => {
				for (const stmt of statements) {
					db.exec(`${stmt};`);
				}
			}).toThrow(/UNIQUE|constraint/i);
		} finally {
			db.close();
		}
	});

	test("0039 ALTER would correctly reject duplicate (forum_id, source_typeid) inserts post-migration", () => {
		// Companion to the previous test — verifies the UNIQUE index is
		// actually enforcing the natural key, not just being present.
		const db = new Database(":memory:");
		try {
			db.exec(`
				CREATE TABLE forum_thread_types (
					id              INTEGER PRIMARY KEY,
					forum_id        INTEGER NOT NULL,
					name            TEXT    NOT NULL,
					display_order   INTEGER NOT NULL DEFAULT 0,
					icon            TEXT    NOT NULL DEFAULT '',
					enabled         INTEGER NOT NULL DEFAULT 1,
					moderator_only  INTEGER NOT NULL DEFAULT 0
				);
			`);
			db.exec(readFileSync(migrationPath, "utf8"));

			// Reverse-resolve scenario: a future double-mint that gives
			// the same (forum_id=200, source_typeid=5) twice should be
			// caught at INSERT time.
			db.prepare(
				"INSERT INTO forum_thread_types (id, forum_id, source_typeid, name) VALUES (?, ?, ?, ?)",
			).run(1, 200, 5, "First");
			expect(() =>
				db
					.prepare(
						"INSERT INTO forum_thread_types (id, forum_id, source_typeid, name) VALUES (?, ?, ?, ?)",
					)
					.run(2, 200, 5, "Dup"),
			).toThrow(/UNIQUE/i);
		} finally {
			db.close();
		}
	});

	test("CI replay 0000 → 0039 yields the synthetic-id forum_thread_types schema", () => {
		// Reviewer pin #2: dry-run / CI must validate that replaying every
		// migration end-to-end produces the synthetic-id final shape.
		// Replays via better-sqlite3 the entire `apps/worker/migrations`
		// directory in numeric order, then PRAGMA-introspects the result.
		const db = new Database(":memory:");
		try {
			const files = readdirSync(migrationsDir)
				.filter((f) => /^\d{4}_.*\.sql$/.test(f))
				.sort();
			expect(files).toContain("0038_thread_categories.sql");
			expect(files).toContain("0039_thread_categories_synthetic_id.sql");

			for (const f of files) {
				const sql = readFileSync(join(migrationsDir, f), "utf8");
				try {
					db.exec(sql);
				} catch (err) {
					throw new Error(`Replay failed at ${f}: ${(err as Error).message}`);
				}
			}

			// Schema introspection: forum_thread_types must have
			// source_typeid column.
			const cols = db.prepare("PRAGMA table_info(forum_thread_types)").all() as Array<{
				name: string;
				type: string;
				notnull: number;
				dflt_value: unknown;
			}>;
			const colNames = cols.map((c) => c.name);
			expect(colNames).toContain("id");
			expect(colNames).toContain("forum_id");
			expect(colNames).toContain("source_typeid");
			expect(colNames).toContain("name");

			const sourceCol = cols.find((c) => c.name === "source_typeid");
			expect(sourceCol).toBeDefined();
			expect(sourceCol?.type.toUpperCase()).toBe("INTEGER");
			expect(sourceCol?.notnull).toBe(1);
			expect(String(sourceCol?.dflt_value)).toBe("0");

			// UNIQUE INDEX must exist on (forum_id, source_typeid).
			const indexes = db.prepare("PRAGMA index_list(forum_thread_types)").all() as Array<{
				name: string;
				unique: number;
			}>;
			const uniqIdx = indexes.find((i) => i.name === "idx_forum_thread_types_source");
			expect(uniqIdx).toBeDefined();
			expect(uniqIdx?.unique).toBe(1);

			const idxCols = db
				.prepare("PRAGMA index_info(idx_forum_thread_types_source)")
				.all() as Array<{ seqno: number; name: string }>;
			expect(idxCols.map((c) => c.name)).toEqual(["forum_id", "source_typeid"]);
		} finally {
			db.close();
		}
	});

	test("CI replay matches packages/db bootstrap shape (no drift between paths)", () => {
		// Cross-check: a fresh DB built from packages/db/src/schema.ts
		// must produce the same forum_thread_types shape as a DB built by
		// replaying the migration chain. Otherwise newly-bootstrapped
		// test/dev DBs would differ from prod after replay.
		const replay = new Database(":memory:");
		const bootstrap = new Database(":memory:");
		try {
			const files = readdirSync(migrationsDir)
				.filter((f) => /^\d{4}_.*\.sql$/.test(f))
				.sort();
			for (const f of files) {
				replay.exec(readFileSync(join(migrationsDir, f), "utf8"));
			}

			// packages/db/src/schema.ts is a TS module exporting CREATE
			// TABLE strings. Pull the forum_thread_types block via regex
			// to avoid a dynamic import in a unit test, then exec it.
			const schemaSrc = readFileSync(dbSchemaPath, "utf8");
			const blockMatch = schemaSrc.match(
				/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?forum_thread_types\s*\([\s\S]*?\)\s*;/i,
			);
			expect(blockMatch).not.toBeNull();
			bootstrap.exec(blockMatch?.[0] ?? "");

			const replayCols = (
				replay.prepare("PRAGMA table_info(forum_thread_types)").all() as Array<{
					name: string;
					type: string;
					notnull: number;
				}>
			)
				.map((c) => `${c.name}:${c.type.toUpperCase()}:${c.notnull}`)
				.sort();
			const bootstrapCols = (
				bootstrap.prepare("PRAGMA table_info(forum_thread_types)").all() as Array<{
					name: string;
					type: string;
					notnull: number;
				}>
			)
				.map((c) => `${c.name}:${c.type.toUpperCase()}:${c.notnull}`)
				.sort();

			expect(bootstrapCols).toEqual(replayCols);
		} finally {
			replay.close();
			bootstrap.close();
		}
	});
});
