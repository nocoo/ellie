/**
 * Tests for execute-d1-import.ts
 *
 * Unit tests validate shared logic exported from d1-sql-builder.ts:
 *   IMPORT_TABLE_ORDER, FK_RELATIONS, isValidChunkFilename, computeManifestFingerprint
 *
 * Subprocess tests create temp fixtures (manifest + chunk files) and run
 * the executor script, verifying exit codes, stdout, and execution-log.json.
 *
 * Covers reviewer-required scenarios:
 *   1. Table order follows FK dependency
 *   2. FK_RELATIONS includes all 9 canonical checks
 *   3. Path traversal rejection
 *   4. Missing chunk file rejection
 *   5. Dry-run doesn't call wrangler
 *   6. Resume fingerprint mismatch rejection
 *   7. Resume skips matching done chunks
 *   8. Failure writes failed log and stops
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Manifest } from "../src/load/d1-sql-builder";
import {
	FK_RELATIONS,
	IMPORT_TABLE_ORDER,
	computeManifestFingerprint,
	isValidChunkFilename,
} from "../src/load/d1-sql-builder";

const TEST_DIR = join(tmpdir(), `d1-exec-test-${Date.now()}`);
const PROJECT_ROOT = join(__dirname, "..");

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
			},
			{
				file: "users-001.sql",
				table: "users",
				rows: 3,
				bytes: 150,
				strategy: "upsert" as const,
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

/** Run the executor as a subprocess. */
function runExecutor(
	manifestPath: string,
	args: string[] = [],
): { stdout: string; exitCode: number } {
	const cmd = [
		"bun",
		"run",
		join(PROJECT_ROOT, "src/execute-d1-import.ts"),
		"--manifest",
		manifestPath,
		...args,
	].join(" ");
	try {
		const stdout = execSync(cmd, {
			encoding: "utf-8",
			cwd: PROJECT_ROOT,
			timeout: 30_000,
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
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── Unit tests for shared logic ───────────────────────────────────────────

describe("shared logic", () => {
	test("IMPORT_TABLE_ORDER follows FK dependency order", () => {
		const order = [...IMPORT_TABLE_ORDER];
		// Parent tables must come before child tables
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
		// Valid
		expect(isValidChunkFilename("forums-001.sql")).toBe(true);
		expect(isValidChunkFilename("users-123.sql")).toBe(true);
		expect(isValidChunkFilename("user_checkins-001.sql")).toBe(true);

		// Path traversal / unsafe
		expect(isValidChunkFilename("../evil.sql")).toBe(false);
		expect(isValidChunkFilename("foo/bar.sql")).toBe(false);
		expect(isValidChunkFilename("foo\\bar.sql")).toBe(false);
		expect(isValidChunkFilename("/etc/passwd.sql")).toBe(false);
		expect(isValidChunkFilename("")).toBe(false);
		expect(isValidChunkFilename("notasqlfile.txt")).toBe(false);
	});

	test("computeManifestFingerprint is deterministic and changes with generation", () => {
		const m1 = makeManifest();
		const fp1 = computeManifestFingerprint(m1);
		expect(computeManifestFingerprint(m1)).toBe(fp1);

		const m2 = makeManifest({ generated_at: "2026-05-10T00:00:00Z" });
		expect(computeManifestFingerprint(m2)).not.toBe(fp1);
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
		// Dry-run must not write execution log
		expect(existsSync(join(TEST_DIR, "dry-run", "execution-log.json"))).toBe(false);
	});

	test("rejects manifest with path traversal in chunk filenames", () => {
		const manifest = makeManifest();
		manifest.chunks[0] = { ...manifest.chunks[0], file: "../../../etc/evil.sql" };
		manifest.tables.forums.files = ["../../../etc/evil.sql"];
		const manifestPath = setupFixture("path-traversal", manifest);
		const { stdout, exitCode } = runExecutor(manifestPath);
		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("Unsafe chunk filename");
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
			manifest_fingerprint: "wrong|fingerprint|does|not|match",
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
		// All chunks done → executor skips all, then runs verification (which fails without remote D1)
		const { stdout } = runExecutor(manifestPath, ["--resume"]);
		expect(stdout).toContain("2 chunks already completed");
		expect(stdout).toContain("SKIP");
		// No chunk should be executed — only skipped
		expect(stdout).not.toContain("EXEC forums-001.sql");
		expect(stdout).not.toContain("EXEC users-001.sql");

		// Execution log should carry over all done chunks
		const logPath = join(TEST_DIR, "resume-skip", "execution-log.json");
		expect(existsSync(logPath)).toBe(true);
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		const doneChunks = log.chunks.filter((c: { status: string }) => c.status === "done");
		expect(doneChunks).toHaveLength(2);
	}, 60_000);

	test("failure on first chunk writes failed log entry and stops execution", () => {
		const manifest = makeManifest();
		const manifestPath = setupFixture("fail-log", manifest);
		// Wrangler will fail (no remote D1 auth for "test-db")
		const { exitCode } = runExecutor(manifestPath);
		expect(exitCode).not.toBe(0);

		const logPath = join(TEST_DIR, "fail-log", "execution-log.json");
		expect(existsSync(logPath)).toBe(true);
		const log = JSON.parse(readFileSync(logPath, "utf-8"));
		expect(log.manifest_fingerprint).toBe(computeManifestFingerprint(manifest));

		// First chunk should be "failed" with an error message
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
	}, 60_000);
});
