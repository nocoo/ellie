/**
 * Integration tests for generate-d1-sql.ts
 *
 * Creates a temporary SQLite DB with test data and a temp production-state.json,
 * then runs the generator as a subprocess and verifies:
 * - Production state is read and embedded in manifest
 * - Incremental tables filter by prod max_id (only id > max exported)
 * - 0 incremental rows → no chunk file generated
 * - Manifest contains prod_max_id, source_rows_after_max, bytes per chunk
 * - Output directory without --force → exits with error
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Manifest } from "../src/load/d1-sql-builder";

const TEST_DIR = join(tmpdir(), `d1-gen-test-${Date.now()}`);
const DB_PATH = join(TEST_DIR, "test.db");
const PROD_STATE_PATH = join(TEST_DIR, "production-state.json");
const OUT_DIR = join(TEST_DIR, "output");
const PROJECT_ROOT = join(__dirname, "..");

function runGenerator(args: string[] = []): { stdout: string; exitCode: number } {
	const cmd = [
		"bun",
		"run",
		join(PROJECT_ROOT, "src/generate-d1-sql.ts"),
		"--db",
		DB_PATH,
		"--out",
		OUT_DIR,
		"--production-state",
		PROD_STATE_PATH,
		...args,
	].join(" ");
	try {
		const stdout = execSync(cmd, { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 30_000 });
		return { stdout, exitCode: 0 };
	} catch (e) {
		const err = e as { status: number; stdout?: string; stderr?: string };
		return { stdout: (err.stdout ?? "") + (err.stderr ?? ""), exitCode: err.status ?? 1 };
	}
}

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });

	// Create a small test SQLite DB using bun
	const createDbScript = `
import { Database } from "bun:sqlite";
const db = new Database("${DB_PATH}");
db.exec(\`
  CREATE TABLE forums (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0, threads INTEGER NOT NULL DEFAULT 0, posts INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'forum', status INTEGER NOT NULL DEFAULT 1, moderators TEXT NOT NULL DEFAULT '', last_thread_id INTEGER NOT NULL DEFAULT 0, last_post_at INTEGER NOT NULL DEFAULT 0, last_poster TEXT NOT NULL DEFAULT '', last_thread_subject TEXT NOT NULL DEFAULT '');
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL DEFAULT '', password_salt TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', status INTEGER NOT NULL DEFAULT 0, role INTEGER NOT NULL DEFAULT 0, reg_date INTEGER NOT NULL DEFAULT 0, last_login INTEGER NOT NULL DEFAULT 0, threads INTEGER NOT NULL DEFAULT 0, posts INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, signature TEXT NOT NULL DEFAULT '', group_title TEXT NOT NULL DEFAULT '', group_stars INTEGER NOT NULL DEFAULT 0, group_color TEXT NOT NULL DEFAULT '', custom_title TEXT NOT NULL DEFAULT '', digest_posts INTEGER NOT NULL DEFAULT 0, ol_time INTEGER NOT NULL DEFAULT 0, gender INTEGER NOT NULL DEFAULT 0, birth_year INTEGER NOT NULL DEFAULT 0, birth_month INTEGER NOT NULL DEFAULT 0, birth_day INTEGER NOT NULL DEFAULT 0, reside_province TEXT NOT NULL DEFAULT '', reside_city TEXT NOT NULL DEFAULT '', graduate_school TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', interest TEXT NOT NULL DEFAULT '', qq TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', last_activity INTEGER NOT NULL DEFAULT 0, reg_ip TEXT NOT NULL DEFAULT '', last_ip TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL DEFAULT '', has_avatar INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE threads (id INTEGER PRIMARY KEY, forum_id INTEGER NOT NULL, author_id INTEGER NOT NULL, author_name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, last_post_at INTEGER NOT NULL DEFAULT 0, last_poster TEXT NOT NULL DEFAULT '', replies INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, sticky INTEGER NOT NULL DEFAULT 0, digest INTEGER NOT NULL DEFAULT 0, special INTEGER NOT NULL DEFAULT 0, highlight INTEGER NOT NULL DEFAULT 0, recommends INTEGER NOT NULL DEFAULT 0, post_table_id INTEGER NOT NULL DEFAULT 0, type_name TEXT NOT NULL DEFAULT '');
  CREATE TABLE posts (id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL, forum_id INTEGER NOT NULL, author_id INTEGER NOT NULL, author_name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, is_first INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, invisible INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE attachments (id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL, post_id INTEGER NOT NULL, author_id INTEGER NOT NULL, filename TEXT NOT NULL, file_path TEXT NOT NULL, file_size INTEGER NOT NULL DEFAULT 0, is_image INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, has_thumb INTEGER NOT NULL DEFAULT 0, downloads INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE user_checkins (user_id INTEGER PRIMARY KEY, total_days INTEGER NOT NULL DEFAULT 0, month_days INTEGER NOT NULL DEFAULT 0, streak_days INTEGER NOT NULL DEFAULT 0, reward_total INTEGER NOT NULL DEFAULT 0, last_reward INTEGER NOT NULL DEFAULT 0, mood TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', last_checkin_at INTEGER NOT NULL DEFAULT 0);

  INSERT INTO forums (id, name) VALUES (1, 'General'), (2, 'Off-topic');
  INSERT INTO users (id, username) VALUES (1, 'alice'), (2, 'bob'), (3, 'charlie');
  INSERT INTO threads (id, forum_id, author_id, subject) VALUES
    (1, 1, 1, 'Old thread 1'),
    (2, 1, 2, 'Old thread 2'),
    (10, 1, 1, 'Old thread 10'),
    (50, 2, 3, 'Prod boundary'),
    (51, 1, 1, 'New thread 51'),
    (52, 2, 2, 'New thread 52');
  INSERT INTO posts (id, thread_id, forum_id, author_id, content) VALUES
    (1, 1, 1, 1, 'Old post'),
    (100, 2, 1, 2, 'Prod boundary post'),
    (101, 51, 1, 1, 'New post 101'),
    (102, 51, 1, 2, 'New post 102'),
    (103, 52, 2, 3, 'New post 103');
  INSERT INTO attachments (id, thread_id, post_id, author_id, filename, file_path) VALUES
    (1, 1, 1, 1, 'old.png', '/old.png'),
    (5, 2, 100, 2, 'boundary.jpg', '/boundary.jpg');
  INSERT INTO user_checkins (user_id, total_days, mood) VALUES (1, 10, 'happy'), (2, 5, 'sleepy');
\`);
db.close();
`;
	const scriptPath = join(TEST_DIR, "create-db.ts");
	writeFileSync(scriptPath, createDbScript);
	execSync(`bun run "${scriptPath}"`, { cwd: PROJECT_ROOT, timeout: 10_000 });

	// Production state: threads max_id=50, posts max_id=100, attachments max_id=5
	const prodState = {
		captured_at: "2026-05-09T00:00:00Z",
		database: { name: "test-db", id: "test-id-1234" },
		backup: {
			path: "test/backup.sql",
			size_gb: 0.1,
			tables_included: ["forums", "users", "threads", "posts", "attachments", "user_checkins"],
			tables_excluded: [],
		},
		tables: {
			forums: { count: 2, max_id: 2 },
			users: { count: 3, max_id: 3 },
			threads: { count: 4, max_id: 50 },
			posts: { count: 2, max_id: 100 },
			attachments: { count: 2, max_id: 5 },
			user_checkins: { count: 2, max_id: 2 },
		},
	};
	writeFileSync(PROD_STATE_PATH, JSON.stringify(prodState, null, "\t"));
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("generate-d1-sql integration", () => {
	test("runs successfully and creates manifest", () => {
		const { stdout, exitCode } = runGenerator();
		expect(exitCode).toBe(0);
		expect(stdout).toContain("D1 Import SQL Generator");
		expect(existsSync(join(OUT_DIR, "manifest.json"))).toBe(true);
	});

	test("manifest embeds production state", () => {
		const manifest: Manifest = JSON.parse(readFileSync(join(OUT_DIR, "manifest.json"), "utf-8"));
		expect(manifest.production_state).toBeDefined();
		expect(manifest.production_state.database.name).toBe("test-db");
		expect(manifest.production_state.database.id).toBe("test-id-1234");
		expect(manifest.production_state.captured_at).toBe("2026-05-09T00:00:00Z");
		expect(manifest.production_state.backup.path).toBe("test/backup.sql");
	});

	test("manifest records prod_max_id and source_rows_after_max for incremental tables", () => {
		const manifest: Manifest = JSON.parse(readFileSync(join(OUT_DIR, "manifest.json"), "utf-8"));

		// threads: prod max_id=50, dry-run has id 51,52 → 2 new
		expect(manifest.tables.threads.prod_max_id).toBe(50);
		expect(manifest.tables.threads.source_rows_after_max).toBe(2);
		expect(manifest.tables.threads.source_total_rows).toBe(6);

		// posts: prod max_id=100, dry-run has id 101,102,103 → 3 new
		expect(manifest.tables.posts.prod_max_id).toBe(100);
		expect(manifest.tables.posts.source_rows_after_max).toBe(3);
		expect(manifest.tables.posts.source_total_rows).toBe(5);

		// attachments: prod max_id=5, dry-run has nothing > 5 → 0 new
		expect(manifest.tables.attachments.prod_max_id).toBe(5);
		expect(manifest.tables.attachments.source_rows_after_max).toBe(0);
	});

	test("incremental tables only export rows with id > prod max_id", () => {
		// threads-001.sql should only have id 51 and 52
		const threadsFile = join(OUT_DIR, "threads-001.sql");
		expect(existsSync(threadsFile)).toBe(true);
		const threadsSql = readFileSync(threadsFile, "utf-8");
		expect(threadsSql).toContain("INSERT OR IGNORE INTO threads");
		// Should contain new IDs
		expect(threadsSql).toContain("'New thread 51'");
		expect(threadsSql).toContain("'New thread 52'");
		// Should NOT contain old IDs
		expect(threadsSql).not.toContain("'Old thread 1'");
		expect(threadsSql).not.toContain("'Old thread 2'");
		expect(threadsSql).not.toContain("'Prod boundary'");

		// posts-001.sql should only have id 101, 102, 103
		const postsSql = readFileSync(join(OUT_DIR, "posts-001.sql"), "utf-8");
		expect(postsSql).toContain("'New post 101'");
		expect(postsSql).toContain("'New post 103'");
		expect(postsSql).not.toContain("'Old post'");
		expect(postsSql).not.toContain("'Prod boundary post'");
	});

	test("zero incremental rows produce no chunk file", () => {
		const manifest: Manifest = JSON.parse(readFileSync(join(OUT_DIR, "manifest.json"), "utf-8"));
		// attachments has 0 new rows
		expect(manifest.tables.attachments.chunks).toBe(0);
		expect(manifest.tables.attachments.rows).toBe(0);
		expect(manifest.tables.attachments.files).toHaveLength(0);
		// No attachments chunk file should exist
		expect(existsSync(join(OUT_DIR, "attachments-001.sql"))).toBe(false);
	});

	test("every chunk in manifest has a positive bytes field", () => {
		const manifest: Manifest = JSON.parse(readFileSync(join(OUT_DIR, "manifest.json"), "utf-8"));
		for (const chunk of manifest.chunks) {
			expect(chunk.bytes).toBeGreaterThan(0);
			expect(typeof chunk.bytes).toBe("number");
		}
	});

	test("upsert tables have null prod_max_id (all rows exported)", () => {
		const manifest: Manifest = JSON.parse(readFileSync(join(OUT_DIR, "manifest.json"), "utf-8"));
		expect(manifest.tables.forums.prod_max_id).toBeNull();
		expect(manifest.tables.forums.source_rows_after_max).toBeNull();
		expect(manifest.tables.users.prod_max_id).toBeNull();
		expect(manifest.tables.user_checkins.prod_max_id).toBeNull();
	});

	test("upsert SQL does not update app-owned columns", () => {
		const forumsSql = readFileSync(join(OUT_DIR, "forums-001.sql"), "utf-8");
		expect(forumsSql).toContain("ON CONFLICT(id) DO UPDATE SET");
		// Must not contain id = excluded.id
		expect(forumsSql).not.toContain("id = excluded.id");

		const usersSql = readFileSync(join(OUT_DIR, "users-001.sql"), "utf-8");
		expect(usersSql).toContain("ON CONFLICT(id) DO UPDATE SET");
		// email must not be in SET clause (app-owned)
		const usersSetClauses = usersSql.split("DO UPDATE SET").slice(1);
		for (const setClause of usersSetClauses) {
			expect(setClause).not.toMatch(/\bemail = excluded\.email\b/);
		}
	});

	test("refuses to overwrite existing output directory without --force", () => {
		// OUT_DIR already exists from the first run
		const { exitCode, stdout } = runGenerator();
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("Output directory already exists");
		expect(stdout).toContain("--force");
	});

	test("--force clears and regenerates output directory", () => {
		const { exitCode } = runGenerator(["--force"]);
		expect(exitCode).toBe(0);
		expect(existsSync(join(OUT_DIR, "manifest.json"))).toBe(true);
	});
});

// ─── CLI validation tests ────────────────────────────────────────────────

describe("CLI parameter validation", () => {
	test("rejects --users-chunk-size 0", () => {
		const { exitCode, stdout } = runGenerator(["--force", "--users-chunk-size", "0"]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("positive integer");
	});

	test("rejects --users-chunk-size with negative value", () => {
		// parseArgs rejects dash-prefixed values as ambiguous
		const { exitCode } = runGenerator(["--force", "--users-chunk-size", "-5"]);
		expect(exitCode).not.toBe(0);
	});

	test("rejects --users-chunk-size with non-numeric string", () => {
		const { exitCode, stdout } = runGenerator(["--force", "--users-chunk-size", "abc"]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("positive integer");
	});

	test("rejects --users-min-id with negative value", () => {
		// parseArgs rejects dash-prefixed values as ambiguous
		const { exitCode } = runGenerator(["--force", "--users-min-id", "-1"]);
		expect(exitCode).not.toBe(0);
	});

	test("rejects --users-min-id with non-numeric string", () => {
		const { exitCode, stdout } = runGenerator(["--force", "--users-min-id", "xyz"]);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("non-negative integer");
	});
});

// ─── Continuation generation tests ───────────────────────────────────────

describe("continuation generation", () => {
	const CONT_OUT = join(TEST_DIR, "output-cont");

	function runGeneratorCont(args: string[] = []): { stdout: string; exitCode: number } {
		const cmd = [
			"bun",
			"run",
			join(PROJECT_ROOT, "src/generate-d1-sql.ts"),
			"--db",
			DB_PATH,
			"--out",
			CONT_OUT,
			"--production-state",
			PROD_STATE_PATH,
			"--force",
			...args,
		].join(" ");
		try {
			const stdout = execSync(cmd, { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 30_000 });
			return { stdout, exitCode: 0 };
		} catch (e) {
			const err = e as { status: number; stdout?: string; stderr?: string };
			return { stdout: (err.stdout ?? "") + (err.stderr ?? ""), exitCode: err.status ?? 1 };
		}
	}

	test("--users-min-id filters users and records continuation_min_id in manifest", () => {
		// DB has users 1,2,3 — filter with min-id=2 should only include user 3
		const { exitCode, stdout } = runGeneratorCont(["--users-min-id", "2"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("continuation");

		const manifest: Manifest = JSON.parse(readFileSync(join(CONT_OUT, "manifest.json"), "utf-8"));
		expect(manifest.tables.users.continuation_min_id).toBe(2);
		expect(manifest.tables.users.rows).toBe(1); // only user id=3
		expect(manifest.tables.users.source_total_rows).toBe(3); // total in source

		// SQL should only contain user 3
		const usersSql = readFileSync(join(CONT_OUT, "users-001.sql"), "utf-8");
		expect(usersSql).toContain("'charlie'");
		expect(usersSql).not.toContain("'alice'");
		expect(usersSql).not.toContain("'bob'");
	});

	test("--users-chunk-size produces smaller chunks and records effective_chunk_size", () => {
		// DB has 3 users — with chunk size 2, should produce 2 chunks
		const { exitCode } = runGeneratorCont(["--users-chunk-size", "2"]);
		expect(exitCode).toBe(0);

		const manifest: Manifest = JSON.parse(readFileSync(join(CONT_OUT, "manifest.json"), "utf-8"));
		expect(manifest.tables.users.effective_chunk_size).toBe(2);
		expect(manifest.tables.users.chunks).toBe(2); // 3 users / 2 per chunk = 2 chunks
		expect(manifest.tables.users.files).toHaveLength(2);

		// Each chunk should have at most 2 users
		const chunk1 = readFileSync(join(CONT_OUT, "users-001.sql"), "utf-8");
		const chunk1Matches = chunk1.match(/INSERT INTO users/g);
		expect(chunk1Matches).toHaveLength(2);

		const chunk2 = readFileSync(join(CONT_OUT, "users-002.sql"), "utf-8");
		const chunk2Matches = chunk2.match(/INSERT INTO users/g);
		expect(chunk2Matches).toHaveLength(1); // remaining 1 user
	});

	test("--users-min-id=0 is accepted and includes all users", () => {
		const { exitCode } = runGeneratorCont(["--users-min-id", "0"]);
		expect(exitCode).toBe(0);

		const manifest: Manifest = JSON.parse(readFileSync(join(CONT_OUT, "manifest.json"), "utf-8"));
		expect(manifest.tables.users.continuation_min_id).toBe(0);
		expect(manifest.tables.users.rows).toBe(3); // all 3 users have id > 0
	});
});
