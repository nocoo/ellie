/**
 * D1 import SQL generator — reads from local dry-run SQLite and generates
 * SQL chunk files for production D1 import.
 *
 * Strategy:
 *   - forums/users/checkins: INSERT ON CONFLICT DO UPDATE (source-owned cols only)
 *   - threads/posts/attachments: INSERT OR IGNORE, filtered by production max_id
 *
 * Usage:
 *   bun run packages/migrate/src/generate-d1-sql.ts \
 *     --db output/dry-run-2026-05-09/ellie.db \
 *     --out output/d1-import-2026-05-09 \
 *     --production-state packages/migrate/production-state.json
 *
 * Output:
 *   output/d1-import-2026-05-09/
 *     manifest.json          — chunk list, row counts, strategy per table
 *     forums-001.sql         — upsert SQL
 *     users-001.sql ... NNN  — upsert SQL chunks
 *     user_checkins-001.sql  — upsert SQL
 *     threads-001.sql ... N  — incremental INSERT OR IGNORE (id > prod max_id)
 *     posts-001.sql ... N    — incremental INSERT OR IGNORE (id > prod max_id)
 *     attachments-001.sql    — incremental INSERT OR IGNORE (id > prod max_id)
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { ChunkInfo, Manifest, ProductionState } from "./load/d1-sql-builder";
import { chunkFileName, formatInsertOrIgnoreChunk, formatUpsertChunk } from "./load/d1-sql-builder";
import {
	CHECKINS_UPSERT_COLUMNS,
	FORUMS_UPSERT_COLUMNS,
	TABLE_COLUMNS,
	USERS_UPSERT_COLUMNS,
} from "./load/schema";

// ─── CLI ────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		db: { type: "string" },
		out: { type: "string" },
		"production-state": { type: "string" },
		force: { type: "boolean", default: false },
	},
});

const DB_PATH = values.db ?? "output/dry-run-2026-05-09/ellie.db";
const OUT_DIR = values.out ?? "output/d1-import-2026-05-09";
const PROD_STATE_PATH = values["production-state"] ?? "packages/migrate/production-state.json";
const FORCE = values.force ?? false;
const CHUNK_SIZE = 5000; // rows per SQL file (D1 has statement limits)

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

function loadProductionState(path: string): ProductionState {
	if (!existsSync(path)) {
		throw new Error(`Production state file not found: ${path}`);
	}
	return JSON.parse(readFileSync(path, "utf-8")) as ProductionState;
}

// ─── Upsert generator ──────────────────────────────────────────────────────

function generateUpsertChunks(
	db: Database,
	table: string,
	columns: string[],
	conflictColumn: string,
	updateColumns: string[],
	outDir: string,
): { chunks: ChunkInfo[]; totalRows: number } {
	const chunks: ChunkInfo[] = [];
	const totalRows = (db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt;
	log(`  ${table}: ${totalRows.toLocaleString()} rows → upsert (all rows)`);

	let chunkNum = 0;
	let offset = 0;

	while (offset < totalRows) {
		chunkNum++;
		const rows = db
			.query(`SELECT ${columns.join(",")} FROM ${table} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`)
			.all() as Array<Record<string, string | number | null>>;

		if (rows.length === 0) break;

		const { content, bytes } = formatUpsertChunk(
			table,
			columns,
			conflictColumn,
			updateColumns,
			rows,
		);
		const fileName = chunkFileName(table, chunkNum);
		writeFileSync(`${outDir}/${fileName}`, content);
		chunks.push({ file: fileName, table, rows: rows.length, bytes, strategy: "upsert" });
		offset += CHUNK_SIZE;
	}

	return { chunks, totalRows };
}

// ─── Incremental INSERT OR IGNORE generator (filtered by prod max_id) ─────

function generateIncrementalChunks(
	db: Database,
	table: string,
	columns: string[],
	prodMaxId: number,
	outDir: string,
): { chunks: ChunkInfo[]; totalRows: number; filteredRows: number } {
	const chunks: ChunkInfo[] = [];
	const totalRows = (db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt;
	const filteredRows = (
		db.query(`SELECT COUNT(*) as cnt FROM ${table} WHERE id > ${prodMaxId}`).get() as {
			cnt: number;
		}
	).cnt;
	log(
		`  ${table}: ${totalRows.toLocaleString()} total, ${filteredRows.toLocaleString()} new (id > ${prodMaxId}) → INSERT OR IGNORE`,
	);

	let chunkNum = 0;
	let offset = 0;

	while (offset < filteredRows) {
		chunkNum++;
		const rows = db
			.query(
				`SELECT ${columns.join(",")} FROM ${table} WHERE id > ${prodMaxId} ORDER BY id LIMIT ${CHUNK_SIZE} OFFSET ${offset}`,
			)
			.all() as Array<Record<string, string | number | null>>;

		if (rows.length === 0) break;

		const { content, bytes } = formatInsertOrIgnoreChunk(table, columns, rows);
		const fileName = chunkFileName(table, chunkNum);
		writeFileSync(`${outDir}/${fileName}`, content);
		chunks.push({ file: fileName, table, rows: rows.length, bytes, strategy: "insert_or_ignore" });
		offset += CHUNK_SIZE;
	}

	return { chunks, totalRows, filteredRows };
}

// ─── Main ───────────────────────────────────────────────────────────────────

log("=== D1 Import SQL Generator ===");
log(`  Source DB:         ${DB_PATH}`);
log(`  Production state:  ${PROD_STATE_PATH}`);
log(`  Output:            ${OUT_DIR}`);
log(`  Chunk size:        ${CHUNK_SIZE} rows/file`);

// Load production state
const prodState = loadProductionState(PROD_STATE_PATH);
log(`  Production DB:     ${prodState.database.name} (${prodState.database.id})`);
log(`  Backup captured:   ${prodState.captured_at}`);

// Output directory protection
if (existsSync(OUT_DIR)) {
	if (!FORCE) {
		console.error(
			`Error: Output directory already exists: ${OUT_DIR}\nUse --force to clear and regenerate.`,
		);
		process.exit(1);
	}
	log("  Clearing existing output directory (--force)");
	rmSync(OUT_DIR, { recursive: true });
}
mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });
const allChunks: ChunkInfo[] = [];
const tableStats: Record<
	string,
	{
		strategy: string;
		prod_max_id: number | null;
		source_total_rows: number;
		source_rows_after_max: number | null;
		chunks: number;
		rows: number;
		files: string[];
	}
> = {};

// Helper to record table stats
function recordTableStats(
	table: string,
	strategy: string,
	chunks: ChunkInfo[],
	totalRows: number,
	prodMaxId: number | null,
	filteredRows: number | null,
): void {
	allChunks.push(...chunks);
	tableStats[table] = {
		strategy,
		prod_max_id: prodMaxId,
		source_total_rows: totalRows,
		source_rows_after_max: filteredRows,
		chunks: chunks.length,
		rows: chunks.reduce((sum, c) => sum + c.rows, 0),
		files: chunks.map((c) => c.file),
	};
}

// 1. Forums — upsert (all rows)
log("Generating forums...");
const forumsResult = generateUpsertChunks(
	db,
	"forums",
	TABLE_COLUMNS.forums,
	"id",
	FORUMS_UPSERT_COLUMNS,
	OUT_DIR,
);
recordTableStats("forums", "upsert", forumsResult.chunks, forumsResult.totalRows, null, null);

// 2. Users — upsert (all rows)
log("Generating users...");
const usersResult = generateUpsertChunks(
	db,
	"users",
	TABLE_COLUMNS.users,
	"id",
	USERS_UPSERT_COLUMNS,
	OUT_DIR,
);
recordTableStats("users", "upsert", usersResult.chunks, usersResult.totalRows, null, null);

// 3. Threads — incremental (id > prod max_id)
log("Generating threads...");
const threadsProdMaxId = prodState.tables.threads?.max_id ?? 0;
const threadsResult = generateIncrementalChunks(
	db,
	"threads",
	TABLE_COLUMNS.threads,
	threadsProdMaxId,
	OUT_DIR,
);
recordTableStats(
	"threads",
	"insert_or_ignore",
	threadsResult.chunks,
	threadsResult.totalRows,
	threadsProdMaxId,
	threadsResult.filteredRows,
);

// 4. Posts — incremental (id > prod max_id)
log("Generating posts...");
const postsProdMaxId = prodState.tables.posts?.max_id ?? 0;
const postsResult = generateIncrementalChunks(
	db,
	"posts",
	TABLE_COLUMNS.posts,
	postsProdMaxId,
	OUT_DIR,
);
recordTableStats(
	"posts",
	"insert_or_ignore",
	postsResult.chunks,
	postsResult.totalRows,
	postsProdMaxId,
	postsResult.filteredRows,
);

// 5. Attachments — incremental (id > prod max_id)
log("Generating attachments...");
const attachProdMaxId = prodState.tables.attachments?.max_id ?? 0;
const attachResult = generateIncrementalChunks(
	db,
	"attachments",
	TABLE_COLUMNS.attachments,
	attachProdMaxId,
	OUT_DIR,
);
recordTableStats(
	"attachments",
	"insert_or_ignore",
	attachResult.chunks,
	attachResult.totalRows,
	attachProdMaxId,
	attachResult.filteredRows,
);

// 6. Checkins — upsert (all rows)
log("Generating user_checkins...");
const checkinsResult = generateUpsertChunks(
	db,
	"user_checkins",
	TABLE_COLUMNS.user_checkins,
	"user_id",
	CHECKINS_UPSERT_COLUMNS,
	OUT_DIR,
);
recordTableStats(
	"user_checkins",
	"upsert",
	checkinsResult.chunks,
	checkinsResult.totalRows,
	null,
	null,
);

db.close();

// Build manifest
const manifest: Manifest = {
	generated_at: new Date().toISOString(),
	source_db: DB_PATH,
	chunk_size: CHUNK_SIZE,
	production_state: prodState,
	total_chunks: allChunks.length,
	total_rows: allChunks.reduce((sum, c) => sum + c.rows, 0),
	tables: tableStats,
	chunks: allChunks,
};

writeFileSync(`${OUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, "\t")}\n`);

// Summary
log("=== Summary ===");
for (const [table, info] of Object.entries(manifest.tables)) {
	const maxIdNote =
		info.prod_max_id !== null
			? ` (prod max_id=${info.prod_max_id}, new=${info.source_rows_after_max})`
			: "";
	log(
		`  ${table}: ${info.rows.toLocaleString()} rows → ${info.chunks} chunks (${info.strategy})${maxIdNote}`,
	);
}
const totalBytes = allChunks.reduce((sum, c) => sum + c.bytes, 0);
log(
	`  Total: ${manifest.total_rows.toLocaleString()} rows in ${manifest.total_chunks} chunks (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
);
log(`  Manifest: ${OUT_DIR}/manifest.json`);
