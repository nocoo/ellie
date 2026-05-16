/**
 * Smoke test for scripts/fill-threads-from-dump.ts
 *
 * Builds a tiny gzipped MySQL-dump fixture containing pre_forum_thread INSERTs,
 * seeds a partial dry-run DB (forums + forum_thread_types populated, threads
 * empty), runs the loader, and verifies it lands `threads` rows with the
 * expected (forum_id, source_typeid) → synthetic id / type_name mapping.
 *
 * Why this test exists: production Step 4A requires that loader output for
 * `type_id<>0` exactly equals `type_name<>''` and 0 rows have one without the
 * other. We pin that invariant here on a controlled fixture.
 *
 * Invocation matches generate-thread-categories-import.test.ts style: a temp
 * seed script under bun:sqlite builds the DB and dump, then the loader runs
 * as a subprocess.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const TEST_DIR = join(tmpdir(), `fill-threads-test-${Date.now()}`);
const DB_PATH = join(TEST_DIR, "ellie.db");
const DUMP_PLAIN = join(TEST_DIR, "dump.sql");
const DUMP_GZ = join(TEST_DIR, "dump.sql.gz");
const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const LOADER = join(PROJECT_ROOT, "scripts/fill-threads-from-dump.ts");

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });

	// Seed a partial DB: forums + forum_thread_types populated; threads empty.
	// Schema columns match the real dry-run ellie.db (only what extractThread/
	// loader write). NOT NULL constraints with defaults so loader can insert
	// without forcing those columns.
	const seedScript = join(TEST_DIR, "seed.ts");
	const seedSource = `
import { Database } from "bun:sqlite";
const db = new Database(${JSON.stringify(DB_PATH)});
db.exec(\`
  CREATE TABLE forums (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE forum_thread_types (
    id INTEGER PRIMARY KEY,
    forum_id INTEGER NOT NULL,
    source_typeid INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE threads (
    id INTEGER PRIMARY KEY,
    forum_id INTEGER NOT NULL DEFAULT 0,
    author_id INTEGER NOT NULL DEFAULT 0,
    author_name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0,
    last_post_at INTEGER NOT NULL DEFAULT 0,
    last_poster TEXT NOT NULL DEFAULT '',
    replies INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    closed INTEGER NOT NULL DEFAULT 0,
    sticky INTEGER NOT NULL DEFAULT 0,
    digest INTEGER NOT NULL DEFAULT 0,
    special INTEGER NOT NULL DEFAULT 0,
    highlight INTEGER NOT NULL DEFAULT 0,
    recommends INTEGER NOT NULL DEFAULT 0,
    post_table_id INTEGER NOT NULL DEFAULT 0,
    type_name TEXT NOT NULL DEFAULT '',
    type_id INTEGER NOT NULL DEFAULT 0
  );

  INSERT INTO forums (id, name) VALUES (134, 'F134'), (147, 'F147');

  -- synthetic ids 1001/1002 in forum 134, 2001 in forum 147.
  -- source_typeid 999 in forum 134 is INTENTIONALLY missing so we can pin
  -- unmapped behavior (raw>0, synthetic=0 → type_id=0 / type_name='').
  INSERT INTO forum_thread_types (id, forum_id, source_typeid, name) VALUES
    (1001, 134, 5, 'O''Brien'),
    (1002, 134, 6, 'Plain'),
    (2001, 147, 1, 'Other');
\`);
db.close();
`;
	writeFileSync(seedScript, seedSource);
	execSync(`bun run ${seedScript}`, { cwd: PROJECT_ROOT, stdio: "pipe" });

	// Build a minimal mysqldump-style INSERT block. extractThread expects
	// 27 columns up to recommend_sub at index 26; we provide exactly 27.
	// Column layout (THREAD_COLS):
	//   0 tid, 1 fid, 2 posttableid, 3 typeid, 4 sortid, 5 readperm, 6 price,
	//   7 author, 8 authorid, 9 subject, 10 dateline, 11 lastpost,
	//   12 lastposter, 13 views, 14 replies, 15 displayorder, 16 highlight,
	//   17 digest, 18 rate, 19 special, 20 attachment, 21 moderated,
	//   22 closed, 23 stickreply, 24 recommends, 25 recommend_add,
	//   26 recommend_sub
	const row = (tid: number, fid: number, typeid: number, subject: string): string =>
		`(${tid},${fid},0,${typeid},0,0,0,'author','5','${subject}',0,0,'lp',0,0,0,0,0,0,0,0,0,0,0,0,0,0)`;
	const lines: string[] = [
		"-- minimal fixture for fill-threads-from-dump smoke test",
		// One INSERT line for pre_forum_thread (with multiple rows on it).
		`INSERT INTO \`pre_forum_thread\` VALUES ${[
			row(10, 134, 5, "t-10"), // mapped → 1001
			row(11, 134, 5, "t-11"), // mapped → 1001
			row(12, 134, 6, "t-12"), // mapped → 1002
			row(13, 134, 999, "t-13"), // raw>0 but no synthetic → unmapped
			row(14, 134, 0, "t-14"), // raw=0 → no type
		].join(",")};`,
		// And a sharded INSERT to verify loader walks shards too.
		`INSERT INTO \`pre_forum_thread_1\` VALUES ${[
			row(20, 147, 1, "t-20"), // mapped → 2001
			row(21, 147, 1, "t-21"), // mapped → 2001
		].join(",")};`,
	];
	writeFileSync(DUMP_PLAIN, `${lines.join("\n")}\n`);
	// gzip the dump. -k keeps original (not strictly needed but tidy).
	execSync(`gzip -f ${DUMP_PLAIN}`, { cwd: PROJECT_ROOT, stdio: "pipe" });
	if (!existsSync(DUMP_GZ)) {
		throw new Error(`expected ${DUMP_GZ} after gzip`);
	}
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

function runLoader(): { stdout: string; exitCode: number } {
	const cmd = ["bun", "run", LOADER, "--db", DB_PATH, "--dump", DUMP_GZ].join(" ");
	try {
		const stdout = execSync(cmd, { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 30_000 });
		return { stdout, exitCode: 0 };
	} catch (e) {
		const err = e as { status: number; stdout?: string; stderr?: string };
		return { stdout: (err.stdout ?? "") + (err.stderr ?? ""), exitCode: err.status ?? 1 };
	}
}

describe("fill-threads-from-dump.ts", () => {
	let stdout: string;

	beforeAll(() => {
		const result = runLoader();
		expect(result.exitCode, result.stdout).toBe(0);
		stdout = result.stdout;
	});

	test("loader logs mapping coverage counts", () => {
		// raw rows total 7, raw>0 positive typeid = 6 (one raw=0 row),
		// mapped = 5 (5+5+6+1+1), unmapped = 1 (the 999).
		expect(stdout).toMatch(/raw rows parsed\s+=\s*7/);
		expect(stdout).toMatch(/raw source typeid > 0\s+=\s*6/);
		expect(stdout).toMatch(/mapped \(synthetic id minted\)\s+=\s*5/);
		expect(stdout).toMatch(/unmapped \(raw>0, syn=0\)\s+=\s*1/);
	});

	test("threads table populated with the invariant: type_id<>0 == type_name<>''", () => {
		// Verify post-load DB state via a tiny bun probe (vitest has no
		// bun:sqlite). Output is JSON for clean assertions.
		const probeScript = join(TEST_DIR, "probe.ts");
		writeFileSync(
			probeScript,
			`
import { Database } from "bun:sqlite";
const db = new Database(${JSON.stringify(DB_PATH)}, { readonly: true });
const total = (db.query("SELECT count(*) AS c FROM threads").get() as {c:number}).c;
const typeIdNz = (db.query("SELECT count(*) AS c FROM threads WHERE type_id<>0").get() as {c:number}).c;
const typeNameNz = (db.query("SELECT count(*) AS c FROM threads WHERE type_name<>''").get() as {c:number}).c;
const idNzNameEmpty = (db.query("SELECT count(*) AS c FROM threads WHERE type_id<>0 AND type_name=''").get() as {c:number}).c;
const idZeroNameNz = (db.query("SELECT count(*) AS c FROM threads WHERE type_id=0 AND type_name<>''").get() as {c:number}).c;
const rows = db.query("SELECT id, forum_id, type_id, type_name FROM threads ORDER BY id").all();
console.log(JSON.stringify({ total, typeIdNz, typeNameNz, idNzNameEmpty, idZeroNameNz, rows }));
db.close();
`,
		);
		const out = execSync(`bun run ${probeScript}`, {
			cwd: PROJECT_ROOT,
			encoding: "utf-8",
		});
		const probe = JSON.parse(out) as {
			total: number;
			typeIdNz: number;
			typeNameNz: number;
			idNzNameEmpty: number;
			idZeroNameNz: number;
			rows: Array<{ id: number; forum_id: number; type_id: number; type_name: string }>;
		};
		expect(probe.total).toBe(7);
		expect(probe.typeIdNz).toBe(5);
		expect(probe.typeNameNz).toBe(5);
		// Invariant the reviewer pinned: 0 rows where one side is set and not the other.
		expect(probe.idNzNameEmpty).toBe(0);
		expect(probe.idZeroNameNz).toBe(0);
		// Spot-check mapping: thread 10/11 → synthetic 1001 'O'Brien'; 12 → 1002; 20/21 → 2001.
		const byId = new Map(probe.rows.map((r) => [r.id, r]));
		expect(byId.get(10)?.type_id).toBe(1001);
		expect(byId.get(10)?.type_name).toBe("O'Brien");
		expect(byId.get(11)?.type_id).toBe(1001);
		expect(byId.get(12)?.type_id).toBe(1002);
		expect(byId.get(12)?.type_name).toBe("Plain");
		// Unmapped row: raw typeid=999 has no synthetic → type_id 0 / name ''.
		expect(byId.get(13)?.type_id).toBe(0);
		expect(byId.get(13)?.type_name).toBe("");
		// Raw=0 row stays empty.
		expect(byId.get(14)?.type_id).toBe(0);
		expect(byId.get(14)?.type_name).toBe("");
		// Sharded INSERT picked up.
		expect(byId.get(20)?.type_id).toBe(2001);
		expect(byId.get(21)?.type_id).toBe(2001);
	});

	test("re-running loader against a non-empty threads table is refused", () => {
		// Refuse-non-empty guard: protects against accidental double-load.
		const result = runLoader();
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toMatch(/threads table already has 7 rows/);
	});
});
