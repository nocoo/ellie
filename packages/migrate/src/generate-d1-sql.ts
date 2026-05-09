/**
 * D1 import SQL generator — reads from local dry-run SQLite and generates
 * SQL chunk files for production D1 import.
 *
 * Strategy:
 *   - forums/users/checkins: INSERT ON CONFLICT DO UPDATE (source-owned cols only)
 *   - threads/posts/attachments: INSERT OR IGNORE (skip existing IDs)
 *
 * Usage:
 *   bun run packages/migrate/src/generate-d1-sql.ts \
 *     --db output/dry-run-2026-05-09/ellie.db \
 *     --out output/d1-import-2026-05-09
 *
 * Output:
 *   output/d1-import-2026-05-09/
 *     manifest.json          — chunk list, row counts, strategy per table
 *     forums-001.sql         — upsert SQL
 *     users-001.sql ... NNN  — upsert SQL chunks
 *     user_checkins-001.sql  — upsert SQL
 *     threads-001.sql ... N  — incremental INSERT OR IGNORE
 *     posts-001.sql ... N    — incremental INSERT OR IGNORE
 *     attachments-001.sql    — incremental INSERT OR IGNORE
 */

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
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
	},
});

const DB_PATH = values.db ?? "output/dry-run-2026-05-09/ellie.db";
const OUT_DIR = values.out ?? "output/d1-import-2026-05-09";
const CHUNK_SIZE = 5000; // rows per SQL file (D1 has statement limits)

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeSQL(val: string | number | null): string {
	if (val === null) return "NULL";
	if (typeof val === "number") return String(val);
	// Escape single quotes by doubling them
	return `'${String(val).replace(/'/g, "''")}'`;
}

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

interface ChunkInfo {
	file: string;
	table: string;
	rows: number;
	strategy: "upsert" | "insert_or_ignore";
}

// ─── Upsert generator ──────────────────────────────────────────────────────

function generateUpsertChunks(
	db: Database,
	table: string,
	columns: string[],
	conflictColumn: string,
	updateColumns: string[],
	outDir: string,
): ChunkInfo[] {
	const chunks: ChunkInfo[] = [];
	const totalRows = (db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt;
	log(`  ${table}: ${totalRows.toLocaleString()} rows → upsert`);

	const updateSet = updateColumns.map((col) => `${col} = excluded.${col}`).join(",\n    ");

	let chunkNum = 0;
	let offset = 0;

	while (offset < totalRows) {
		chunkNum++;
		const rows = db
			.query(`SELECT ${columns.join(",")} FROM ${table} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`)
			.all() as Array<Record<string, string | number | null>>;

		if (rows.length === 0) break;

		const statements: string[] = [];
		for (const row of rows) {
			const vals = columns.map((col) => escapeSQL(row[col]));
			statements.push(
				`INSERT INTO ${table} (${columns.join(",")}) VALUES (${vals.join(",")}) ON CONFLICT(${conflictColumn}) DO UPDATE SET\n    ${updateSet};`,
			);
		}

		const fileName = `${table}-${String(chunkNum).padStart(3, "0")}.sql`;
		writeFileSync(`${outDir}/${fileName}`, `${statements.join("\n\n")}\n`);
		chunks.push({ file: fileName, table, rows: rows.length, strategy: "upsert" });
		offset += CHUNK_SIZE;
	}

	return chunks;
}

// ─── Incremental INSERT OR IGNORE generator ─────────────────────────────────

function generateIncrementalChunks(
	db: Database,
	table: string,
	columns: string[],
	outDir: string,
): ChunkInfo[] {
	const chunks: ChunkInfo[] = [];
	const totalRows = (db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt;
	log(`  ${table}: ${totalRows.toLocaleString()} rows → INSERT OR IGNORE`);

	let chunkNum = 0;
	let offset = 0;

	while (offset < totalRows) {
		chunkNum++;
		const rows = db
			.query(`SELECT ${columns.join(",")} FROM ${table} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`)
			.all() as Array<Record<string, string | number | null>>;

		if (rows.length === 0) break;

		const statements: string[] = [];
		for (const row of rows) {
			const vals = columns.map((col) => escapeSQL(row[col]));
			statements.push(
				`INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES (${vals.join(",")});`,
			);
		}

		const fileName = `${table}-${String(chunkNum).padStart(3, "0")}.sql`;
		writeFileSync(`${outDir}/${fileName}`, `${statements.join("\n")}\n`);
		chunks.push({ file: fileName, table, rows: rows.length, strategy: "insert_or_ignore" });
		offset += CHUNK_SIZE;
	}

	return chunks;
}

// ─── Main ───────────────────────────────────────────────────────────────────

log("=== D1 Import SQL Generator ===");
log(`  Source DB: ${DB_PATH}`);
log(`  Output:    ${OUT_DIR}`);
log(`  Chunk size: ${CHUNK_SIZE} rows/file`);

mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });
const allChunks: ChunkInfo[] = [];

// 1. Forums — upsert
log("Generating forums...");
allChunks.push(
	...generateUpsertChunks(db, "forums", TABLE_COLUMNS.forums, "id", FORUMS_UPSERT_COLUMNS, OUT_DIR),
);

// 2. Users — upsert
log("Generating users...");
allChunks.push(
	...generateUpsertChunks(db, "users", TABLE_COLUMNS.users, "id", USERS_UPSERT_COLUMNS, OUT_DIR),
);

// 3. Threads — incremental
log("Generating threads...");
allChunks.push(...generateIncrementalChunks(db, "threads", TABLE_COLUMNS.threads, OUT_DIR));

// 4. Posts — incremental
log("Generating posts...");
allChunks.push(...generateIncrementalChunks(db, "posts", TABLE_COLUMNS.posts, OUT_DIR));

// 5. Attachments — incremental
log("Generating attachments...");
allChunks.push(...generateIncrementalChunks(db, "attachments", TABLE_COLUMNS.attachments, OUT_DIR));

// 6. Checkins — upsert
log("Generating user_checkins...");
allChunks.push(
	...generateUpsertChunks(
		db,
		"user_checkins",
		TABLE_COLUMNS.user_checkins,
		"user_id",
		CHECKINS_UPSERT_COLUMNS,
		OUT_DIR,
	),
);

db.close();

// Summary
const summary = {
	generated_at: new Date().toISOString(),
	source_db: DB_PATH,
	chunk_size: CHUNK_SIZE,
	total_chunks: allChunks.length,
	total_rows: allChunks.reduce((sum, c) => sum + c.rows, 0),
	tables: {} as Record<string, { strategy: string; chunks: number; rows: number; files: string[] }>,
	chunks: allChunks,
};

for (const chunk of allChunks) {
	if (!summary.tables[chunk.table]) {
		summary.tables[chunk.table] = {
			strategy: chunk.strategy,
			chunks: 0,
			rows: 0,
			files: [],
		};
	}
	summary.tables[chunk.table].chunks++;
	summary.tables[chunk.table].rows += chunk.rows;
	summary.tables[chunk.table].files.push(chunk.file);
}

writeFileSync(`${OUT_DIR}/manifest.json`, `${JSON.stringify(summary, null, 2)}\n`);

log("=== Summary ===");
for (const [table, info] of Object.entries(summary.tables)) {
	log(`  ${table}: ${info.rows.toLocaleString()} rows → ${info.chunks} chunks (${info.strategy})`);
}
log(`  Total: ${summary.total_rows.toLocaleString()} rows in ${summary.total_chunks} chunks`);
log(`  Manifest: ${OUT_DIR}/manifest.json`);
