#!/usr/bin/env bun
/**
 * Import forum announcements (rules field) from legacy Discuz MySQL into
 * D1 `forums.announcement`. DRY-RUN ONLY — produces SQL + report artifacts;
 * does not touch production D1.
 *
 * Source:  pre_forum_forumfield.rules on the legacy VPS (via SSH).
 * Target:  D1 `forums.announcement` column (added in migration 0044).
 * SQL emitted: only `UPDATE forums SET announcement=? WHERE id=?` per row.
 *
 * Usage:
 *   bun run scripts/import-forum-announcements-2026-05-22.ts
 *
 * Outputs (under reference/forum-announcement-2026-05-22/):
 *   - snapshot/forumfield-rules.json   raw MySQL snapshot (fid, rules)
 *   - sql/01-announcements.sql         UPDATE statements (sanitized)
 *   - dryrun/report.json               aggregate stats + per-fid summary
 *   - dryrun/sample-fid-306.txt        before/after sample for the largest entry
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { sanitizeForumAnnouncement } from "../apps/worker/src/lib/sanitizeAnnouncement";

function bail(msg: string): never {
	console.error(`ERROR: ${msg}`);
	process.exit(1);
}

const SSH_HOST = process.env.MIGRATION_SSH_HOST ?? bail("Set MIGRATION_SSH_HOST");
const SSH_PORT = process.env.MIGRATION_SSH_PORT ?? "22";
const SSH_USER = process.env.MIGRATION_SSH_USER ?? bail("Set MIGRATION_SSH_USER");
const MYSQL_DB = process.env.MIGRATION_MYSQL_DB ?? "db_main";

const SSH = ["/usr/bin/ssh", "-p", SSH_PORT, `${SSH_USER}@${SSH_HOST}`];
const OUT_DIR = "reference/forum-announcement-2026-05-22";
const SNAPSHOT_DIR = `${OUT_DIR}/snapshot`;
const SQL_DIR = `${OUT_DIR}/sql`;
const DRYRUN_DIR = `${OUT_DIR}/dryrun`;

interface MySQLForumField {
	fid: number;
	rules: string;
}

interface PerFidSummary {
	fid: number;
	rawBytes: number;
	sanitizedBytes: number;
	droppedTagCount: number;
	droppedAttrCount: number;
	droppedUrls: number;
	nulRemoved: number;
}

function sshExec(remoteCmd: string): string {
	// Pipe remote command via stdin to avoid quoting hell on multi-line SQL.
	const args = SSH.join(" ");
	return execSync(`${args} 'bash -s'`, {
		encoding: "utf8",
		input: remoteCmd,
		maxBuffer: 64 * 1024 * 1024,
	});
}

function escapeSqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function fetchSnapshot(): MySQLForumField[] {
	console.log("Fetching pre_forum_forumfield (fid, rules) from VPS...");
	// Emit non-empty rules as TSV with backslash-escaped newlines so we get
	// one row per line; we'll decode after.
	const sql = `
SELECT fid, HEX(rules) AS rules_hex
FROM pre_forum_forumfield
WHERE rules <> ''
ORDER BY fid
`.trim();
	const out = sshExec(`sudo -n mysql -u root ${MYSQL_DB} -B -e "${sql.replace(/"/g, '\\"')}"`);
	const lines = out.split("\n").filter((l) => l.length > 0);
	// First line is header: "fid\trules_hex"
	const header = lines.shift();
	if (header !== "fid\trules_hex") {
		throw new Error(`unexpected header: ${header}`);
	}
	const result: MySQLForumField[] = [];
	for (const line of lines) {
		const tab = line.indexOf("\t");
		if (tab === -1) continue;
		const fid = Number.parseInt(line.slice(0, tab), 10);
		const hex = line.slice(tab + 1);
		const rules = Buffer.from(hex, "hex").toString("utf8");
		result.push({ fid, rules });
	}
	console.log(`  Fetched ${result.length} rows`);
	return result;
}

function ensureDirs(): void {
	mkdirSync(SNAPSHOT_DIR, { recursive: true });
	mkdirSync(SQL_DIR, { recursive: true });
	mkdirSync(DRYRUN_DIR, { recursive: true });
}

function main(): void {
	ensureDirs();

	const snapshot = fetchSnapshot();
	writeFileSync(`${SNAPSHOT_DIR}/forumfield-rules.json`, `${JSON.stringify(snapshot, null, 2)}\n`);

	const sqlLines: string[] = [];
	const perFid: PerFidSummary[] = [];
	let totalRawBytes = 0;
	let totalSanitizedBytes = 0;
	let totalNulRemoved = 0;
	const aggregateDroppedTags: Record<string, number> = {};
	const aggregateDroppedAttrs: Record<string, number> = {};
	let aggregateDroppedUrls = 0;
	let nulInOutputCount = 0;
	let oversizedCount = 0;
	const oversizedFids: number[] = [];

	let sampleFid306Before = "";
	let sampleFid306After = "";
	let sampleFid306Stats: unknown = null;

	for (const row of snapshot) {
		const raw = row.rules;
		const { html, stats } = sanitizeForumAnnouncement(raw);
		const rawBytes = Buffer.byteLength(raw, "utf8");
		const sanitizedBytes = Buffer.byteLength(html, "utf8");

		totalRawBytes += rawBytes;
		totalSanitizedBytes += sanitizedBytes;
		totalNulRemoved += stats.nulRemoved;

		for (const [k, v] of Object.entries(stats.droppedTags)) {
			aggregateDroppedTags[k] = (aggregateDroppedTags[k] ?? 0) + v;
		}
		for (const [k, v] of Object.entries(stats.droppedAttrs)) {
			aggregateDroppedAttrs[k] = (aggregateDroppedAttrs[k] ?? 0) + v;
		}
		aggregateDroppedUrls += stats.droppedUrls;

		if (html.includes(String.fromCharCode(0))) {
			nulInOutputCount += 1;
		}
		if (sanitizedBytes > 4096) {
			oversizedCount += 1;
			oversizedFids.push(row.fid);
		}

		const droppedTagCount = Object.values(stats.droppedTags).reduce((a, b) => a + b, 0);
		const droppedAttrCount = Object.values(stats.droppedAttrs).reduce((a, b) => a + b, 0);

		perFid.push({
			fid: row.fid,
			rawBytes,
			sanitizedBytes,
			droppedTagCount,
			droppedAttrCount,
			droppedUrls: stats.droppedUrls,
			nulRemoved: stats.nulRemoved,
		});

		// SQL: ONLY the announcement column.
		sqlLines.push(`UPDATE forums SET announcement=${escapeSqlString(html)} WHERE id=${row.fid};`);

		if (row.fid === 306) {
			sampleFid306Before = raw;
			sampleFid306After = html;
			sampleFid306Stats = stats;
		}
	}

	// Write SQL.
	const sqlText = `${sqlLines.join("\n")}\n`;
	const sqlPath = `${SQL_DIR}/01-announcements.sql`;
	writeFileSync(sqlPath, sqlText);

	// NUL scan on emitted SQL file.
	const sqlBuf = Buffer.from(sqlText, "utf8");
	const sqlNulCount = sqlBuf.reduce<number>((acc, b) => acc + (b === 0 ? 1 : 0), 0);
	const sqlSha256 = createHash("sha256").update(sqlBuf).digest("hex");
	const statementCount = sqlLines.length;

	// Sample.
	const sampleBefore = sampleFid306Before;
	const sampleAfter = sampleFid306After;
	const sampleText = `# fid=306 announcement sanitize sample (2026-05-22)
#
# Source field: pre_forum_forumfield.rules
# Target column: forums.announcement (D1)
# Sanitizer: apps/worker/src/lib/sanitizeAnnouncement.ts :: sanitizeForumAnnouncement
#
# --- BEFORE (raw MySQL bytes ${Buffer.byteLength(sampleBefore, "utf8")}) ---
${sampleBefore}

# --- AFTER (sanitized bytes ${Buffer.byteLength(sampleAfter, "utf8")}) ---
${sampleAfter}

# --- STATS ---
${JSON.stringify(sampleFid306Stats, null, 2)}
`;
	writeFileSync(`${DRYRUN_DIR}/sample-fid-306.txt`, sampleText);

	// Aggregate report.
	const report = {
		generated_at: new Date().toISOString(),
		source: {
			host: SSH_HOST,
			db: MYSQL_DB,
			table: "pre_forum_forumfield",
			field: "rules",
		},
		target: {
			d1_table: "forums",
			d1_column: "announcement",
			sql_pattern: "UPDATE forums SET announcement=? WHERE id=?",
		},
		counts: {
			rows_fetched_from_mysql: snapshot.length,
			rows_to_update: statementCount,
			expected_non_empty_fids: 31,
		},
		bytes: {
			total_raw: totalRawBytes,
			total_sanitized: totalSanitizedBytes,
		},
		removed: {
			dropped_tags: aggregateDroppedTags,
			dropped_attrs: aggregateDroppedAttrs,
			dropped_urls: aggregateDroppedUrls,
			nul_removed_from_input: totalNulRemoved,
		},
		oversize: {
			over_4096_bytes_after_sanitize: oversizedCount,
			oversized_fids: oversizedFids,
		},
		nul_scan: {
			nul_in_any_sanitized_html: nulInOutputCount,
			nul_in_sql_file: sqlNulCount,
		},
		sql_file: {
			path: sqlPath,
			sha256: sqlSha256,
			statement_count: statementCount,
			only_pattern_used: "UPDATE forums SET announcement=? WHERE id=?",
		},
		per_fid: perFid,
	};
	writeFileSync(`${DRYRUN_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

	console.log("");
	console.log("=== Forum Announcement Import — Dry Run ===");
	console.log(`  Rows fetched          : ${snapshot.length}`);
	console.log(`  UPDATE statements     : ${statementCount}`);
	console.log(`  Raw total bytes       : ${totalRawBytes}`);
	console.log(`  Sanitized total bytes : ${totalSanitizedBytes}`);
	console.log(`  Dropped URLs total    : ${aggregateDroppedUrls}`);
	console.log(`  NUL removed from input: ${totalNulRemoved}`);
	console.log(`  NUL in sanitized HTML : ${nulInOutputCount}`);
	console.log(`  NUL in SQL file       : ${sqlNulCount}`);
	console.log(`  Over 4 KiB after sani.: ${oversizedCount}`);
	console.log(`  SQL sha256            : ${sqlSha256}`);
	console.log("");
	console.log("Artifacts:");
	console.log(`  ${SNAPSHOT_DIR}/forumfield-rules.json`);
	console.log(`  ${sqlPath}`);
	console.log(`  ${DRYRUN_DIR}/report.json`);
	console.log(`  ${DRYRUN_DIR}/sample-fid-306.txt`);
}

main();
