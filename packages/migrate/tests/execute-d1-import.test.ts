/**
 * Tests for execute-d1-import.ts
 *
 * Unit tests validate shared logic exported from d1-sql-builder.ts:
 *   IMPORT_TABLE_ORDER, FK_RELATIONS, isValidChunkFilename,
 *   computeManifestFingerprint, validateManifestStructure, buildFkCheckQuery
 *
 * Subprocess tests create temp fixtures (manifest + chunk files + fake npx)
 * and run the executor script, verifying exit codes, stdout, and
 * execution-log.json. The fake npx binary is injected via EXECUTOR_NPX_BIN
 * to avoid calling real wrangler.
 *
 * Covers reviewer-required scenarios:
 *   1. Table order follows FK dependency
 *   2. FK_RELATIONS includes all 9 canonical checks
 *   3. Path traversal rejection (chunks + tables.files)
 *   4. Missing chunk file rejection
 *   5. Dry-run doesn't call wrangler
 *   6. Resume fingerprint mismatch rejection
 *   7. Resume skips matching done chunks
 *   8. Failure writes failed log and stops
 *   9. Manifest structural validation (tables.files ↔ chunks)
 *  10. SHA-256 fingerprint sensitivity
 */

import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Manifest } from "../src/load/d1-sql-builder";
import {
	FK_RELATIONS,
	IMPORT_TABLE_ORDER,
	buildFkCheckQuery,
	computeManifestFingerprint,
	isValidChunkFilename,
	isWarningOnly,
	validateManifestStructure,
} from "../src/load/d1-sql-builder";

const TEST_DIR = join(tmpdir(), `d1-exec-test-${Date.now()}`);
const PROJECT_ROOT = join(__dirname, "..");
const FAKE_NPX_PATH = join(TEST_DIR, "fake-npx");
const SOURCE_DB_PATH = join(TEST_DIR, "source.db");

/** Minimal valid manifest factory. */
function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
	return {
		generated_at: "2026-05-09T00:00:00Z",
		source_db: "test.db",
		chunk_size: 5000,
		production_state: {
			captured_at: "2026-05-09T00:00:00Z",
			database: { name: "test-db", id: "test-id-123" },
			backup: {
				path: "test.sql",
				size_gb: 0.1,
				tables_included: [],
				tables_excluded: [],
			},
			tables: {
				forums: { count: 2, max_id: 2 },
				users: { count: 3, max_id: 3 },
			},
		},
		total_chunks: 2,
		total_rows: 5,
		tables: {
			forums: {
				strategy: "upsert",
				prod_max_id: null,
				source_total_rows: 2,
				source_rows_after_max: null,
				chunks: 1,
				rows: 2,
				files: ["forums-001.sql"],
			},
			users: {
				strategy: "upsert",
				prod_max_id: null,
				source_total_rows: 3,
				source_rows_after_max: null,
				chunks: 1,
				rows: 3,
				files: ["users-001.sql"],
			},
		},
		chunks: [
			{
				file: "forums-001.sql",
				table: "forums",
				rows: 2,
				bytes: 100,
				strategy: "upsert" as const,
				pk_list: [1, 2],
			},
			{
				file: "users-001.sql",
				table: "users",
				rows: 3,
				bytes: 150,
				strategy: "upsert" as const,
				pk_list: [1, 2, 3],
			},
		],
		...overrides,
	};
}

/** Create fixture directory with manifest and optional chunk SQL files / execution log. */
function setupFixture(
	name: string,
	manifest: Manifest,
	opts?: { createChunks?: boolean; executionLog?: object },
): string {
	const dir = join(TEST_DIR, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, "\t"));

	if (opts?.createChunks !== false) {
		for (const chunk of manifest.chunks) {
			if (isValidChunkFilename(chunk.file)) {
				writeFileSync(join(dir, chunk.file), `-- ${chunk.file}\nSELECT 1;\n`);
			}
		}
	}

	if (opts?.executionLog) {
		writeFileSync(join(dir, "execution-log.json"), JSON.stringify(opts.executionLog, null, "\t"));
	}

	return join(dir, "manifest.json");
}

/**
 * Run the executor as a subprocess.
 * Uses EXECUTOR_NPX_BIN to inject the fake npx script when env.fakeMode is set.
 */
function runExecutor(
	manifestPath: string,
	args: string[] = [],
	env?: { fakeMode?: string },
): { stdout: string; exitCode: number } {
	const cmd = [
		"bun",
		"run",
		join(PROJECT_ROOT, "src/execute-d1-import.ts"),
		"--manifest",
		manifestPath,
		...args,
	].join(" ");
	const extraEnv: Record<string, string> = {};
	if (env?.fakeMode) {
		extraEnv.EXECUTOR_NPX_BIN = FAKE_NPX_PATH;
		extraEnv.FAKE_WRANGLER_MODE = env.fakeMode;
	}
	try {
		const stdout = execSync(cmd, {
			encoding: "utf-8",
			cwd: PROJECT_ROOT,
			timeout: 30_000,
			env: { ...process.env, ...extraEnv },
		});
		return { stdout, exitCode: 0 };
	} catch (e) {
		const err = e as { status: number; stdout?: string; stderr?: string };
		return {
			stdout: `${err.stdout ?? ""}${err.stderr ?? ""}`,
			exitCode: err.status ?? 1,
		};
	}
}

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });

	// Create fake npx script that simulates wrangler behavior.
	// Controlled by FAKE_WRANGLER_MODE env var:
	//   succeed   — exit 0; --json queries return mock results
	//   fail-exec — exit 1 for --file (chunk execution), exit 0 for --command (verification)
	// FK orphan queries (containing "NOT IN") return cnt=0, others return cnt=100.
	// When --file is passed, verifies the SQL file exists — catches CWD/path resolution bugs.
	const fakeScript = `#!/bin/bash
MODE="\${FAKE_WRANGLER_MODE:-succeed}"
has_flag() { local f="$1"; shift; for a in "$@"; do [[ "$a" == "$f" ]] && return 0; done; return 1; }
args_contain() { local n="$1"; shift; for a in "$@"; do [[ "$a" == *"$n"* ]] && return 0; done; return 1; }
get_flag_value() { local f="$1"; shift; while [[ $# -gt 0 ]]; do if [[ "$1" == "$f" && -n "$2" ]]; then echo "$2"; return; fi; shift; done; }
emit_json() {
  if args_contain "NOT IN" "$@"; then
    echo '[{"results":[{"cnt":0}]}]'
  elif args_contain " IN (" "$@"; then
    # Count PKs in the IN clause: count commas + 1
    local sql
    for a in "$@"; do
      if [[ "$a" == *" IN ("* ]]; then sql="$a"; break; fi
    done
    if [[ -n "$sql" ]]; then
      local in_part
      in_part=$(echo "$sql" | sed 's/.*IN (//' | sed 's/).*//')
      local cnt
      cnt=$(echo "$in_part" | tr ',' '\\n' | wc -l | tr -d ' ')
      echo "[{\\"results\\":[{\\"cnt\\":$cnt}]}]"
    else
      echo '[{"results":[{"cnt":100,"max_id":100000}]}]'
    fi
  elif args_contain "COUNT" "$@"; then
    echo '[{"results":[{"cnt":100,"max_id":100000}]}]'
  elif args_contain "SELECT " "$@"; then
    # Sample field query — return fixture data matching the source DB per ID
    local sql
    for a in "$@"; do
      if [[ "$a" == *"SELECT "* ]]; then sql="$a"; break; fi
    done
    # Extract the WHERE id/user_id value
    local qid
    qid=$(echo "$sql" | sed -n 's/.*WHERE [a-z_]*=\\([0-9]*\\).*/\\1/p')
    if [[ "$sql" == *"forums"* ]]; then
      case "$qid" in
        1) echo '[{"results":[{"name":"test-forum","description":"test-desc","display_order":1}]}]' ;;
        2) echo '[{"results":[{"name":"test-forum-2","description":"test-desc-2","display_order":2}]}]' ;;
        *) echo '[{"results":[{}]}]' ;;
      esac
    elif [[ "$sql" == *"users"* ]]; then
      case "$qid" in
        1) echo '[{"results":[{"username":"user-1","coins":100,"has_avatar":0,"campus":"test-campus"}]}]' ;;
        2) echo '[{"results":[{"username":"user-2","coins":200,"has_avatar":1,"campus":"campus-2"}]}]' ;;
        3) echo '[{"results":[{"username":"user-3","coins":300,"has_avatar":0,"campus":"campus-3"}]}]' ;;
        *) echo '[{"results":[{}]}]' ;;
      esac
    else
      echo '[{"results":[{}]}]'
    fi
  else
    echo '[{"results":[{"cnt":100,"max_id":100000}]}]'
  fi
}
# Verify --file path exists (regression: projectRoot miscalculation made paths unresolvable)
if has_flag "--file" "$@"; then
  FILE_PATH=$(get_flag_value "--file" "$@")
  if [[ -n "$FILE_PATH" && ! -f "$FILE_PATH" ]]; then
    echo "Unable to read SQL text file \\"$FILE_PATH\\". CWD=$(pwd)" >&2
    exit 1
  fi
fi
case "$MODE" in
  succeed)
    if has_flag "--json" "$@"; then emit_json "$@"; fi
    exit 0
    ;;
  fail-exec)
    if has_flag "--file" "$@"; then
      echo "Error: simulated wrangler execution failure" >&2
      exit 1
    fi
    if has_flag "--json" "$@"; then emit_json "$@"; fi
    exit 0
    ;;
  warning-only)
    if has_flag "--file" "$@"; then
      echo "WARNING: This process may take some time, during which your D1 database will be unavailable to serve queries." >&2
      exit 1
    fi
    if has_flag "--json" "$@"; then emit_json "$@"; fi
    exit 0
    ;;
  warning-pk-mismatch)
    if has_flag "--file" "$@"; then
      echo "WARNING: This process may take some time, during which your D1 database will be unavailable to serve queries." >&2
      exit 1
    fi
    if has_flag "--json" "$@"; then
      if args_contain " IN " "$@"; then
        echo '[{"results":[{"cnt":0}]}]'
      else
        emit_json "$@"
      fi
    fi
    exit 0
    ;;
  warning-error)
    if has_flag "--file" "$@"; then
      echo "WARNING: This process may take some time, during which your D1 database will be unavailable to serve queries." >&2
      echo "Error: SQLITE_CONSTRAINT: UNIQUE constraint failed" >&2
      exit 1
    fi
    if has_flag "--json" "$@"; then emit_json "$@"; fi
    exit 0
    ;;
  warning-sample-mismatch)
    if has_flag "--file" "$@"; then
      echo "WARNING: This process may take some time, during which your D1 database will be unavailable to serve queries." >&2
      exit 1
    fi
    if has_flag "--json" "$@"; then
      # Return correct PK count but wrong field values for samples
      local sql
      for a in "$@"; do
        if [[ "$a" == *"SELECT "* || "$a" == *"COUNT"* || "$a" == *" IN ("* ]]; then sql="$a"; break; fi
      done
      if [[ "$sql" == *" IN ("* ]]; then
        # PK count — return correct count
        local in_part
        in_part=$(echo "$sql" | sed 's/.*IN (//' | sed 's/).*//')
        local cnt
        cnt=$(echo "$in_part" | tr ',' '\\n' | wc -l | tr -d ' ')
        echo "[{\\"results\\":[{\\"cnt\\":$cnt}]}]"
      elif [[ "$sql" == *"COUNT"* ]]; then
        echo '[{"results":[{"cnt":100,"max_id":100000}]}]'
      elif [[ "$sql" == *"forums"* ]]; then
        echo '[{"results":[{"name":"WRONG-NAME","description":"wrong","display_order":999}]}]'
      elif [[ "$sql" == *"users"* ]]; then
        echo '[{"results":[{"username":"WRONG-USER","coins":0,"has_avatar":1,"campus":"wrong"}]}]'
      else
        echo '[{"results":[{}]}]'
      fi
    fi
    exit 0
    ;;
esac
echo "Error: unknown FAKE_WRANGLER_MODE=$MODE" >&2
exit 1
`;
	writeFileSync(FAKE_NPX_PATH, fakeScript);
	chmodSync(FAKE_NPX_PATH, 0o755);

	// Create source SQLite DB with sample rows matching fake wrangler's responses
	const createSourceScript = join(TEST_DIR, "_create-source-db.ts");
	writeFileSync(
		createSourceScript,
		`import { Database } from "bun:sqlite";
const db = new Database(${JSON.stringify(SOURCE_DB_PATH)});
db.exec(\`
  CREATE TABLE forums (id INTEGER PRIMARY KEY, name TEXT, description TEXT, display_order INTEGER);
  INSERT INTO forums VALUES (1, 'test-forum', 'test-desc', 1);
  INSERT INTO forums VALUES (2, 'test-forum-2', 'test-desc-2', 2);
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, coins INTEGER, has_avatar INTEGER, campus TEXT);
  INSERT INTO users VALUES (1, 'user-1', 100, 0, 'test-campus');
  INSERT INTO users VALUES (2, 'user-2', 200, 1, 'campus-2');
  INSERT INTO users VALUES (3, 'user-3', 300, 0, 'campus-3');
\`);
db.close();
`,
	);
	execSync(`bun ${createSourceScript}`, {
		encoding: "utf-8",
		timeout: 10_000,
	});
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── Unit tests for shared logic ───────────────────────────────────────────

describe("shared logic", () => {
	test("IMPORT_TABLE_ORDER follows FK dependency order", () => {
		const order = [...IMPORT_TABLE_ORDER];
		expect(order.indexOf("forums")).toBeLessThan(order.indexOf("threads"));
		expect(order.indexOf("users")).toBeLessThan(order.indexOf("threads"));
		expect(order.indexOf("threads")).toBeLessThan(order.indexOf("posts"));
		expect(order.indexOf("posts")).toBeLessThan(order.indexOf("attachments"));
		expect(order.indexOf("users")).toBeLessThan(order.indexOf("user_checkins"));
	});

	test("FK_RELATIONS includes all 9 canonical FK checks", () => {
		expect(FK_RELATIONS).toHaveLength(9);
		const keys = FK_RELATIONS.map((r) => `${r.table}.${r.col}->${r.ref}.${r.refCol}`);
		expect(keys).toContain("threads.forum_id->forums.id");
		expect(keys).toContain("threads.author_id->users.id");
		expect(keys).toContain("posts.thread_id->threads.id");
		expect(keys).toContain("posts.forum_id->forums.id");
		expect(keys).toContain("posts.author_id->users.id");
		expect(keys).toContain("attachments.post_id->posts.id");
		expect(keys).toContain("attachments.thread_id->threads.id");
		expect(keys).toContain("attachments.author_id->users.id");
		expect(keys).toContain("user_checkins.user_id->users.id");
	});

	test("isValidChunkFilename accepts valid names and rejects unsafe ones", () => {
		expect(isValidChunkFilename("forums-001.sql")).toBe(true);
		expect(isValidChunkFilename("users-123.sql")).toBe(true);
		expect(isValidChunkFilename("user_checkins-001.sql")).toBe(true);

		expect(isValidChunkFilename("../evil.sql")).toBe(false);
		expect(isValidChunkFilename("foo/bar.sql")).toBe(false);
		expect(isValidChunkFilename("foo\\bar.sql")).toBe(false);
		expect(isValidChunkFilename("/etc/passwd.sql")).toBe(false);
		expect(isValidChunkFilename("")).toBe(false);
		expect(isValidChunkFilename("notasqlfile.txt")).toBe(false);
	});

	test("computeManifestFingerprint is SHA-256 and deterministic", () => {
		const m1 = makeManifest();
		const fp1 = computeManifestFingerprint(m1);
		expect(computeManifestFingerprint(m1)).toBe(fp1);
		// SHA-256 hex = 64 chars
		expect(fp1).toMatch(/^[a-f0-9]{64}$/);
	});

	test("fingerprint changes when chunk bytes change", () => {
		const m1 = makeManifest();
		const fp1 = computeManifestFingerprint(m1);

		const m2 = makeManifest();
		m2.chunks[0] = { ...m2.chunks[0], bytes: 999 };
		expect(computeManifestFingerprint(m2)).not.toBe(fp1);
	});

	test("fingerprint changes when table file list changes", () => {
		const m1 = makeManifest();
		const fp1 = computeManifestFingerprint(m1);

		const m2 = makeManifest();
		m2.tables.forums = {
			...m2.tables.forums,
			files: ["forums-001.sql", "forums-002.sql"],
		};
		expect(computeManifestFingerprint(m2)).not.toBe(fp1);
	});

	test("fingerprint changes when production_state changes", () => {
		const m1 = makeManifest();
		const fp1 = computeManifestFingerprint(m1);

		const m2 = makeManifest();
		m2.production_state.tables.forums = { count: 999, max_id: 999 };
		expect(computeManifestFingerprint(m2)).not.toBe(fp1);
	});

	test("buildFkCheckQuery generates valid SQL with child/parent aliases", () => {
		const sql = buildFkCheckQuery({
			table: "posts",
			col: "thread_id",
			ref: "threads",
			refCol: "id",
		});
		expect(sql).toContain("FROM posts child");
		expect(sql).toContain("LEFT JOIN threads parent");
		expect(sql).toContain("ON child.thread_id = parent.id");
		expect(sql).toContain("WHERE parent.id IS NULL");
	});
});

// ─── Manifest structural validation tests ──────────────────────────────────

describe("validateManifestStructure", () => {
	test("accepts valid manifest", () => {
		expect(() => validateManifestStructure(makeManifest())).not.toThrow();
	});

	test("rejects table file not present in chunks", () => {
		const manifest = makeManifest();
		manifest.tables.forums.files = ["forums-001.sql", "evil.sql"];
		expect(() => validateManifestStructure(manifest)).toThrow("not in manifest.chunks");
	});

	test("rejects unsafe filename in tables.files even if chunks are safe", () => {
		const manifest = makeManifest();
		manifest.tables.forums.files = ["../evil.sql"];
		expect(() => validateManifestStructure(manifest)).toThrow("Unsafe filename");
	});

	test("rejects chunk not referenced by any table", () => {
		const manifest = makeManifest();
		manifest.chunks.push({
			file: "orphan-001.sql",
			table: "orphan",
			rows: 1,
			bytes: 10,
			strategy: "upsert",
			pk_list: [1],
		});
		expect(() => validateManifestStructure(manifest)).toThrow("not referenced by any table");
	});

	test("rejects table/chunk table name mismatch", () => {
		const manifest = makeManifest();
		// forums-001.sql belongs to "forums" in chunks, but we reference it from users
		manifest.tables.users.files = ["forums-001.sql", "users-001.sql"];
		manifest.tables.forums.files = [];
		expect(() => validateManifestStructure(manifest)).toThrow("chunk.table is");
	});
});

// ─── Subprocess tests ──────────────────────────────────────────────────────

describe("executor subprocess", () => {
	test("dry-run exits 0 and prints execution plan without writing log", () => {
		const manifestPath = setupFixture("dry-run", makeManifest());
		const { stdout, exitCode } = runExecutor(manifestPath, ["--dry-run"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("DRY RUN");
		expect(stdout).toContain("PENDING");
		expect(stdout).toContain("forums-001.sql");
		expect(stdout).toContain("users-001.sql");
		expect(existsSync(join(TEST_DIR, "dry-run", "execution-log.json"))).toBe(false);
	});

	test("rejects manifest with path traversal in chunk filenames", () => {
		const manifest = makeManifest();
		manifest.chunks[0] = { ...manifest.chunks[0], file: "../../../etc/evil.sql" };
		manifest.tables.forums.files = ["../../../etc/evil.sql"];
		const manifestPath = setupFixture("path-traversal", manifest);
		const { stdout, exitCode } = runExecutor(manifestPath);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("Unsafe filename");
	});

	test("rejects table file not in chunks (structural validation)", () => {
		const manifest = makeManifest();
		manifest.tables.forums.files = ["forums-001.sql", "extra.sql"];
		const manifestPath = setupFixture("struct-mismatch", manifest);
		const { stdout, exitCode } = runExecutor(manifestPath);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("not in manifest.chunks");
	});

	test("rejects missing chunk files", () => {
		const manifestPath = setupFixture("missing-chunks", makeManifest(), {
			createChunks: false,
		});
		const { stdout, exitCode } = runExecutor(manifestPath);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("chunk files missing");
	});

	test("resume rejects execution log with fingerprint mismatch", () => {
		const manifest = makeManifest();
		const staleLog = {
			manifest_path: "old.json",
			manifest_fingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
			database: "test-db",
			started_at: "2026-05-09T00:00:00Z",
			chunks: [],
		};
		const manifestPath = setupFixture("fp-mismatch", manifest, {
			executionLog: staleLog,
		});
		const { stdout, exitCode } = runExecutor(manifestPath, ["--resume"]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("fingerprint mismatch");
	});

	test("resume skips chunks already marked done in execution log", () => {
		const manifest = makeManifest();
		const fingerprint = computeManifestFingerprint(manifest);
		const doneLog = {
			manifest_path: "test",
			manifest_fingerprint: fingerprint,
			database: "test-db",
			started_at: "2026-05-09T00:00:00Z",
			chunks: [
				{
					file: "forums-001.sql",
					table: "forums",
					status: "done",
					started_at: "",
					finished_at: "",
					duration_ms: 0,
				},
				{
					file: "users-001.sql",
					table: "users",
					status: "done",
					started_at: "",
					finished_at: "",
					duration_ms: 0,
				},
			],
		};
		const manifestPath = setupFixture("resume-skip", manifest, {
			executionLog: doneLog,
		});
		// Use fake wrangler in succeed mode for verification
		const { stdout, exitCode } = runExecutor(manifestPath, ["--resume"], {
			fakeMode: "succeed",
		});
		expect(stdout).toContain("2 chunks already completed");
		expect(stdout).toContain("SKIP");
		expect(stdout).not.toContain("EXEC forums-001.sql");
		expect(stdout).not.toContain("EXEC users-001.sql");
		// With fake wrangler succeed, verification passes → exit 0
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Import complete and verified");

		const logPath = join(TEST_DIR, "resume-skip", "execution-log.json");
		expect(existsSync(logPath)).toBe(true);
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		const doneChunks = log.chunks.filter((c: { status: string }) => c.status === "done");
		expect(doneChunks).toHaveLength(2);
	});

	test("failure on first chunk writes failed log entry and stops execution", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("fail-log", manifest);
		// Use fake wrangler in fail-exec mode
		const { exitCode, stdout } = runExecutor(manifestPath, [], {
			fakeMode: "fail-exec",
		});
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("FAILED");
		expect(stdout).toContain("stopped at");

		const logPath = join(TEST_DIR, "fail-log", "execution-log.json");
		expect(existsSync(logPath)).toBe(true);
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		expect(log.manifest_fingerprint).toBe(computeManifestFingerprint(manifest));

		const failedChunks = log.chunks.filter((c: { status: string }) => c.status === "failed");
		expect(failedChunks).toHaveLength(1);
		expect(failedChunks[0].file).toBe("forums-001.sql");
		expect(failedChunks[0].error).toBeDefined();
		expect(failedChunks[0].error.length).toBeGreaterThan(0);

		// Second chunk should NOT have been attempted
		const executedDone = log.chunks.filter(
			(c: { status: string; started_at: string }) => c.status === "done" && c.started_at !== "",
		);
		expect(executedDone).toHaveLength(0);
	});

	test("successful execution writes complete log with verification", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("success", manifest);
		const { exitCode, stdout } = runExecutor(manifestPath, [], {
			fakeMode: "succeed",
		});
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Execution Complete");
		expect(stdout).toContain("Import complete and verified");

		const logPath = join(TEST_DIR, "success", "execution-log.json");
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		expect(log.finished_at).toBeDefined();
		expect(log.verification).toBeDefined();
		expect(log.verification.passed).toBe(true);

		const doneChunks = log.chunks.filter((c: { status: string }) => c.status === "done");
		expect(doneChunks).toHaveLength(2);
	});

	test("fake npx verifies --file paths exist (CWD regression)", () => {
		// Regression: projectRoot was calculated as join(__dirname, "../../../..") which
		// went 4 levels up from packages/migrate/src instead of 3, landing in the wrong
		// directory. Wrangler couldn't find the SQL files. Now uses process.cwd() + resolve().
		// The fake npx script checks [ -f "$FILE_PATH" ] before proceeding, so any path
		// resolution bug will cause the succeed test to fail with "Unable to read SQL text file".
		const manifest = makeManifest();
		const manifestPath = setupFixture("cwd-regression", manifest);
		const { exitCode, stdout } = runExecutor(manifestPath, [], {
			fakeMode: "succeed",
		});
		expect(exitCode).toBe(0);
		expect(stdout).not.toContain("Unable to read SQL text file");
		expect(stdout).toContain("Import complete and verified");
	});
	test("resume preserves original done entries including manual verification fields", () => {
		// Regression: resume was synthesizing empty started_at/finished_at/duration_ms
		// records for carried-over done chunks, losing audit trail and manual verification.
		const manifest = makeManifest();
		const fingerprint = computeManifestFingerprint(manifest);
		const existingLog = {
			manifest_path: "test",
			manifest_fingerprint: fingerprint,
			database: "test-db",
			started_at: "2026-05-09T00:00:00Z",
			finished_at: "2026-05-09T00:01:00Z",
			chunks: [
				{
					file: "forums-001.sql",
					table: "forums",
					status: "done",
					started_at: "2026-05-09T00:00:10Z",
					finished_at: "2026-05-09T00:00:15Z",
					duration_ms: 5000,
				},
				{
					file: "users-001.sql",
					table: "users",
					status: "done",
					started_at: "2026-05-09T00:00:20Z",
					finished_at: "2026-05-09T00:00:53Z",
					duration_ms: 33000,
					manually_verified_at: "2026-05-09T01:00:00Z",
					reason: "manually verified: data confirmed present in remote D1",
				},
			],
		};
		const manifestPath = setupFixture("resume-preserve", manifest, {
			executionLog: existingLog,
		});
		const { exitCode, stdout } = runExecutor(manifestPath, ["--resume"], {
			fakeMode: "succeed",
		});
		expect(exitCode).toBe(0);
		expect(stdout).toContain("2 chunks already completed");

		const logPath = join(TEST_DIR, "resume-preserve", "execution-log.json");
		const log = JSON.parse(readFileSync(logPath, "utf-8"));

		// forums-001 should preserve original timestamps
		const forums = log.chunks.find((c: { file: string }) => c.file === "forums-001.sql");
		expect(forums.status).toBe("done");
		expect(forums.started_at).toBe("2026-05-09T00:00:10Z");
		expect(forums.finished_at).toBe("2026-05-09T00:00:15Z");
		expect(forums.duration_ms).toBe(5000);

		// users-001 should preserve manual verification fields
		const users = log.chunks.find((c: { file: string }) => c.file === "users-001.sql");
		expect(users.status).toBe("done");
		expect(users.started_at).toBe("2026-05-09T00:00:20Z");
		expect(users.duration_ms).toBe(33000);
		expect(users.manually_verified_at).toBe("2026-05-09T01:00:00Z");
		expect(users.reason).toContain("manually verified");
	});
});

// ─── Mark-done tests ─────────────────────────────────────────────────────

describe("mark-done", () => {
	test("marks a failed chunk as done with audit fields", () => {
		const manifest = makeManifest();
		const fingerprint = computeManifestFingerprint(manifest);
		const failedLog = {
			manifest_path: "test",
			manifest_fingerprint: fingerprint,
			database: "test-db",
			started_at: "2026-05-09T00:00:00Z",
			finished_at: "2026-05-09T00:01:00Z",
			chunks: [
				{
					file: "forums-001.sql",
					table: "forums",
					status: "failed",
					started_at: "2026-05-09T00:00:30Z",
					finished_at: "2026-05-09T00:00:53Z",
					duration_ms: 23000,
					error: "wrangler timeout warning",
				},
			],
		};
		const manifestPath = setupFixture("mark-done-ok", manifest, {
			executionLog: failedLog,
		});
		const { exitCode, stdout } = runExecutor(manifestPath, ["--mark-done", "forums-001.sql"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain('Marked "forums-001.sql" as done');

		const logPath = join(TEST_DIR, "mark-done-ok", "execution-log.json");
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		const chunk = log.chunks[0];
		expect(chunk.status).toBe("done");
		expect(chunk.manually_verified_at).toBeDefined();
		expect(chunk.reason).toContain("manually verified");
		expect(chunk.error).toBeUndefined();
	});

	test("rejects mark-done when fingerprint mismatches", () => {
		const manifest = makeManifest();
		const staleLog = {
			manifest_path: "test",
			manifest_fingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
			database: "test-db",
			started_at: "2026-05-09T00:00:00Z",
			chunks: [
				{
					file: "forums-001.sql",
					table: "forums",
					status: "failed",
					started_at: "",
					finished_at: "",
					duration_ms: 0,
				},
			],
		};
		const manifestPath = setupFixture("mark-done-fp", manifest, {
			executionLog: staleLog,
		});
		const { exitCode, stdout } = runExecutor(manifestPath, ["--mark-done", "forums-001.sql"]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("fingerprint mismatch");
	});

	test("rejects mark-done on a chunk that is not failed", () => {
		const manifest = makeManifest();
		const fingerprint = computeManifestFingerprint(manifest);
		const doneLog = {
			manifest_path: "test",
			manifest_fingerprint: fingerprint,
			database: "test-db",
			started_at: "2026-05-09T00:00:00Z",
			chunks: [
				{
					file: "forums-001.sql",
					table: "forums",
					status: "done",
					started_at: "",
					finished_at: "",
					duration_ms: 0,
				},
			],
		};
		const manifestPath = setupFixture("mark-done-not-failed", manifest, {
			executionLog: doneLog,
		});
		const { exitCode, stdout } = runExecutor(manifestPath, ["--mark-done", "forums-001.sql"]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain('status "done"');
		expect(stdout).toContain("Only failed chunks");
	});
});

// ─── isWarningOnly unit tests ───────────────────────────────────────────────

describe("isWarningOnly", () => {
	test("detects warning-only stderr with ANSI codes", () => {
		const stderr =
			"\x1b[33m▲ \x1b[43;33m[\x1b[43;30mWARNING\x1b[43;33m]\x1b[0m \x1b[1m⚠️ This process may take some time, during which your D1 database will be unavailable to serve queries.\x1b[0m";
		expect(isWarningOnly(stderr)).toBe(true);
	});

	test("detects warning-only stderr without ANSI codes", () => {
		expect(
			isWarningOnly(
				"WARNING: This process may take some time, during which your D1 database will be unavailable to serve queries.",
			),
		).toBe(true);
	});

	test("rejects stderr containing ERROR", () => {
		expect(isWarningOnly("WARNING unavailable\nERROR: something broke")).toBe(false);
	});

	test("rejects stderr containing Error:", () => {
		expect(isWarningOnly("WARNING unavailable\nError: SQLITE_CONSTRAINT")).toBe(false);
	});

	test("rejects stderr without warning pattern", () => {
		expect(isWarningOnly("Some random error message")).toBe(false);
	});

	test("rejects empty stderr", () => {
		expect(isWarningOnly("")).toBe(false);
	});
});

// ─── Warning verification tests ────────────────────────────────────────────

describe("verify-warning-success", () => {
	test("warning-only + verify pass → done with audit fields and samples", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("warn-verify-ok", manifest);
		const { exitCode, stdout } = runExecutor(
			manifestPath,
			["--verify-warning-success", "--source-db", SOURCE_DB_PATH],
			{ fakeMode: "warning-only" },
		);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("WARNING-only exit");
		expect(stdout).toContain("VERIFIED OK");
		expect(stdout).toContain("Import complete and verified");

		const logPath = join(TEST_DIR, "warn-verify-ok", "execution-log.json");
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		const doneChunks = log.chunks.filter((c: { status: string }) => c.status === "done");
		expect(doneChunks).toHaveLength(2);

		// Check audit fields on first chunk (forums)
		const forums = log.chunks.find((c: { file: string }) => c.file === "forums-001.sql");
		expect(forums.warning_verified_at).toBeDefined();
		expect(forums.warning_verification).toBeDefined();
		expect(forums.warning_verification.mode).toBe("pk_count_and_sample");
		expect(forums.warning_verification.pk_count.expected).toBe(2);
		expect(forums.error).toBeUndefined();
		// Samples must be present and passed
		expect(forums.warning_verification.samples.length).toBeGreaterThan(0);
		for (const sample of forums.warning_verification.samples) {
			expect(sample.passed).toBe(true);
			expect(sample.fields_checked.length).toBeGreaterThan(0);
		}

		// Check users chunk also has samples
		const users = log.chunks.find((c: { file: string }) => c.file === "users-001.sql");
		expect(users.warning_verification.samples.length).toBeGreaterThan(0);
		for (const sample of users.warning_verification.samples) {
			expect(sample.passed).toBe(true);
		}
	});

	test("warning-only + pk count mismatch → failed", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("warn-pk-mismatch", manifest);
		const { exitCode, stdout } = runExecutor(
			manifestPath,
			["--verify-warning-success", "--source-db", SOURCE_DB_PATH],
			{ fakeMode: "warning-pk-mismatch" },
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("VERIFICATION FAILED");
		expect(stdout).toContain("stopped at");

		const logPath = join(TEST_DIR, "warn-pk-mismatch", "execution-log.json");
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		const failedChunks = log.chunks.filter((c: { status: string }) => c.status === "failed");
		expect(failedChunks.length).toBeGreaterThanOrEqual(1);
		expect(failedChunks[0].warning_verification).toBeDefined();
		expect(failedChunks[0].warning_verification.pk_count.actual).toBe(0);
	});

	test("warning-only + sample field mismatch → failed", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("warn-sample-mismatch", manifest);
		const { exitCode, stdout } = runExecutor(
			manifestPath,
			["--verify-warning-success", "--source-db", SOURCE_DB_PATH],
			{ fakeMode: "warning-sample-mismatch" },
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("VERIFICATION FAILED");

		const logPath = join(TEST_DIR, "warn-sample-mismatch", "execution-log.json");
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		const failedChunks = log.chunks.filter((c: { status: string }) => c.status === "failed");
		expect(failedChunks.length).toBeGreaterThanOrEqual(1);
		// Samples should exist but have passed=false
		const chunk = failedChunks[0];
		expect(chunk.warning_verification).toBeDefined();
		expect(chunk.warning_verification.pk_count.expected).toBe(
			chunk.warning_verification.pk_count.actual,
		);
		expect(chunk.warning_verification.samples.length).toBeGreaterThan(0);
		expect(chunk.warning_verification.samples.some((s: { passed: boolean }) => !s.passed)).toBe(
			true,
		);
	});

	test("stderr contains ERROR → failed even with --verify-warning-success", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("warn-with-error", manifest);
		const { exitCode, stdout } = runExecutor(
			manifestPath,
			["--verify-warning-success", "--source-db", SOURCE_DB_PATH],
			{ fakeMode: "warning-error" },
		);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("FAILED");
		expect(stdout).not.toContain("VERIFIED OK");

		const logPath = join(TEST_DIR, "warn-with-error", "execution-log.json");
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		const failedChunks = log.chunks.filter((c: { status: string }) => c.status === "failed");
		expect(failedChunks.length).toBeGreaterThanOrEqual(1);
		expect(failedChunks[0].warning_verification).toBeUndefined();
	});

	test("warning-only without --verify-warning-success flag → failed", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("warn-no-flag", manifest);
		// No --verify-warning-success flag
		const { exitCode, stdout } = runExecutor(manifestPath, [], {
			fakeMode: "warning-only",
		});
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("FAILED");
		expect(stdout).not.toContain("VERIFIED OK");
		expect(stdout).not.toContain("WARNING-only exit");
	});

	test("--verify-warning-success without source-db and nonexistent manifest.source_db → fail before execution", () => {
		const manifest = makeManifest();
		// manifest.source_db defaults to "test.db" which doesn't exist
		const manifestPath = setupFixture("warn-no-source-db", manifest);
		const { exitCode, stdout } = runExecutor(manifestPath, ["--verify-warning-success"], {
			fakeMode: "warning-only",
		});
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("Source DB not found");
	});

	test("error (non-warning) without flag → failed normally", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("error-no-flag", manifest);
		const { exitCode, stdout } = runExecutor(manifestPath, [], {
			fakeMode: "fail-exec",
		});
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("FAILED");
		expect(stdout).not.toContain("WARNING-only");
	});
});
