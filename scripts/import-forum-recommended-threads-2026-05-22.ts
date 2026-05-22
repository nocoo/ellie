#!/usr/bin/env bun
/**
 * Import legacy "推荐主题" (forum-recommended-threads) rows from the
 * Discuz MySQL snapshot into D1 `forum_recommended_threads`. DRY-RUN
 * ONLY — emits SQL + report artifacts; does not touch production D1.
 *
 * Source:  pre_forum_forumrecommend on the legacy VPS (via SSH).
 *          Only `position = 1` (active recommendations) are taken; the
 *          `position = 0` archived rows are intentionally dropped.
 *
 * Target:  D1 `forum_recommended_threads (forum_id, thread_id,
 *          recommended_at, recommended_by)` from migration 0045.
 *
 * SQL emitted (per row, EXISTS-guarded INSERT OR IGNORE):
 *   INSERT OR IGNORE INTO forum_recommended_threads
 *     (forum_id, thread_id, recommended_at, recommended_by)
 *   SELECT ?, ?, ?, 0
 *   WHERE EXISTS (SELECT 1 FROM forums  WHERE id = ?)
 *     AND EXISTS (SELECT 1 FROM threads WHERE id = ? AND forum_id = ?);
 *
 * # Why an EXISTS-guarded INSERT (and not a plain VALUES insert)
 *
 * Migration 0045 deliberately does NOT declare FK constraints — D1's
 * FK enforcement is off by default and the worker layer enumerates
 * child cleanup explicitly. That means a plain `INSERT OR IGNORE ...
 * VALUES (...)` would happily persist a recommendation row whose
 * `forum_id` or `thread_id` no longer exists in the target D1 (e.g.
 * because the source snapshot was taken before a forum/thread was
 * deleted on the worker side). Those orphaned rows would never
 * surface in the public GET (the JOIN drops them) but they WOULD
 * permanently occupy a slot in the `(forum_id, thread_id)` PK,
 * silently blocking a future re-recommend on the same id.
 *
 * The EXISTS guard moves the check into SQL itself so the SQL is
 * self-defensive regardless of how it is applied (`wrangler d1
 * execute`, manual paste, replay, etc.). Rows pointing at a
 * non-existent forum or thread are silently skipped at apply time;
 * the only observable effect is that `INSERT OR IGNORE` reports zero
 * rowcount for that statement. The (forum_id, thread_id) PK + the
 * second `AND forum_id = ?` clause additionally rejects rows whose
 * thread was moved to a different forum after the snapshot.
 *
 * # Why `recommended_by = 0` and single `now`
 *
 * The legacy `pre_forum_forumrecommend` row carries `moderatorid` but
 * NO dateline — there is nothing on the source side that maps to
 * `recommended_at`. Per reviewer freeze (msg a629d81c) we:
 *   - Stamp `recommended_by = 0` as the SYSTEM-IMPORT sentinel reserved
 *     by migration 0045. The column is `NOT NULL`; live moderator
 *     writes use the authenticated `users.id` (always positive).
 *   - Stamp `recommended_at = <single import-time epoch>` once for the
 *     whole batch. This is intentionally lossy — we have no per-row
 *     timestamp to preserve. The display ORDER BY thread_id DESC means
 *     the timestamp does not influence the visible top-6 anyway.
 *
 * The `(forum_id, thread_id)` PK + INSERT OR IGNORE makes re-runs
 * idempotent.
 *
 * Usage:
 *   # default dry-run (snapshot + SQL + summary report only)
 *   bun run scripts/import-forum-recommended-threads-2026-05-22.ts
 *
 *   # opt-in pre-check against a local wrangler D1 snapshot — fills
 *   # the report with skipped_missing_forum / skipped_missing_thread /
 *   # skipped_forum_mismatch counts so the operator can see exactly
 *   # how many rows the EXISTS guard will drop before applying.
 *   bun run scripts/import-forum-recommended-threads-2026-05-22.ts \
 *     --check-d1 .wrangler/state/d1/<binding>/db.sqlite
 *
 * Outputs (under reference/forum-recommended-threads-2026-05-22/):
 *   - snapshot/forumrecommend.json   raw MySQL snapshot
 *   - sql/01-recommend.sql           INSERT statements (EXISTS-guarded)
 *   - dryrun/report.json             aggregate stats + per-fid counts
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

function bail(msg: string): never {
	console.error(`ERROR: ${msg}`);
	process.exit(1);
}

const SSH_HOST = process.env.MIGRATION_SSH_HOST ?? bail("Set MIGRATION_SSH_HOST");
const SSH_PORT = process.env.MIGRATION_SSH_PORT ?? "22";
const SSH_USER = process.env.MIGRATION_SSH_USER ?? bail("Set MIGRATION_SSH_USER");
const MYSQL_DB = process.env.MIGRATION_MYSQL_DB ?? "db_main";

const SSH = ["/usr/bin/ssh", "-p", SSH_PORT, `${SSH_USER}@${SSH_HOST}`];
const OUT_DIR = "reference/forum-recommended-threads-2026-05-22";
const SNAPSHOT_DIR = `${OUT_DIR}/snapshot`;
const SQL_DIR = `${OUT_DIR}/sql`;
const DRYRUN_DIR = `${OUT_DIR}/dryrun`;

interface MySQLRecommend {
	fid: number;
	tid: number;
	position: number;
}

/**
 * Parse CLI args. Currently the only supported flag is
 * `--check-d1 <path>` which opts in to a local SQLite pre-check that
 * fills the report with skipped-row counts. Anything else is rejected
 * up front so a typo cannot silently disable the pre-check.
 */
function parseArgs(argv: string[]): { checkD1Path: string | null } {
	let checkD1Path: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--check-d1") {
			const v = argv[i + 1];
			if (!v) throw new Error("--check-d1 requires a path argument");
			checkD1Path = v;
			i++;
		} else if (a?.startsWith("--check-d1=")) {
			checkD1Path = a.slice("--check-d1=".length);
		} else if (a !== undefined) {
			throw new Error(`unknown argument: ${a}`);
		}
	}
	return { checkD1Path };
}

function sshExec(remoteCmd: string): string {
	const args = SSH.join(" ");
	return execSync(`${args} 'bash -s'`, {
		encoding: "utf8",
		input: remoteCmd,
		maxBuffer: 16 * 1024 * 1024,
	});
}

function fetchSnapshot(): MySQLRecommend[] {
	console.log("Fetching pre_forum_forumrecommend (fid, tid, position) from VPS...");
	const sql = `
SELECT fid, tid, position
FROM pre_forum_forumrecommend
ORDER BY fid, tid
`.trim();
	const out = sshExec(`sudo -n mysql -u root ${MYSQL_DB} -B -e "${sql.replace(/"/g, '\\"')}"`);
	const lines = out.split("\n").filter((l) => l.length > 0);
	const header = lines.shift();
	if (header !== "fid\ttid\tposition") {
		throw new Error(`unexpected header: ${header}`);
	}
	const result: MySQLRecommend[] = [];
	for (const line of lines) {
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const fid = Number.parseInt(parts[0] ?? "0", 10);
		const tid = Number.parseInt(parts[1] ?? "0", 10);
		const position = Number.parseInt(parts[2] ?? "0", 10);
		if (fid <= 0 || tid <= 0) continue;
		result.push({ fid, tid, position });
	}
	console.log(`  Fetched ${result.length} rows total`);
	return result;
}

interface SkippedReport {
	d1_path: string;
	target_forums: number;
	target_threads: number;
	skipped_missing_forum: { fid: number; tid: number }[];
	skipped_missing_thread: { fid: number; tid: number }[];
	skipped_forum_mismatch: { fid: number; tid: number; current_forum_id: number }[];
	will_insert: number;
}

/**
 * Optional pre-check: open the wrangler-local D1 sqlite snapshot and
 * compute the exact rows that the EXISTS guard will drop at apply
 * time. Bun ships with native `bun:sqlite` so no extra dep is needed.
 * If the path is invalid we throw — silently degrading to "no
 * pre-check" would defeat the point of the opt-in.
 */
function checkAgainstD1(d1Path: string, activeRows: MySQLRecommend[]): SkippedReport {
	if (!existsSync(d1Path)) {
		throw new Error(`--check-d1 path does not exist: ${d1Path}`);
	}
	// Late-imported so the script still runs in environments where
	// the operator does not want to pull in bun:sqlite.
	// biome-ignore lint/suspicious/noExplicitAny: bun:sqlite typings are not in our tsconfig path.
	const { Database } = require("bun:sqlite") as { Database: new (p: string) => any };
	const db = new Database(d1Path);
	try {
		const forumRows = db.query("SELECT id FROM forums").all() as { id: number }[];
		const threadRows = db.query("SELECT id, forum_id FROM threads").all() as {
			id: number;
			forum_id: number;
		}[];
		const forumIds = new Set(forumRows.map((r) => r.id));
		const threadForum = new Map<number, number>();
		for (const t of threadRows) threadForum.set(t.id, t.forum_id);

		const skipped_missing_forum: { fid: number; tid: number }[] = [];
		const skipped_missing_thread: { fid: number; tid: number }[] = [];
		const skipped_forum_mismatch: {
			fid: number;
			tid: number;
			current_forum_id: number;
		}[] = [];
		let will_insert = 0;
		for (const row of activeRows) {
			if (!forumIds.has(row.fid)) {
				skipped_missing_forum.push({ fid: row.fid, tid: row.tid });
				continue;
			}
			const currentForum = threadForum.get(row.tid);
			if (currentForum === undefined) {
				skipped_missing_thread.push({ fid: row.fid, tid: row.tid });
				continue;
			}
			if (currentForum !== row.fid) {
				skipped_forum_mismatch.push({
					fid: row.fid,
					tid: row.tid,
					current_forum_id: currentForum,
				});
				continue;
			}
			will_insert++;
		}

		return {
			d1_path: d1Path,
			target_forums: forumIds.size,
			target_threads: threadForum.size,
			skipped_missing_forum,
			skipped_missing_thread,
			skipped_forum_mismatch,
			will_insert,
		};
	} finally {
		db.close();
	}
}

function ensureDirs(): void {
	mkdirSync(SNAPSHOT_DIR, { recursive: true });
	mkdirSync(SQL_DIR, { recursive: true });
	mkdirSync(DRYRUN_DIR, { recursive: true });
}

function main(): void {
	const { checkD1Path } = parseArgs(process.argv.slice(2));
	ensureDirs();

	const snapshot = fetchSnapshot();
	writeFileSync(`${SNAPSHOT_DIR}/forumrecommend.json`, `${JSON.stringify(snapshot, null, 2)}\n`);

	// Filter to active rows only — drop position=0 archives per the
	// migration-0045 source-data contract.
	const activeRows = snapshot.filter((r) => r.position === 1);
	const archivedRows = snapshot.filter((r) => r.position !== 1);

	// Single import-time stamp shared by every row. See file-level
	// comment for the lossy-by-design rationale.
	const importNow = Math.floor(Date.now() / 1000);

	// Per-forum count (for the report) + SQL emission. Every emitted
	// statement is self-defending via two `WHERE EXISTS` clauses —
	// see file header for rationale.
	const perFidCounts = new Map<number, number>();
	const sqlLines: string[] = [];
	for (const row of activeRows) {
		perFidCounts.set(row.fid, (perFidCounts.get(row.fid) ?? 0) + 1);
		sqlLines.push(
			`INSERT OR IGNORE INTO forum_recommended_threads (forum_id, thread_id, recommended_at, recommended_by) SELECT ${row.fid}, ${row.tid}, ${importNow}, 0 WHERE EXISTS (SELECT 1 FROM forums WHERE id = ${row.fid}) AND EXISTS (SELECT 1 FROM threads WHERE id = ${row.tid} AND forum_id = ${row.fid});`,
		);
	}

	const sqlText = `${sqlLines.join("\n")}\n`;
	const sqlPath = `${SQL_DIR}/01-recommend.sql`;
	writeFileSync(sqlPath, sqlText);

	const sqlBuf = Buffer.from(sqlText, "utf8");
	const sqlSha256 = createHash("sha256").update(sqlBuf).digest("hex");
	const statementCount = sqlLines.length;

	// Forums with > 6 active recommendations are worth surfacing —
	// none should exist in the source snapshot (display cap = 6, and
	// the source enforced it too), but we report so a future re-import
	// makes the drift loud instead of silently overflowing the card.
	const overCapForums = [...perFidCounts.entries()]
		.filter(([, n]) => n > 6)
		.map(([fid, n]) => ({ fid, count: n }));

	// Opt-in: if the operator passes --check-d1 <path>, open the
	// wrangler-local SQLite file and compute exactly how many of the
	// emitted statements will succeed vs. be EXISTS-skipped. This
	// answers the reviewer pin "dry-run must prove how many will be
	// written and how many skipped". Without the flag we emit the
	// SQL but cannot answer the skipped count — the SQL itself is
	// still self-defensive at apply time.
	const skipped = checkD1Path ? checkAgainstD1(checkD1Path, activeRows) : null;

	const report = {
		generated_at: new Date().toISOString(),
		import_epoch_seconds: importNow,
		source: {
			host: SSH_HOST,
			db: MYSQL_DB,
			table: "pre_forum_forumrecommend",
			filter: "position = 1",
		},
		target: {
			d1_table: "forum_recommended_threads",
			columns: ["forum_id", "thread_id", "recommended_at", "recommended_by"],
			sql_strategy:
				"EXISTS-guarded INSERT OR IGNORE (defends against missing forum/thread/forum-mismatch)",
			sql_pattern:
				"INSERT OR IGNORE INTO forum_recommended_threads (forum_id, thread_id, recommended_at, recommended_by) SELECT ?, ?, ?, 0 WHERE EXISTS (SELECT 1 FROM forums WHERE id = ?) AND EXISTS (SELECT 1 FROM threads WHERE id = ? AND forum_id = ?)",
			recommended_by_sentinel: 0,
		},
		counts: {
			rows_fetched_from_mysql: snapshot.length,
			active_rows_position_1: activeRows.length,
			archived_rows_skipped: archivedRows.length,
			distinct_forums: perFidCounts.size,
		},
		over_display_cap: {
			cap: 6,
			forums_over_cap: overCapForums,
		},
		sql_file: {
			path: sqlPath,
			sha256: sqlSha256,
			statement_count: statementCount,
		},
		// `null` when --check-d1 was not passed; populated with
		// (will_insert, skipped_*) when it was. Operators MUST run the
		// pre-check before applying to production so the actual delta
		// is observable.
		pre_check: skipped,
		per_fid: [...perFidCounts.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([fid, count]) => ({ fid, count })),
	};
	writeFileSync(`${DRYRUN_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

	console.log("");
	console.log("=== Forum Recommended-Threads Import — Dry Run ===");
	console.log(`  Rows fetched          : ${snapshot.length}`);
	console.log(`  Active (position=1)   : ${activeRows.length}`);
	console.log(`  Archived (skipped)    : ${archivedRows.length}`);
	console.log(`  Distinct forums       : ${perFidCounts.size}`);
	console.log(`  Forums over cap (6)   : ${overCapForums.length}`);
	console.log(`  Import epoch (s)      : ${importNow}`);
	console.log(`  SQL statements        : ${statementCount}`);
	console.log(`  SQL sha256            : ${sqlSha256}`);
	if (skipped) {
		console.log("");
		console.log("  --- D1 pre-check ---");
		console.log(`  Target D1             : ${skipped.d1_path}`);
		console.log(`  Target forums         : ${skipped.target_forums}`);
		console.log(`  Target threads        : ${skipped.target_threads}`);
		console.log(`  Will insert           : ${skipped.will_insert}`);
		console.log(`  Skip: missing forum   : ${skipped.skipped_missing_forum.length}`);
		console.log(`  Skip: missing thread  : ${skipped.skipped_missing_thread.length}`);
		console.log(`  Skip: forum mismatch  : ${skipped.skipped_forum_mismatch.length}`);
	} else {
		console.log("");
		console.log("  (no D1 pre-check — pass --check-d1 <path> to see skipped counts)");
	}
	console.log("");
	console.log("Artifacts:");
	console.log(`  ${SNAPSHOT_DIR}/forumrecommend.json`);
	console.log(`  ${sqlPath}`);
	console.log(`  ${DRYRUN_DIR}/report.json`);
}

main();
