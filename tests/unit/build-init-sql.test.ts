import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const REPO_ROOT = resolve(__dirname, "../..");
const SCRIPT = join(REPO_ROOT, "scripts/build-init-sql.ts");
const OUTPUT = join(REPO_ROOT, "apps/worker/src/test-support/init-sql.generated.ts");

function run(args: string[]) {
	return spawnSync("bun", ["run", SCRIPT, ...args], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
}

describe("scripts/build-init-sql.ts", () => {
	// Snapshot the on-disk generated file so we can mutate it during tests
	// (--check failure cases) and restore afterwards.
	let original = "";

	beforeEach(() => {
		original = readFileSync(OUTPUT, "utf8");
	});

	afterEach(() => {
		writeFileSync(OUTPUT, original);
	});

	test("--check passes when INIT_SQL is in sync with migrations", () => {
		const r = run(["--check"]);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/INIT_SQL up to date/);
	});

	test("--check fails when the on-disk hash differs from migrations", () => {
		// Tamper: replace the hash literal with a wrong one.
		const tampered = original.replace(
			/export const INIT_SQL_HASH = "[0-9a-f]{64}"/,
			'export const INIT_SQL_HASH = "0000000000000000000000000000000000000000000000000000000000000000"',
		);
		writeFileSync(OUTPUT, tampered);
		const r = run(["--check"]);
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/out of sync/);
	});

	test("--check fails when generated file is missing", () => {
		// Move it aside via tmpfile + delete.
		const stash = mkdtempSync(join(tmpdir(), "init-sql-test-"));
		try {
			rmSync(OUTPUT);
			const r = run(["--check"]);
			expect(r.status).toBe(1);
			expect(r.stderr).toMatch(/does not exist|out of sync/);
		} finally {
			// restored by afterEach
			rmSync(stash, { recursive: true, force: true });
		}
	});

	test("default (no --check) regenerates and writes the file", () => {
		// Tamper, then regenerate, then confirm the file is back to canonical form.
		writeFileSync(OUTPUT, "/* stale */\n");
		const r = run([]);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Wrote/);
		const after = readFileSync(OUTPUT, "utf8");
		expect(after).toBe(original);
	});

	test("generated file lists every migration file in the source dir", () => {
		// Sanity check: source-files comment must include 0000_init_schema.sql
		// and the highest-numbered file we currently ship.
		expect(original).toContain("0000_init_schema.sql");
		expect(original).toMatch(/0050_backfill_thread_anonymous\.sql/);
	});

	test("INIT_SQL contains expected DDL fragments from real migrations", () => {
		// The constant should embed a CREATE TABLE for `users` (from 0000)
		// and the ALTER TABLE for the campus column (from 0024).
		expect(original).toContain("CREATE TABLE");
		expect(original).toContain("users");
		expect(original).toContain("ADD COLUMN campus TEXT");
	});
});
