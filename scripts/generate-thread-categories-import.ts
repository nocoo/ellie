#!/usr/bin/env bun
/**
 * Generate thread-categories prod import artifacts from a dry-run DB.
 *
 * Reads the dry-run SQLite (`output/dry-run-2026-05-14-thread-types/ellie.db`)
 * and emits 4 SQL chunks + manifest.json suitable for `wrangler d1 execute`
 * against production D1:
 *
 *   001-clear-stale-thread-types.sql
 *     Single UPDATE on threads — clear any stale type_id/type_name leftover
 *     from previous attempts. SAFE: only touches threads.type_id/type_name.
 *
 *   002-forums-thread-type-config.sql
 *     Per-forum UPDATE on forums.thread_types_{enabled,required,listable,prefix}.
 *     One statement per forum_id present in the dry-run DB.
 *
 *   003-forum-thread-types-NNN.sql
 *     INSERT (with explicit synthetic id + source_typeid) into
 *     forum_thread_types. Upsert form (ON CONFLICT(id) DO UPDATE) so a
 *     retry is idempotent. NO DELETE statements anywhere.
 *
 *   004-threads-typeid-NNN.sql
 *     UPDATE threads SET type_id=?, type_name=? WHERE id IN (...) — chunked
 *     by (type_id, type_name) groups so one statement covers many threads.
 *
 *   manifest.json — file ordering, row counts, target tables, source DB path.
 *
 * Step 4A discipline: this script generates files only. It never connects to
 * remote D1. Step 4B (separate command) feeds these files to wrangler.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { escapeSQL } from "../packages/migrate/src/load/d1-sql-builder";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		db: { type: "string" },
		out: { type: "string" },
		"thread-chunk-size": { type: "string" },
		"forum-thread-type-chunk-size": { type: "string" },
	},
});

const DB_PATH = values.db ?? "output/dry-run-2026-05-14-thread-types/ellie.db";
const OUT_DIR = values.out ?? "output/thread-categories-prod-import-2026-05-16";
// 004 threads-typeid: pack 1000 IDs per `WHERE id IN (...)` chunk; reviewer
// constraint is "avoid 118k row-by-row updates" while keeping every chunk
// well under D1's per-statement bind/row limits.
const THREAD_ID_CHUNK = Number(values["thread-chunk-size"] ?? "1000");
// 003 forum_thread_types: each forum gets its rows together; pack ~500 rows
// per file so a single SQL file stays small and easy to review.
const FORUM_THREAD_TYPE_ROWS_PER_FILE = Number(values["forum-thread-type-chunk-size"] ?? "500");

if (!existsSync(DB_PATH)) {
	console.error(`Error: dry-run DB not found at ${DB_PATH}`);
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

// Refuse to overwrite an existing non-empty artifact directory; reviewer
// reviews these files by name, accidental overwrite would be confusing.
const existing = readdirSync(OUT_DIR).filter((f) => f.endsWith(".sql") || f === "manifest.json");
if (existing.length > 0) {
	console.error(`Error: output dir ${OUT_DIR} already contains artifacts: ${existing.join(", ")}`);
	console.error("Remove or move them first.");
	process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

// ─── Counts (for manifest + sanity logging) ─────────────────────────────────

interface CountRow {
	c: number;
}

const forumThreadTypesTotal = (
	db.query("SELECT count(*) AS c FROM forum_thread_types").get() as CountRow
).c;
const forumThreadTypesEnabled = (
	db.query("SELECT count(*) AS c FROM forum_thread_types WHERE enabled = 1").get() as CountRow
).c;
const threadsTypeIdNonZero = (
	db.query("SELECT count(*) AS c FROM threads WHERE type_id <> 0").get() as CountRow
).c;
const threadsTypeIdNonZeroNameEmpty = (
	db
		.query("SELECT count(*) AS c FROM threads WHERE type_id <> 0 AND type_name = ''")
		.get() as CountRow
).c;
const threadsTypeIdZeroNameNonEmpty = (
	db
		.query("SELECT count(*) AS c FROM threads WHERE type_id = 0 AND type_name <> ''")
		.get() as CountRow
).c;
const forumsTotal = (db.query("SELECT count(*) AS c FROM forums").get() as CountRow).c;
const forumsWithThreadTypeFlags = (
	db
		.query(
			"SELECT count(*) AS c FROM forums WHERE thread_types_enabled<>0 OR thread_types_required<>0 OR thread_types_listable<>0 OR thread_types_prefix<>0",
		)
		.get() as CountRow
).c;

console.log(
	`Local dry-run counts (DB=${DB_PATH}):
  forum_thread_types total = ${forumThreadTypesTotal}, enabled = ${forumThreadTypesEnabled}
  forums total = ${forumsTotal}, with any thread_types_* flag set = ${forumsWithThreadTypeFlags}
  threads type_id<>0 = ${threadsTypeIdNonZero}
  threads type_id<>0 AND type_name='' = ${threadsTypeIdNonZeroNameEmpty}
  threads type_id=0 AND type_name<>'' = ${threadsTypeIdZeroNameNonEmpty}`,
);

// ─── 001 — clear stale threads.type_id/type_name in prod ───────────────────

const file001 = "001-clear-stale-thread-types.sql";
const sql001 = `-- 001 clear stale threads.type_id/type_name
-- Re-importer runs this first so the followup UPDATEs in 004 land on a
-- clean slate. Touches threads.type_id and threads.type_name only.
UPDATE threads SET type_id = 0, type_name = '' WHERE type_id <> 0 OR type_name <> '';
`;
writeFileSync(`${OUT_DIR}/${file001}`, sql001);

// ─── 002 — forums.thread_types_{enabled,required,listable,prefix} ──────────

interface ForumFlagsRow {
	id: number;
	thread_types_enabled: number;
	thread_types_required: number;
	thread_types_listable: number;
	thread_types_prefix: number;
}

const forumFlagRows = db
	.query(
		"SELECT id, thread_types_enabled, thread_types_required, thread_types_listable, thread_types_prefix FROM forums ORDER BY id",
	)
	.all() as ForumFlagsRow[];

const file002 = "002-forums-thread-type-config.sql";
const sql002Lines: string[] = [
	"-- 002 forums.thread_types_{enabled,required,listable,prefix}",
	"-- One UPDATE per forum so the four switches always reflect the dry-run",
	"-- DB (which is the source of truth for the Discuz forumfield config).",
	"-- Touches forums.thread_types_* columns only; nothing else.",
	"",
];
for (const r of forumFlagRows) {
	sql002Lines.push(
		`UPDATE forums SET thread_types_enabled=${r.thread_types_enabled}, thread_types_required=${r.thread_types_required}, thread_types_listable=${r.thread_types_listable}, thread_types_prefix=${r.thread_types_prefix} WHERE id=${r.id};`,
	);
}
writeFileSync(`${OUT_DIR}/${file002}`, `${sql002Lines.join("\n")}\n`);

// ─── 003 — forum_thread_types upsert with explicit synthetic id ────────────

interface ForumThreadTypeRow {
	id: number;
	forum_id: number;
	source_typeid: number;
	name: string;
	display_order: number;
	icon: string;
	enabled: number;
	moderator_only: number;
}

const ftRows = db
	.query(
		"SELECT id, forum_id, source_typeid, name, display_order, icon, enabled, moderator_only FROM forum_thread_types ORDER BY id",
	)
	.all() as ForumThreadTypeRow[];

const ftFiles: { name: string; rows: number }[] = [];
let ftChunkIdx = 0;
for (let i = 0; i < ftRows.length; i += FORUM_THREAD_TYPE_ROWS_PER_FILE) {
	ftChunkIdx += 1;
	const slice = ftRows.slice(i, i + FORUM_THREAD_TYPE_ROWS_PER_FILE);
	const fname = `003-forum-thread-types-${String(ftChunkIdx).padStart(3, "0")}.sql`;
	const lines: string[] = [
		`-- 003 forum_thread_types chunk ${ftChunkIdx} (${slice.length} rows of ${ftRows.length})`,
		"-- INSERT ... ON CONFLICT(id) DO UPDATE so retries are idempotent.",
		"-- Writes only forum_thread_types; no DELETE, no other tables touched.",
		"",
	];
	for (const r of slice) {
		lines.push(
			`INSERT INTO forum_thread_types (id, forum_id, source_typeid, name, display_order, icon, enabled, moderator_only) VALUES (${r.id}, ${r.forum_id}, ${r.source_typeid}, ${escapeSQL(r.name)}, ${r.display_order}, ${escapeSQL(r.icon)}, ${r.enabled}, ${r.moderator_only}) ON CONFLICT(id) DO UPDATE SET forum_id=excluded.forum_id, source_typeid=excluded.source_typeid, name=excluded.name, display_order=excluded.display_order, icon=excluded.icon, enabled=excluded.enabled, moderator_only=excluded.moderator_only;`,
		);
	}
	writeFileSync(`${OUT_DIR}/${fname}`, `${lines.join("\n")}\n`);
	ftFiles.push({ name: fname, rows: slice.length });
}

// ─── 004 — threads UPDATE chunked by (type_id, type_name) ──────────────────

interface ThreadRow {
	id: number;
	type_id: number;
	type_name: string;
}

const threadRows = db
	.query(
		"SELECT id, type_id, type_name FROM threads WHERE type_id <> 0 ORDER BY type_id, type_name, id",
	)
	.all() as ThreadRow[];

// Group consecutive rows by (type_id, type_name) since we ordered by those.
interface ThreadGroup {
	typeId: number;
	typeName: string;
	ids: number[];
}
const groups: ThreadGroup[] = [];
let curr: ThreadGroup | null = null;
for (const r of threadRows) {
	if (!curr || curr.typeId !== r.type_id || curr.typeName !== r.type_name) {
		curr = { typeId: r.type_id, typeName: r.type_name, ids: [] };
		groups.push(curr);
	}
	curr.ids.push(r.id);
}

// Spread groups into files. Each statement is one `UPDATE ... WHERE id IN
// (THREAD_ID_CHUNK ids)`. Pack a few statements per file but keep file size
// modest — review-friendly + well under wrangler's per-statement limits.
const STATEMENTS_PER_FILE = 100; // ~100 statements * 1000 ids = 100k id-tokens/file max
const threadFiles: { name: string; statements: number; updates: number }[] = [];
let stmtsBuffer: string[] = [];
let threadFileIdx = 0;
let pendingUpdates = 0;
let pendingStatements = 0;

function flushThreadsFile() {
	if (stmtsBuffer.length === 0) return;
	threadFileIdx += 1;
	const fname = `004-threads-typeid-${String(threadFileIdx).padStart(3, "0")}.sql`;
	const header = [
		`-- 004 threads.type_id/type_name backfill chunk ${threadFileIdx}`,
		`-- ${pendingStatements} statements, ${pendingUpdates} thread rows`,
		"-- UPDATE threads SET type_id=?, type_name=? WHERE id IN (...) — grouped by",
		"-- (type_id, type_name); touches only threads.type_id and threads.type_name.",
		"",
	].join("\n");
	writeFileSync(`${OUT_DIR}/${fname}`, `${header}\n${stmtsBuffer.join("\n")}\n`);
	threadFiles.push({
		name: fname,
		statements: pendingStatements,
		updates: pendingUpdates,
	});
	stmtsBuffer = [];
	pendingStatements = 0;
	pendingUpdates = 0;
}

let totalThreadUpdates = 0;
for (const g of groups) {
	for (let i = 0; i < g.ids.length; i += THREAD_ID_CHUNK) {
		const idSlice = g.ids.slice(i, i + THREAD_ID_CHUNK);
		const stmt = `UPDATE threads SET type_id=${g.typeId}, type_name=${escapeSQL(g.typeName)} WHERE id IN (${idSlice.join(",")});`;
		stmtsBuffer.push(stmt);
		pendingStatements += 1;
		pendingUpdates += idSlice.length;
		totalThreadUpdates += idSlice.length;
		if (pendingStatements >= STATEMENTS_PER_FILE) {
			flushThreadsFile();
		}
	}
}
flushThreadsFile();

// ─── manifest.json ──────────────────────────────────────────────────────────

const manifest = {
	generatedAt: new Date().toISOString(),
	sourceDb: DB_PATH,
	notes: [
		"Step 4A artifact — generate only, do not execute against remote D1.",
		"Apply order: 001 → 002 → 003-* → 004-*.",
		"Tables touched: threads.type_id, threads.type_name, forums.thread_types_*, forum_thread_types (full rows).",
	],
	counts: {
		forumThreadTypesTotal,
		forumThreadTypesEnabled,
		forumsTotal,
		forumsWithThreadTypeFlags,
		threadsTypeIdNonZero,
		threadsTypeIdNonZeroNameEmpty,
		threadsTypeIdZeroNameNonEmpty,
		expectedThreadUpdates: threadsTypeIdNonZero,
		actualThreadUpdates: totalThreadUpdates,
	},
	files: [
		{
			name: file001,
			targetTable: "threads",
			statements: 1,
			updates: "WHERE type_id<>0 OR type_name<>'' (UNKNOWN remote count)",
		},
		{
			name: file002,
			targetTable: "forums",
			statements: forumFlagRows.length,
			updates: forumFlagRows.length,
		},
		...ftFiles.map((f) => ({
			name: f.name,
			targetTable: "forum_thread_types",
			statements: f.rows,
			updates: f.rows,
		})),
		...threadFiles.map((f) => ({
			name: f.name,
			targetTable: "threads",
			statements: f.statements,
			updates: f.updates,
		})),
	],
};

writeFileSync(`${OUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, "\t")}\n`);

// ─── Summary log ───────────────────────────────────────────────────────────

const all = readdirSync(OUT_DIR)
	.sort()
	.map((f) => ({ name: f, size: statSync(`${OUT_DIR}/${f}`).size }));
const totalSize = all.reduce((acc, f) => acc + f.size, 0);

console.log(
	`\nWrote ${all.length} files to ${OUT_DIR} (${(totalSize / 1024).toFixed(1)} KB total):`,
);
for (const f of all) {
	console.log(`  ${f.name}\t${f.size} bytes`);
}
console.log(
	`\nthread update sanity: dry-run type_id<>0 = ${threadsTypeIdNonZero}, 004 covers = ${totalThreadUpdates}, match = ${threadsTypeIdNonZero === totalThreadUpdates}`,
);

db.close();
