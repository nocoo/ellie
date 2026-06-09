/**
 * Smoke test for scripts/generate-thread-categories-import.ts
 *
 * Builds a tiny SQLite fixture with hand-picked rows that exercise every
 * artifact the reviewer asked me to pin (msg cc346d4d):
 *
 *   001 — only `UPDATE threads SET type_id=0, type_name=''` (no other tables).
 *   002 — only `UPDATE forums SET thread_types_*` (no other forums columns).
 *   003 — explicit id + source_typeid, single-quote escape on name/icon.
 *   004 — `UPDATE threads SET type_id=?, type_name=? WHERE id IN (...)` only
 *         for mapped threads; type_name escape correct; type_id=0 rows skipped.
 *   manifest.expectedThreadUpdates == sum(004 covered IDs).
 *
 * The generator is invoked as a subprocess (matches generate-d1-sql.test.ts
 * style) against a temp DB; we then read each artifact and assert on shape.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const TEST_DIR = join(tmpdir(), `thread-cat-gen-test-${Date.now()}`);
const DB_PATH = join(TEST_DIR, "dry-run.db");
const OUT_DIR = join(TEST_DIR, "output");
// PROJECT_ROOT: walk up from packages/migrate/tests/ to monorepo root so the
// generator's `import .../packages/migrate/...` path resolves correctly.
const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const GENERATOR = join(PROJECT_ROOT, "scripts/generate-thread-categories-import.ts");

interface ManifestFile {
	name: string;
	targetTable: string;
	statements: number | string;
	updates: number | string;
}
interface Manifest {
	generatedAt: string;
	sourceDb: string;
	notes: string[];
	counts: {
		forumThreadTypesTotal: number;
		forumThreadTypesEnabled: number;
		forumsTotal: number;
		forumsWithThreadTypeFlags: number;
		threadsTypeIdNonZero: number;
		threadsTypeIdNonZeroNameEmpty: number;
		threadsTypeIdZeroNameNonEmpty: number;
		expectedThreadUpdates: number;
		actualThreadUpdates: number;
	};
	files: ManifestFile[];
}

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });
	// Build dry-run-style schema with just the columns the generator reads.
	// Done via a temp bun script (vitest runs under node, no bun:sqlite).
	const seedScript = join(TEST_DIR, "seed.ts");
	const seedSource = `
import { Database } from "bun:sqlite";
const db = new Database(${JSON.stringify(DB_PATH)});
db.exec(\`
  CREATE TABLE forums (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    thread_types_enabled  INTEGER NOT NULL DEFAULT 0,
    thread_types_required INTEGER NOT NULL DEFAULT 0,
    thread_types_listable INTEGER NOT NULL DEFAULT 0,
    thread_types_prefix   INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE forum_thread_types (
    id              INTEGER PRIMARY KEY,
    forum_id        INTEGER NOT NULL,
    source_typeid   INTEGER NOT NULL DEFAULT 0,
    name            TEXT NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    icon            TEXT NOT NULL DEFAULT '',
    enabled         INTEGER NOT NULL DEFAULT 1,
    moderator_only  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE threads (
    id INTEGER PRIMARY KEY,
    type_id INTEGER NOT NULL DEFAULT 0,
    type_name TEXT NOT NULL DEFAULT ''
  );

  INSERT INTO forums (id, name, thread_types_enabled, thread_types_required, thread_types_listable, thread_types_prefix) VALUES
    (134, 'F134', 1, 1, 1, 1),
    (147, 'F147', 1, 0, 1, 0),
    (200, 'F200', 0, 0, 0, 0);

  INSERT INTO forum_thread_types (id, forum_id, source_typeid, name, display_order, icon, enabled, moderator_only) VALUES
    (1001, 134, 5, 'O''Brien''s Topic', 1, 'http://cdn/icon''.png', 1, 0),
    (1002, 134, 6, 'Plain', 2, '', 1, 0),
    (1003, 147, 1, 'Other', 1, '', 1, 0),
    (1004, 147, 2, 'Disabled', 2, '', 0, 0);

  INSERT INTO threads (id, type_id, type_name) VALUES
    (10, 1001, 'O''Brien''s Topic'),
    (11, 1001, 'O''Brien''s Topic'),
    (12, 1002, 'Plain'),
    (20, 1003, 'Other'),
    (21, 1003, 'Other'),
    (30, 0, ''),
    (31, 0, '');
\`);
db.close();
`;
	writeFileSync(seedScript, seedSource);
	execSync(`bun run ${seedScript}`, { cwd: PROJECT_ROOT, stdio: "pipe" });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

function runGenerator(): { stdout: string; exitCode: number } {
	// Use a fresh output dir per run; remove any leftovers from prior failed
	// attempts so the generator's "refuse non-empty out dir" guard doesn't
	// false-trip.
	if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
	const cmd = [
		"bun",
		"run",
		GENERATOR,
		"--db",
		DB_PATH,
		"--out",
		OUT_DIR,
		// Force smaller chunking so we can exercise multi-file behavior even
		// with the tiny fixture (3 forum_thread_types per file, 1 stmt per file).
		"--forum-thread-type-chunk-size",
		"3",
		"--thread-chunk-size",
		"2",
	].join(" ");
	try {
		const stdout = execSync(cmd, { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 30_000 });
		return { stdout, exitCode: 0 };
	} catch (e) {
		const err = e as { status: number; stdout?: string; stderr?: string };
		return { stdout: (err.stdout ?? "") + (err.stderr ?? ""), exitCode: err.status ?? 1 };
	}
}

describe("generate-thread-categories-import.ts", () => {
	let manifest: Manifest;
	let sql001: string;
	let sql002: string;
	let sql003Files: { name: string; body: string }[];
	let sql004Files: { name: string; body: string }[];

	beforeAll(() => {
		const result = runGenerator();
		expect(result.exitCode, result.stdout).toBe(0);
		const all = readdirSync(OUT_DIR).sort();
		manifest = JSON.parse(readFileSync(join(OUT_DIR, "manifest.json"), "utf-8")) as Manifest;
		sql001 = readFileSync(join(OUT_DIR, "001-clear-stale-thread-types.sql"), "utf-8");
		sql002 = readFileSync(join(OUT_DIR, "002-forums-thread-type-config.sql"), "utf-8");
		sql003Files = all
			.filter((f) => f.startsWith("003-"))
			.map((name) => ({ name, body: readFileSync(join(OUT_DIR, name), "utf-8") }));
		sql004Files = all
			.filter((f) => f.startsWith("004-"))
			.map((name) => ({ name, body: readFileSync(join(OUT_DIR, name), "utf-8") }));
	});

	test("001 only updates threads.type_id/type_name on stale rows", () => {
		// Exactly one UPDATE statement; no other DDL/DML.
		const lines = sql001
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && !l.startsWith("--"));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe(
			"UPDATE threads SET type_id = 0, type_name = '' WHERE type_id <> 0 OR type_name <> '';",
		);
		// Must NOT touch any other table or column.
		expect(sql001).not.toMatch(/forum_thread_types|forums|DELETE|CREATE|DROP|ALTER/i);
	});

	test("002 only updates forums.thread_types_* — no other forums columns, one row per forum", () => {
		const stmts = sql002
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.startsWith("UPDATE"));
		// One UPDATE per forum in the fixture (3 forums).
		expect(stmts).toHaveLength(3);
		for (const s of stmts) {
			// Must start with the four-column SET and end with WHERE id=N.
			expect(s).toMatch(
				/^UPDATE forums SET thread_types_enabled=\d+, thread_types_required=\d+, thread_types_listable=\d+, thread_types_prefix=\d+ WHERE id=\d+;$/,
			);
		}
		// And touches nothing else.
		expect(sql002).not.toMatch(/threads|forum_thread_types|DELETE|CREATE|DROP|ALTER/i);
		// Spot-check the F134 row (1,1,1,1).
		expect(stmts).toContain(
			"UPDATE forums SET thread_types_enabled=1, thread_types_required=1, thread_types_listable=1, thread_types_prefix=1 WHERE id=134;",
		);
	});

	test("003 emits explicit id + source_typeid, escapes single-quoted name/icon", () => {
		expect(sql003Files.length).toBeGreaterThanOrEqual(1);
		const allBody = sql003Files.map((f) => f.body).join("\n");
		// Strip comment lines for the "doesn't touch other tables" check so
		// explanatory headers (which may contain words like DELETE) don't
		// trip the guard.
		const allBodyCode = allBody
			.split("\n")
			.filter((l) => !l.trim().startsWith("--"))
			.join("\n");
		// O'Brien escaping: each ' doubled → ''.
		expect(allBody).toContain("'O''Brien''s Topic'");
		expect(allBody).toContain("'http://cdn/icon''.png'");
		// Each INSERT must include explicit id and source_typeid (no AUTOINCREMENT).
		const inserts = allBody
			.split("\n")
			.filter((l) => l.startsWith("INSERT INTO forum_thread_types"));
		expect(inserts).toHaveLength(4);
		for (const ins of inserts) {
			expect(ins).toMatch(
				/^INSERT INTO forum_thread_types \(id, forum_id, source_typeid, name, display_order, icon, enabled, moderator_only\) VALUES /,
			);
			expect(ins).toMatch(/ON CONFLICT\(id\) DO UPDATE SET /);
		}
		// 003 code must NOT touch threads/forums/other tables (DO UPDATE is fine).
		expect(allBodyCode).not.toMatch(/UPDATE threads|UPDATE forums|DELETE|CREATE|DROP|ALTER/i);
	});

	test("004 only updates mapped threads — IN-list form, type_id=0 rows skipped, type_name escaped", () => {
		expect(sql004Files.length).toBeGreaterThanOrEqual(1);
		const allBody = sql004Files.map((f) => f.body).join("\n");
		const allBodyCode = allBody
			.split("\n")
			.filter((l) => !l.trim().startsWith("--"))
			.join("\n");
		const stmts = allBodyCode.split("\n").filter((l) => l.startsWith("UPDATE threads"));
		// Every statement must match the strict shape.
		for (const s of stmts) {
			expect(s).toMatch(
				/^UPDATE threads SET type_id=\d+, type_name=('([^']|'')*') WHERE id IN \(\d+(,\d+)*\);$/,
			);
		}
		// type_id=0 threads (ids 30, 31) must NOT appear in any IN-list.
		expect(allBodyCode).not.toMatch(/\b30\b/);
		expect(allBodyCode).not.toMatch(/\b31\b/);
		// Mapped IDs all present. Tighten regex to digit-only IN-lists so a
		// `IN (...)` literal inside a header comment can't slip in.
		const idList = allBodyCode.match(/IN \(([\d,]+)\)/g) ?? [];
		const allIds = idList.flatMap((m) =>
			m
				.replace(/IN \(|\)/g, "")
				.split(",")
				.map((x) => Number(x.trim())),
		);
		expect(allIds.sort((a, b) => a - b)).toEqual([10, 11, 12, 20, 21]);
		// type_name escape: O''Brien''s Topic must appear escaped.
		expect(allBody).toContain("'O''Brien''s Topic'");
		// 004 code must NOT touch other tables (header comment is excluded).
		expect(allBodyCode).not.toMatch(/forum_thread_types|UPDATE forums|DELETE|CREATE|DROP|ALTER/i);
	});

	test("manifest expectedThreadUpdates == sum of 004 covered IDs", () => {
		// Both keys are populated by the generator and MUST agree before we
		// even consider running Step 4B remotely; mismatch implies the
		// chunking dropped or double-counted IDs.
		expect(manifest.counts.expectedThreadUpdates).toBe(5);
		expect(manifest.counts.actualThreadUpdates).toBe(5);
		// And manifest summarizes the dry-run input correctly.
		expect(manifest.counts.forumThreadTypesTotal).toBe(4);
		expect(manifest.counts.forumThreadTypesEnabled).toBe(3);
		expect(manifest.counts.forumsTotal).toBe(3);
		expect(manifest.counts.forumsWithThreadTypeFlags).toBe(2);
		expect(manifest.counts.threadsTypeIdNonZero).toBe(5);
		// File ordering: 001, 002, then 003-* and 004-* chunks.
		const names = manifest.files.map((f) => f.name);
		expect(names[0]).toBe("001-clear-stale-thread-types.sql");
		expect(names[1]).toBe("002-forums-thread-type-config.sql");
		expect(names.filter((n) => n.startsWith("003-")).length).toBeGreaterThanOrEqual(1);
		expect(names.filter((n) => n.startsWith("004-")).length).toBeGreaterThanOrEqual(1);
	});
});
