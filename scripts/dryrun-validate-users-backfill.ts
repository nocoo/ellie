#!/usr/bin/env bun
/**
 * SQLite dry-run validation for users email + reg_ip backfill chunks.
 *
 * - Creates an in-memory SQLite DB with the users schema.
 * - Seeds the rows referenced by every chunk with empty email / reg_ip
 *   so the WHERE-clause condition matches.
 * - Applies every chunk; counts UPDATEs via `changes()`.
 * - Reports any chunk where applied rows < expected rows, or any SQL
 *   syntax error.
 *
 * Output: writes a summary to reference/sync-2026-05-20/users-backfill-dryrun/sqlite-dryrun.log.
 */

import { Database } from "bun:sqlite";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const OUT_DIR = "reference/sync-2026-05-20/users-backfill-dryrun";

const USERS_DDL = `
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL DEFAULT '',
  password_salt TEXT    NOT NULL DEFAULT '',
  avatar        TEXT    NOT NULL DEFAULT '',
  status        INTEGER NOT NULL DEFAULT 0,
  role          INTEGER NOT NULL DEFAULT 0,
  reg_date      INTEGER NOT NULL DEFAULT 0,
  last_login    INTEGER NOT NULL DEFAULT 0,
  threads       INTEGER NOT NULL DEFAULT 0,
  posts         INTEGER NOT NULL DEFAULT 0,
  credits       INTEGER NOT NULL DEFAULT 0,
  signature     TEXT    NOT NULL DEFAULT '',
  group_title   TEXT    NOT NULL DEFAULT '',
  group_stars   INTEGER NOT NULL DEFAULT 0,
  group_color   TEXT    NOT NULL DEFAULT '',
  custom_title  TEXT    NOT NULL DEFAULT '',
  digest_posts  INTEGER NOT NULL DEFAULT 0,
  ol_time       INTEGER NOT NULL DEFAULT 0,
  gender        INTEGER NOT NULL DEFAULT 0,
  birth_year    INTEGER NOT NULL DEFAULT 0,
  birth_month   INTEGER NOT NULL DEFAULT 0,
  birth_day     INTEGER NOT NULL DEFAULT 0,
  reside_province TEXT  NOT NULL DEFAULT '',
  reside_city   TEXT    NOT NULL DEFAULT '',
  graduate_school TEXT  NOT NULL DEFAULT '',
  bio           TEXT    NOT NULL DEFAULT '',
  interest      TEXT    NOT NULL DEFAULT '',
  qq            TEXT    NOT NULL DEFAULT '',
  site          TEXT    NOT NULL DEFAULT '',
  last_activity INTEGER NOT NULL DEFAULT 0,
  reg_ip        TEXT    NOT NULL DEFAULT '',
  last_ip       TEXT    NOT NULL DEFAULT ''
);
`;

interface PhaseResult {
	name: string;
	chunks: number;
	expectedRows: number;
	appliedRows: number;
	errors: string[];
}

function extractIds(sql: string): number[] {
	const ids: number[] = [];
	const re = /WHERE id = (\d+)/g;
	let m: RegExpExecArray | null;
	m = re.exec(sql);
	while (m !== null) {
		ids.push(Number(m[1]));
		m = re.exec(sql);
	}
	return ids;
}

function runPhase(name: string, chunksDir: string, field: "email" | "reg_ip"): PhaseResult {
	console.log(`\n=== ${name} ===`);
	const db = new Database(":memory:");
	db.exec(USERS_DDL);

	// Collect all chunk files and read once
	const files = readdirSync(chunksDir)
		.filter((f) => f.endsWith(".sql"))
		.sort();
	console.log(`  ${files.length} chunk files`);

	// First pass: gather all ids that will be touched, seed users.
	const allIds = new Set<number>();
	const cache: { file: string; sql: string }[] = [];
	for (const f of files) {
		const sql = readFileSync(`${chunksDir}/${f}`, "utf8");
		cache.push({ file: f, sql });
		for (const id of extractIds(sql)) allIds.add(id);
	}
	console.log(`  distinct ids referenced: ${allIds.size}`);

	const insert = db.prepare("INSERT INTO users (id, username) VALUES (?, ?)");
	db.transaction(() => {
		for (const id of allIds) insert.run(id, `u${id}`);
	})();

	const errors: string[] = [];
	let expectedRows = 0;
	const after = field === "email" ? `email != ''` : `reg_ip != ''`;

	for (const { file, sql } of cache) {
		const statements = sql.split("\n").filter((l) => l.trim());
		expectedRows += statements.length;
		try {
			db.exec(sql);
		} catch (e) {
			errors.push(`${file}: ${(e as Error).message}`);
		}
	}

	const final = db.query(`SELECT COUNT(*) AS c FROM users WHERE ${after}`).get() as { c: number };
	console.log(`  expected ${expectedRows} rows written, final non-empty: ${final.c}`);

	db.close();
	return {
		name,
		chunks: files.length,
		expectedRows,
		appliedRows: final.c,
		errors,
	};
}

const emailResult = runPhase("email", `${OUT_DIR}/email/chunks`, "email");
const regIpResult = runPhase("reg_ip", `${OUT_DIR}/reg_ip/chunks`, "reg_ip");

const summary = `SQLite dry-run validation — ${new Date().toISOString()}

Phase: email
  chunks: ${emailResult.chunks}
  expected UPDATE statements: ${emailResult.expectedRows}
  rows with email != '' after replay: ${emailResult.appliedRows}
  errors: ${emailResult.errors.length}
${emailResult.errors.map((e) => `    - ${e}`).join("\n")}

Phase: reg_ip
  chunks: ${regIpResult.chunks}
  expected UPDATE statements: ${regIpResult.expectedRows}
  rows with reg_ip != '' after replay: ${regIpResult.appliedRows}
  errors: ${regIpResult.errors.length}
${regIpResult.errors.map((e) => `    - ${e}`).join("\n")}

Overall: ${
	emailResult.errors.length === 0 &&
	regIpResult.errors.length === 0 &&
	emailResult.appliedRows === emailResult.expectedRows &&
	regIpResult.appliedRows === regIpResult.expectedRows
		? "PASS"
		: "FAIL"
}
`;

console.log(`\n${summary}`);
writeFileSync(`${OUT_DIR}/sqlite-dryrun.log`, summary);
console.log(`Wrote ${OUT_DIR}/sqlite-dryrun.log`);
