/**
 * init-sql-equiv.bun.test.ts — verify INIT_SQL (apps/worker/src/test-support/
 * init-sql.generated.ts) builds the same schema as wrangler's real migration
 * replay against a fresh local D1.
 *
 * Run under `bun test` (uses bun:sqlite). vitest excludes *.bun.test.ts
 * (apps/worker/vitest.config.ts).
 *
 * Mechanics:
 *   1. mkdtempSync a throwaway --persist-to dir.
 *   2. `wrangler d1 migrations apply DB --local --persist-to <tmp> -c …`
 *      applies apps/worker/migrations/*.sql in order. This is the
 *      canonical schema.
 *   3. Glob the persist dir for the D1 SQLite file (path:
 *      `<tmp>/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`, skipping
 *      `metadata.sqlite`). Open with bun:sqlite read-only and SELECT
 *      sqlite_schema rows. We read the file directly because piping
 *      wrangler's `d1 execute --json` output through `bun spawnSync`
 *      reliably drops the stdout payload on this machine.
 *   4. bun:sqlite path: `new Database(':memory:'); db.exec(INIT_SQL);`
 *      then SELECT the same sqlite_schema rows.
 *   5. Normalize sql text (strip comments, collapse whitespace, lowercase
 *      keywords) and compare sha256 hashes.
 *
 * If the test fails the diff is printed so the cause is obvious — either
 * a migration was added without re-running prepare:test-sql, or the
 * generator missed a statement type.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INIT_SQL } from "../../../src/test-support/init-sql.generated";

const REPO_ROOT = resolve(__dirname, "../../../../..");
const WRANGLER_CONFIG = join(REPO_ROOT, "apps/worker/wrangler.toml");
const WRANGLER_BIN = join(REPO_ROOT, "apps/worker/node_modules/.bin/wrangler");

let persistDir: string;
let wranglerSchema: SchemaRow[] = [];
let initSqlSchema: SchemaRow[] = [];

interface SchemaRow {
	type: string;
	name: string;
	tbl_name: string;
	sql: string | null;
}

/** Normalize sqlite_schema.sql: strip block/line comments, collapse whitespace, lowercase keywords. */
function normalizeSql(sql: string | null): string {
	if (!sql) return "";
	return sql
		.replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
		.replace(/--[^\n]*/g, " ") // line comments
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function hashSchema(rows: SchemaRow[]): string {
	const canonical = rows
		.map((r) => `${r.type}\t${r.name}\t${r.tbl_name}\t${normalizeSql(r.sql)}`)
		.sort()
		.join("\n");
	return createHash("sha256").update(canonical).digest("hex");
}

/** Walk persistDir and return all .sqlite files, skipping metadata.sqlite. */
function findD1SqliteFile(dir: string): string {
	const candidates: string[] = [];
	const walk = (d: string) => {
		for (const entry of readdirSync(d)) {
			const full = join(d, entry);
			const st = statSync(full);
			if (st.isDirectory()) walk(full);
			else if (st.isFile() && full.endsWith(".sqlite") && !full.endsWith("metadata.sqlite")) {
				candidates.push(full);
			}
		}
	};
	walk(dir);
	if (candidates.length === 0) {
		throw new Error(`no D1 SQLite file found under ${dir}`);
	}
	if (candidates.length > 1) {
		throw new Error(
			`expected exactly one D1 SQLite file, found ${candidates.length}: ${candidates.join(", ")}`,
		);
	}
	return candidates[0];
}

const SCHEMA_QUERY = `
	SELECT type, name, tbl_name, sql
	FROM sqlite_schema
	WHERE name NOT LIKE 'sqlite_%'
	  AND name NOT LIKE 'd1_%'
	  AND name NOT LIKE '_cf_%'
	ORDER BY type, name
`;

beforeAll(() => {
	if (!existsSync(WRANGLER_BIN)) {
		throw new Error(`wrangler bin not found at ${WRANGLER_BIN}`);
	}

	persistDir = mkdtempSync(join(tmpdir(), "ellie-init-sql-equiv-"));

	// 1. Apply migrations via wrangler (canonical schema).
	const migrate = spawnSync(
		WRANGLER_BIN,
		[
			"d1",
			"migrations",
			"apply",
			"DB",
			"--local",
			"--persist-to",
			persistDir,
			"-c",
			WRANGLER_CONFIG,
		],
		{
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: { ...process.env, CI: "true" },
			input: "",
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	if (migrate.status !== 0) {
		throw new Error(
			`wrangler migrations apply failed (status=${migrate.status}):\nstdout: ${migrate.stdout}\nstderr: ${migrate.stderr}`,
		);
	}

	// 2. Open the D1 SQLite file directly (wrangler d1 execute output is
	//    swallowed under bun's spawnSync; reading the file is robust).
	const sqlitePath = findD1SqliteFile(persistDir);
	const wranglerDb = new Database(sqlitePath, { readonly: true });
	try {
		wranglerSchema = wranglerDb.prepare(SCHEMA_QUERY).all() as SchemaRow[];
	} finally {
		wranglerDb.close();
	}

	// 3. INIT_SQL → bun:sqlite :memory:
	const initDb = new Database(":memory:");
	try {
		initDb.exec(INIT_SQL);
		initSqlSchema = initDb.prepare(SCHEMA_QUERY).all() as SchemaRow[];
	} finally {
		initDb.close();
	}
}, 60_000); // wrangler migrations apply can take 10-30s on first run

afterAll(() => {
	if (persistDir) rmSync(persistDir, { recursive: true, force: true });
});

test("wrangler-applied schema is non-empty (sanity)", () => {
	expect(wranglerSchema.length).toBeGreaterThan(10);
});

test("INIT_SQL-applied schema is non-empty (sanity)", () => {
	expect(initSqlSchema.length).toBeGreaterThan(10);
});

test("INIT_SQL produces the same set of (type, name) objects as wrangler migrations", () => {
	const wranglerKeys = wranglerSchema.map((r) => `${r.type}:${r.name}`).sort();
	const initKeys = initSqlSchema.map((r) => `${r.type}:${r.name}`).sort();
	if (wranglerKeys.join("|") !== initKeys.join("|")) {
		const onlyInWrangler = wranglerKeys.filter((k) => !initKeys.includes(k));
		const onlyInInit = initKeys.filter((k) => !wranglerKeys.includes(k));
		console.error("Schema object diff:");
		console.error("  Only in wrangler:", onlyInWrangler);
		console.error("  Only in INIT_SQL:", onlyInInit);
	}
	expect(initKeys).toEqual(wranglerKeys);
});

test("INIT_SQL produces an equivalent (normalized) schema hash to wrangler migrations", () => {
	const wranglerHash = hashSchema(wranglerSchema);
	const initHash = hashSchema(initSqlSchema);
	if (wranglerHash !== initHash) {
		// Per-object diff to make debugging painless.
		const byKey = new Map<string, { wrangler?: string; init?: string }>();
		for (const r of wranglerSchema) {
			byKey.set(`${r.type}:${r.name}`, {
				...(byKey.get(`${r.type}:${r.name}`) ?? {}),
				wrangler: normalizeSql(r.sql),
			});
		}
		for (const r of initSqlSchema) {
			byKey.set(`${r.type}:${r.name}`, {
				...(byKey.get(`${r.type}:${r.name}`) ?? {}),
				init: normalizeSql(r.sql),
			});
		}
		const diffs: string[] = [];
		for (const [key, { wrangler, init }] of byKey) {
			if (wrangler !== init) {
				diffs.push(`${key}:\n  wrangler: ${wrangler}\n  init    : ${init}`);
			}
		}
		console.error(`Schema content diff (${diffs.length} objects differ):`);
		for (const d of diffs.slice(0, 5)) console.error(d);
		if (diffs.length > 5) console.error(`  … ${diffs.length - 5} more`);
	}
	expect(initHash).toBe(wranglerHash);
});
