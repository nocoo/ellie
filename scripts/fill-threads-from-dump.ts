#!/usr/bin/env bun
/**
 * Local threads loader — populate `threads` in an existing dry-run ellie.db
 * from `pre_forum_thread` (+ shards) in the 5/14 monolithic dump.
 *
 * Why this exists (Step 4A 局部脚本):
 *   `@ellie/migrate start ...` hangs in `pre_common_member_count_archive`
 *   parsing on the 5/14 monolithic dump — 67 ~1MB INSERT lines deadlock
 *   the node:zlib + readline stream pair under Bun (main thread in
 *   `kevent64`, all Bun pool threads in `__ulock_wait2`). The hang is in
 *   the USERS phase, well before the threads phase. Re-running migrate
 *   to fix is out of scope for Step 4A; this script does only what
 *   Step 4A needs: load the threads table so the generator can read it.
 *
 * What it does (and what it explicitly does NOT do):
 *   ✓ Reads `forums` + `forum_thread_types` already populated in
 *     `ellie.db` (snapshot exists at `ellie.before-thread-fill.db`).
 *   ✓ Builds `(forum_id, source_typeid) -> synthetic id/name` maps from
 *     the forum_thread_types rows already in the DB — same logic as
 *     `buildForumThreadTypeNameMap` / `syntheticIdMap` from the migrate
 *     transform pass.
 *   ✓ Streams `pre_forum_thread` + shards from the dump via
 *     `Bun.spawn(["gunzip","-c", path])` (NOT node:zlib+readline) and
 *     uses the existing `parseInsertLine` / `extractThread` to keep the
 *     extraction behavior identical to the full migrate pipeline.
 *   ✓ Inserts rows into `threads` with `PRAGMA foreign_keys=OFF` so
 *     missing users/forums in the half-finished DB don't fail the load
 *     (this DB is artifact-only — Step 4B writes to remote D1 directly).
 *   ✗ Does NOT migrate users, posts, attachments, comments, checkins.
 *   ✗ Does NOT touch migrate source code.
 *   ✗ Does NOT compute integrity/perf metrics — those belong to a
 *     full ETL, not the 主题分类 delta.
 *
 * Output: log to stdout with diagnostic counts shaped like the
 * threads phase of migrate.log so the reviewer can compare to the
 * 2026-05-08 dry-run on the same forums.
 */

import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { extractThread } from "../packages/migrate/src/extract/extractors";
import { parseInsertLine } from "../packages/migrate/src/extract/parser";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		db: { type: "string" },
		dump: { type: "string" },
	},
});

const DB_PATH = values.db ?? "output/dry-run-2026-05-14-thread-types/ellie.db";
const DUMP_PATH = values.dump ?? "reference/db/2026-05-14/db_tongji_main_full.sql.gz";

if (!existsSync(DB_PATH)) {
	console.error(`Error: ellie.db not found at ${DB_PATH}`);
	process.exit(1);
}
if (!existsSync(DUMP_PATH)) {
	console.error(`Error: dump not found at ${DUMP_PATH}`);
	process.exit(1);
}

// ─── Connect to existing dry-run DB ────────────────────────────────────────

const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");
// Disable FK so missing users/forums don't fail the load. This DB is
// artifact-only — Step 4B feeds remote D1 directly via SQL chunks.
db.run("PRAGMA foreign_keys = OFF");

// Sanity check: forums + forum_thread_types must already be populated.
const counts = db
	.query<{ table: string; c: number }, []>(
		`SELECT 'forums' AS [table], count(*) AS c FROM forums
         UNION ALL SELECT 'forum_thread_types', count(*) FROM forum_thread_types
         UNION ALL SELECT 'threads', count(*) FROM threads`,
	)
	.all();
const countMap = new Map<string, number>(counts.map((r) => [r.table, r.c]));
console.log("[pre-load] existing DB state:");
for (const r of counts) console.log(`  ${r.table} = ${r.c}`);
if ((countMap.get("forums") ?? 0) === 0) {
	console.error("Error: forums table is empty — run migrate to forums phase first");
	process.exit(1);
}
if ((countMap.get("forum_thread_types") ?? 0) === 0) {
	console.error(
		"Error: forum_thread_types table is empty — run migrate to forum thread types phase first",
	);
	process.exit(1);
}
if ((countMap.get("threads") ?? 0) > 0) {
	console.error(
		`Error: threads table already has ${countMap.get("threads")} rows. Refusing to append.`,
	);
	console.error("Restore from ellie.before-thread-fill.db first if you want to re-run.");
	process.exit(1);
}

// ─── Build per-forum maps from forum_thread_types rows ─────────────────────

interface FthRow {
	id: number;
	forum_id: number;
	source_typeid: number;
	name: string;
}
const fthRows = db
	.query<FthRow, []>("SELECT id, forum_id, source_typeid, name FROM forum_thread_types ORDER BY id")
	.all();

// (fid → source_typeid → synthetic id)
const syntheticIdMap = new Map<number, Map<number, number>>();
// (fid → source_typeid → name) for type_name resolution.
const nameMap = new Map<number, Map<number, string>>();
for (const r of fthRows) {
	if (r.source_typeid <= 0) continue;
	let synBucket = syntheticIdMap.get(r.forum_id);
	if (!synBucket) {
		synBucket = new Map();
		syntheticIdMap.set(r.forum_id, synBucket);
	}
	synBucket.set(r.source_typeid, r.id);

	let nameBucket = nameMap.get(r.forum_id);
	if (!nameBucket) {
		nameBucket = new Map();
		nameMap.set(r.forum_id, nameBucket);
	}
	nameBucket.set(r.source_typeid, r.name);
}
console.log(
	`[maps] synthetic-id forums = ${syntheticIdMap.size}, name forums = ${nameMap.size}, total fth rows = ${fthRows.length}`,
);

// ─── Stream parser (gunzip subprocess + manual line buffer) ────────────────

/**
 * Stream-parse a gzipped dump and yield rows for a target table.
 *
 * We avoid node:zlib + node:readline because the 5/14 monolithic dump
 * contains 1-row-per-INSERT lines around 1MB; the readline transform
 * deadlocks on these (observed: main thread parked in kevent64 forever).
 * Instead we spawn `gunzip -c` and consume stdout via a buffer-and-split
 * loop, which has no per-line size assumption.
 */
async function* streamLines(path: string): AsyncGenerator<string> {
	const child = spawn("gunzip", ["-c", path], { stdio: ["ignore", "pipe", "inherit"] });
	const stdout = child.stdout;
	if (!stdout) throw new Error("gunzip stdout not available");
	let buf = "";
	for await (const chunk of stdout) {
		buf += (chunk as Buffer).toString("utf8");
		let nl = buf.indexOf("\n");
		while (nl >= 0) {
			yield buf.substring(0, nl);
			buf = buf.substring(nl + 1);
			nl = buf.indexOf("\n");
		}
	}
	if (buf.length > 0) yield buf;
	await new Promise<void>((resolve, reject) => {
		child.on("exit", (code) => {
			if (code === 0 || code === null) resolve();
			else reject(new Error(`gunzip exited with code ${code}`));
		});
		child.on("error", reject);
	});
}

// ─── Stream rows from one table prefix ─────────────────────────────────────

interface ParseStats {
	rawTotal: number; // raw INSERT rows seen
	inserted: number; // pushed to threads
	skippedCorrupt: number; // extractThread returned null
	rawSourceTypeidPositive: number;
	mapped: number; // synthetic id resolved
	unmapped: number; // raw>0 but no synthetic id
}

interface ThreadRecord {
	id: number;
	forum_id: number;
	author_id: number;
	author_name: string;
	subject: string;
	created_at: number;
	last_post_at: number;
	last_poster: string;
	replies: number;
	views: number;
	closed: number;
	sticky: number;
	digest: number;
	special: number;
	highlight: number;
	recommends: number;
	post_table_id: number;
	type_name: string;
	type_id: number;
}

const insertSql = `INSERT INTO threads (
	id, forum_id, author_id, author_name, subject, created_at, last_post_at,
	last_poster, replies, views, closed, sticky, digest, special, highlight,
	recommends, post_table_id, type_name, type_id
) VALUES (
	$id, $forum_id, $author_id, $author_name, $subject, $created_at, $last_post_at,
	$last_poster, $replies, $views, $closed, $sticky, $digest, $special, $highlight,
	$recommends, $post_table_id, $type_name, $type_id
)`;
const insertStmt = db.prepare(insertSql);

const BATCH = 500;
let pending: ThreadRecord[] = [];

function flush(): void {
	if (pending.length === 0) return;
	const tx = db.transaction((batch: ThreadRecord[]) => {
		for (const r of batch) {
			insertStmt.run({
				$id: r.id,
				$forum_id: r.forum_id,
				$author_id: r.author_id,
				$author_name: r.author_name,
				$subject: r.subject,
				$created_at: r.created_at,
				$last_post_at: r.last_post_at,
				$last_poster: r.last_poster,
				$replies: r.replies,
				$views: r.views,
				$closed: r.closed,
				$sticky: r.sticky,
				$digest: r.digest,
				$special: r.special,
				$highlight: r.highlight,
				$recommends: r.recommends,
				$post_table_id: r.post_table_id,
				$type_name: r.type_name,
				$type_id: r.type_id,
			});
		}
	});
	tx(pending);
	pending = [];
}

async function loadTable(table: string, stats: ParseStats): Promise<number> {
	const prefix = `INSERT INTO \`${table}\` VALUES `;
	let tableRows = 0;
	let lineCount = 0;
	const t0 = Date.now();
	for await (const line of streamLines(DUMP_PATH)) {
		lineCount++;
		if (!line.startsWith(prefix)) continue;
		const rows = parseInsertLine(line, table);
		for (const row of rows) {
			stats.rawTotal++;
			const sourceTypeid = Number(row[3]) || 0; // THREAD_COLS.typeid = 3
			const record = extractThread(row, undefined, nameMap, syntheticIdMap);
			if (!record) {
				stats.skippedCorrupt++;
				continue;
			}
			if (sourceTypeid > 0) {
				stats.rawSourceTypeidPositive++;
				if ((record.type_id as number) !== 0) stats.mapped++;
				else stats.unmapped++;
			}
			pending.push(record as ThreadRecord);
			stats.inserted++;
			tableRows++;
			if (pending.length >= BATCH) flush();
			if (stats.inserted % 10000 === 0) {
				console.log(
					`  [${table}] ${stats.inserted} inserted (${tableRows} from this table, line ${lineCount})`,
				);
			}
		}
	}
	flush();
	console.log(`  [${table}] DONE — ${tableRows} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	return tableRows;
}

const stats: ParseStats = {
	rawTotal: 0,
	inserted: 0,
	skippedCorrupt: 0,
	rawSourceTypeidPositive: 0,
	mapped: 0,
	unmapped: 0,
};

console.log(`\n[load] parsing pre_forum_thread (+ shards) from ${DUMP_PATH}`);

await loadTable("pre_forum_thread", stats);
for (let i = 1; i <= 7; i++) {
	const table = `pre_forum_thread_${i}`;
	try {
		await loadTable(table, stats);
	} catch (e) {
		console.log(`  [${table}] skipped (${(e as Error).message})`);
	}
}

// ─── Post-load summary (matches Step 4A reviewer ask) ──────────────────────

interface SummaryRow {
	c: number;
}
const totalThreads = (db.query("SELECT count(*) AS c FROM threads").get() as SummaryRow).c;
const typeIdNonZero = (
	db.query("SELECT count(*) AS c FROM threads WHERE type_id <> 0").get() as SummaryRow
).c;
const typeNameNonEmpty = (
	db.query("SELECT count(*) AS c FROM threads WHERE type_name <> ''").get() as SummaryRow
).c;
const typeIdNzNameEmpty = (
	db
		.query("SELECT count(*) AS c FROM threads WHERE type_id <> 0 AND type_name = ''")
		.get() as SummaryRow
).c;
const typeIdZeroNameNz = (
	db
		.query("SELECT count(*) AS c FROM threads WHERE type_id = 0 AND type_name <> ''")
		.get() as SummaryRow
).c;
const fthTotal = (db.query("SELECT count(*) AS c FROM forum_thread_types").get() as SummaryRow).c;
const fthEnabled = (
	db.query("SELECT count(*) AS c FROM forum_thread_types WHERE enabled = 1").get() as SummaryRow
).c;

console.log("\n[summary] threads phase result");
console.log(`  threads total                 = ${totalThreads}`);
console.log(`  threads type_id<>0            = ${typeIdNonZero}`);
console.log(`  threads type_name<>''         = ${typeNameNonEmpty}`);
console.log(`  threads type_id<>0 name=''    = ${typeIdNzNameEmpty}`);
console.log(`  threads type_id=0  name<>''   = ${typeIdZeroNameNz}`);
console.log(`  forum_thread_types total      = ${fthTotal}`);
console.log(`  forum_thread_types enabled    = ${fthEnabled}`);
console.log("\n[summary] mapping coverage");
console.log(`  raw rows parsed               = ${stats.rawTotal}`);
console.log(`  inserted                      = ${stats.inserted}`);
console.log(`  skipped corrupt               = ${stats.skippedCorrupt}`);
console.log(`  raw source typeid > 0         = ${stats.rawSourceTypeidPositive}`);
console.log(`  mapped (synthetic id minted)  = ${stats.mapped}`);
console.log(`  unmapped (raw>0, syn=0)       = ${stats.unmapped}`);

// 134/147/113 per-forum reconciliation (reviewer ask).
interface PerForumRow {
	forum_id: number;
	total: number;
	with_type: number;
}
const perForum = db
	.query<PerForumRow, []>(
		`SELECT forum_id, count(*) AS total,
                sum(CASE WHEN type_id <> 0 THEN 1 ELSE 0 END) AS with_type
         FROM threads WHERE forum_id IN (134, 147, 113) GROUP BY forum_id ORDER BY forum_id`,
	)
	.all();
console.log("\n[summary] 134/147/113 per-forum");
for (const r of perForum) {
	console.log(`  fid=${r.forum_id}: total=${r.total}, type_id<>0=${r.with_type}`);
}

db.close();
console.log("\n[done] threads load complete");
