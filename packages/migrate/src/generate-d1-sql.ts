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
		"users-chunk-size": { type: "string" },
		"users-min-id": { type: "string" },
		"users-max-id": { type: "string" },
		tables: { type: "string" },
		"missing-ids": { type: "string" },
	},
});

const DB_PATH = values.db ?? "output/dry-run-2026-05-09/ellie.db";
const OUT_DIR = values.out ?? "output/d1-import-2026-05-09";
const PROD_STATE_PATH = values["production-state"] ?? "packages/migrate/production-state.json";
const FORCE = values.force ?? false;
const CHUNK_SIZE = 5000; // rows per SQL file (D1 has statement limits)

// Strict integer validation — reject trailing chars, decimals, negatives
const STRICT_UINT_RE = /^[0-9]+$/;

function parseStrictUint(raw: string, flag: string, allowZero: boolean): number {
	if (!STRICT_UINT_RE.test(raw)) {
		console.error(
			`Error: --${flag} must be a ${allowZero ? "non-negative" : "positive"} integer, got "${raw}"`,
		);
		process.exit(1);
	}
	const n = Number(raw);
	if (!allowZero && n === 0) {
		console.error(`Error: --${flag} must be a positive integer, got "${raw}"`);
		process.exit(1);
	}
	return n;
}

const USERS_CHUNK_SIZE = values["users-chunk-size"]
	? parseStrictUint(values["users-chunk-size"], "users-chunk-size", false)
	: CHUNK_SIZE;
const USERS_MIN_ID = values["users-min-id"]
	? parseStrictUint(values["users-min-id"], "users-min-id", true)
	: null;
const USERS_MAX_ID = values["users-max-id"]
	? parseStrictUint(values["users-max-id"], "users-max-id", false)
	: null;
const TABLES_FILTER = values.tables ? new Set(values.tables.split(",").map((t) => t.trim())) : null;

// ─── --missing-ids parsing & validation ────────────────────────────────────
//
// Whitelist of tables eligible for exact-id filtering. INSERT-OR-IGNORE only;
// upsert tables (users/forums/checkins) are intentionally excluded so the
// missing-ids mode cannot regress full-row reconciliation semantics.
const MISSING_IDS_ALLOWED_TABLES = new Set(["threads", "posts", "post_comments", "attachments"]);

interface MissingIdsSpec {
	file: string;
	ids: number[];
}

/**
 * Parse `--missing-ids table=file,table=file,...`.
 * Returns null when the flag is not provided.
 *
 * Strict validation (any failure → process.exit(1)):
 *   - At least one entry, no duplicate table keys
 *   - Table name must be in MISSING_IDS_ALLOWED_TABLES
 *   - File must exist and be readable
 *   - File must be non-empty
 *   - Each non-blank line must match /^[0-9]+$/ and parse as a positive integer
 *   - No duplicate IDs within a single file
 */
function parseMissingIdsFlag(raw: string | undefined): Map<string, MissingIdsSpec> | null {
	if (raw == null) return null;
	const map = new Map<string, MissingIdsSpec>();
	const entries = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (entries.length === 0) {
		console.error("Error: --missing-ids must contain at least one table=file pair");
		process.exit(1);
	}
	for (const entry of entries) {
		const eq = entry.indexOf("=");
		if (eq <= 0 || eq === entry.length - 1) {
			console.error(`Error: --missing-ids entry must be "table=file", got "${entry}"`);
			process.exit(1);
		}
		const table = entry.slice(0, eq).trim();
		const file = entry.slice(eq + 1).trim();
		if (!MISSING_IDS_ALLOWED_TABLES.has(table)) {
			console.error(
				`Error: --missing-ids table "${table}" is not allowed; allowed: ${[...MISSING_IDS_ALLOWED_TABLES].join(", ")}`,
			);
			process.exit(1);
		}
		if (map.has(table)) {
			console.error(`Error: --missing-ids has duplicate entry for table "${table}"`);
			process.exit(1);
		}
		if (!existsSync(file)) {
			console.error(`Error: --missing-ids file not found: ${file}`);
			process.exit(1);
		}
		const text = readFileSync(file, "utf-8");
		const lines = text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length === 0) {
			console.error(`Error: --missing-ids file is empty: ${file}`);
			process.exit(1);
		}
		const ids: number[] = [];
		const seen = new Set<number>();
		for (const line of lines) {
			if (!STRICT_UINT_RE.test(line)) {
				console.error(
					`Error: --missing-ids file ${file} contains non-positive-integer line: "${line}"`,
				);
				process.exit(1);
			}
			const n = Number(line);
			if (n === 0) {
				console.error(`Error: --missing-ids file ${file} contains 0 (id must be > 0)`);
				process.exit(1);
			}
			if (seen.has(n)) {
				console.error(`Error: --missing-ids file ${file} contains duplicate id: ${n}`);
				process.exit(1);
			}
			seen.add(n);
			ids.push(n);
		}
		map.set(table, { file, ids });
	}
	return map;
}

const MISSING_IDS = parseMissingIdsFlag(values["missing-ids"]);

if (USERS_MIN_ID != null && USERS_MAX_ID != null && USERS_MAX_ID <= USERS_MIN_ID) {
	console.error(
		`Error: --users-max-id (${USERS_MAX_ID}) must be greater than --users-min-id (${USERS_MIN_ID})`,
	);
	process.exit(1);
}

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
	opts?: { chunkSize?: number; minId?: number; maxId?: number },
): { chunks: ChunkInfo[]; totalRows: number; generatedRows: number } {
	const chunkSize = opts?.chunkSize ?? CHUNK_SIZE;
	const chunks: ChunkInfo[] = [];
	const totalRows = (db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt;

	const conditions: string[] = [];
	if (opts?.minId != null) conditions.push(`id > ${opts.minId}`);
	if (opts?.maxId != null) conditions.push(`id <= ${opts.maxId}`);
	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const generatedRows =
		conditions.length > 0
			? (
					db.query(`SELECT COUNT(*) as cnt FROM ${table} ${whereClause}`).get() as {
						cnt: number;
					}
				).cnt
			: totalRows;

	if (conditions.length > 0) {
		const rangeDesc =
			opts?.minId != null && opts?.maxId != null
				? `${opts.minId} < id <= ${opts.maxId}`
				: opts?.minId != null
					? `id > ${opts.minId}`
					: `id <= ${opts?.maxId}`;
		log(
			`  ${table}: ${totalRows.toLocaleString()} total, ${generatedRows.toLocaleString()} to generate (${rangeDesc}) → upsert (chunk size ${chunkSize})`,
		);
	} else {
		log(`  ${table}: ${totalRows.toLocaleString()} rows → upsert (all rows)`);
	}

	let chunkNum = 0;
	let offset = 0;

	while (offset < generatedRows) {
		chunkNum++;
		const orderClause = conditions.length > 0 ? "ORDER BY id" : "";
		const rows = db
			.query(
				`SELECT ${columns.join(",")} FROM ${table} ${whereClause} ${orderClause} LIMIT ${chunkSize} OFFSET ${offset}`,
			)
			.all() as Array<Record<string, string | number | null>>;

		if (rows.length === 0) break;

		const { content, bytes, pk_list } = formatUpsertChunk(
			table,
			columns,
			conflictColumn,
			updateColumns,
			rows,
		);
		const fileName = chunkFileName(table, chunkNum);
		writeFileSync(`${outDir}/${fileName}`, content);
		chunks.push({ file: fileName, table, rows: rows.length, bytes, strategy: "upsert", pk_list });
		offset += chunkSize;
	}

	return { chunks, totalRows, generatedRows };
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

		const { content, bytes, pk_list } = formatInsertOrIgnoreChunk(table, columns, rows);
		const fileName = chunkFileName(table, chunkNum);
		writeFileSync(`${outDir}/${fileName}`, content);
		chunks.push({
			file: fileName,
			table,
			rows: rows.length,
			bytes,
			strategy: "insert_or_ignore",
			pk_list,
		});
		offset += CHUNK_SIZE;
	}

	return { chunks, totalRows, filteredRows };
}

// ─── Exact missing-id INSERT OR IGNORE generator ───────────────────────────
//
// Uses a temporary in-memory table loaded with the missing IDs so the chunk
// query stays parameter-free and chunk-friendly (LIMIT/OFFSET against an
// indexed temp table). Asserts that the source DB returns exactly one row per
// requested ID — any drift between the missing-ID file and the source DB
// fails the run instead of silently dropping rows.
function generateExactMissingIdChunks(
	db: Database,
	table: string,
	columns: string[],
	missingIds: number[],
	missingIdsFile: string,
	outDir: string,
): { chunks: ChunkInfo[]; totalRows: number; matchedRows: number } {
	const chunks: ChunkInfo[] = [];
	const totalRows = (db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt;
	const expectedCount = missingIds.length;

	// Stage IDs in a temp table for indexed lookup. Use a unique name per call
	// so concurrent runs do not collide (defensive).
	const tempName = `__exact_ids_${table}`;
	db.exec(`DROP TABLE IF EXISTS ${tempName}`);
	db.exec(`CREATE TEMP TABLE ${tempName} (id INTEGER PRIMARY KEY)`);
	const insertStmt = db.prepare(`INSERT INTO ${tempName}(id) VALUES (?)`);
	db.exec("BEGIN");
	try {
		for (const id of missingIds) insertStmt.run(id);
		db.exec("COMMIT");
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}

	const matchedRows = (
		db
			.query(`SELECT COUNT(*) as cnt FROM ${table} t WHERE t.id IN (SELECT id FROM ${tempName})`)
			.get() as { cnt: number }
	).cnt;
	if (matchedRows !== expectedCount) {
		console.error(
			`Error: --missing-ids drift for ${table}: file ${missingIdsFile} lists ${expectedCount} ids but source DB has ${matchedRows} matching rows. Refresh the missing-ids file from a fresh exact-diff before regenerating.`,
		);
		db.exec(`DROP TABLE IF EXISTS ${tempName}`);
		process.exit(1);
	}
	log(
		`  ${table}: ${totalRows.toLocaleString()} total, ${matchedRows.toLocaleString()} exact-id (missing-ids file: ${missingIdsFile}) → INSERT OR IGNORE`,
	);

	let chunkNum = 0;
	let offset = 0;
	while (offset < matchedRows) {
		chunkNum++;
		const rows = db
			.query(
				`SELECT ${columns.join(",")} FROM ${table} WHERE id IN (SELECT id FROM ${tempName}) ORDER BY id LIMIT ${CHUNK_SIZE} OFFSET ${offset}`,
			)
			.all() as Array<Record<string, string | number | null>>;
		if (rows.length === 0) break;
		const { content, bytes, pk_list } = formatInsertOrIgnoreChunk(table, columns, rows);
		const fileName = chunkFileName(table, chunkNum);
		writeFileSync(`${outDir}/${fileName}`, content);
		chunks.push({
			file: fileName,
			table,
			rows: rows.length,
			bytes,
			strategy: "insert_or_ignore",
			pk_list,
		});
		offset += CHUNK_SIZE;
	}

	db.exec(`DROP TABLE IF EXISTS ${tempName}`);
	return { chunks, totalRows, matchedRows };
}

// ─── Main ───────────────────────────────────────────────────────────────────

log("=== D1 Import SQL Generator ===");
log(`  Source DB:         ${DB_PATH}`);
log(`  Production state:  ${PROD_STATE_PATH}`);
log(`  Output:            ${OUT_DIR}`);
log(`  Chunk size:        ${CHUNK_SIZE} rows/file`);
if (USERS_CHUNK_SIZE !== CHUNK_SIZE) {
	log(`  Users chunk size:  ${USERS_CHUNK_SIZE} rows/file (override)`);
}
if (USERS_MIN_ID != null) {
	log(`  Users min ID:      ${USERS_MIN_ID} (continuation)`);
}
if (USERS_MAX_ID != null) {
	log(`  Users max ID:      ${USERS_MAX_ID} (upper bound)`);
}
if (TABLES_FILTER != null) {
	log(`  Tables filter:     ${[...TABLES_FILTER].join(", ")}`);
}
if (MISSING_IDS != null) {
	for (const [table, spec] of MISSING_IDS) {
		log(`  Missing IDs:       ${table} ← ${spec.file} (${spec.ids.length} ids)`);
	}
}

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
		continuation_min_id?: number | null;
		continuation_max_id?: number | null;
		effective_chunk_size?: number;
		exact_missing_ids_file?: string;
		exact_missing_ids_count?: number;
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
	continuationMinId?: number | null,
	effectiveChunkSize?: number,
	continuationMaxId?: number | null,
	exactMissingIdsFile?: string,
	exactMissingIdsCount?: number,
): void {
	allChunks.push(...chunks);
	tableStats[table] = {
		strategy,
		prod_max_id: prodMaxId,
		source_total_rows: totalRows,
		source_rows_after_max: filteredRows,
		...(continuationMinId != null ? { continuation_min_id: continuationMinId } : {}),
		...(continuationMaxId != null ? { continuation_max_id: continuationMaxId } : {}),
		...(effectiveChunkSize != null && effectiveChunkSize !== CHUNK_SIZE
			? { effective_chunk_size: effectiveChunkSize }
			: {}),
		...(exactMissingIdsFile != null ? { exact_missing_ids_file: exactMissingIdsFile } : {}),
		...(exactMissingIdsCount != null ? { exact_missing_ids_count: exactMissingIdsCount } : {}),
		chunks: chunks.length,
		rows: chunks.reduce((sum, c) => sum + c.rows, 0),
		files: chunks.map((c) => c.file),
	};
}

/** Check if a table should be generated based on --tables filter. */
function shouldGenerate(table: string): boolean {
	if (TABLES_FILTER == null) return true;
	return TABLES_FILTER.has(table);
}

/**
 * Dispatch an insert_or_ignore table to either:
 *   - exact missing-id mode (when --missing-ids has an entry for it), or
 *   - max-id incremental mode (the default)
 *
 * Records the right manifest fields in either case.
 */
function generateInsertOrIgnoreTable(table: string, columns: string[]): void {
	const prodMaxId = prodState.tables[table]?.max_id ?? 0;
	const spec = MISSING_IDS?.get(table);
	if (spec != null) {
		log(`Generating ${table} (exact missing-ids mode)...`);
		const result = generateExactMissingIdChunks(db, table, columns, spec.ids, spec.file, OUT_DIR);
		// source_rows_after_max kept for reference even in exact mode
		const filteredRows = (
			db.query(`SELECT COUNT(*) as cnt FROM ${table} WHERE id > ${prodMaxId}`).get() as {
				cnt: number;
			}
		).cnt;
		recordTableStats(
			table,
			"insert_or_ignore",
			result.chunks,
			result.totalRows,
			prodMaxId,
			filteredRows,
			null,
			undefined,
			null,
			spec.file,
			result.matchedRows,
		);
	} else {
		log(`Generating ${table}...`);
		const result = generateIncrementalChunks(db, table, columns, prodMaxId, OUT_DIR);
		recordTableStats(
			table,
			"insert_or_ignore",
			result.chunks,
			result.totalRows,
			prodMaxId,
			result.filteredRows,
		);
	}
}

// 1. Forums — upsert (all rows)
if (shouldGenerate("forums")) {
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
} else {
	log("Skipping forums (--tables filter)");
}

// 2. Users — upsert (with optional continuation, chunk size override, and max ID)
if (shouldGenerate("users")) {
	log("Generating users...");
	const usersOpts: { chunkSize?: number; minId?: number; maxId?: number } = {};
	if (USERS_CHUNK_SIZE !== CHUNK_SIZE) usersOpts.chunkSize = USERS_CHUNK_SIZE;
	if (USERS_MIN_ID != null) usersOpts.minId = USERS_MIN_ID;
	if (USERS_MAX_ID != null) usersOpts.maxId = USERS_MAX_ID;
	const usersResult = generateUpsertChunks(
		db,
		"users",
		TABLE_COLUMNS.users,
		"id",
		USERS_UPSERT_COLUMNS,
		OUT_DIR,
		Object.keys(usersOpts).length > 0 ? usersOpts : undefined,
	);
	recordTableStats(
		"users",
		"upsert",
		usersResult.chunks,
		usersResult.totalRows,
		null,
		USERS_MIN_ID != null || USERS_MAX_ID != null ? usersResult.generatedRows : null,
		USERS_MIN_ID,
		USERS_CHUNK_SIZE,
		USERS_MAX_ID,
	);
} else {
	log("Skipping users (--tables filter)");
}

// 3. Threads — incremental (id > prod max_id) or exact missing-ids
if (shouldGenerate("threads")) {
	generateInsertOrIgnoreTable("threads", TABLE_COLUMNS.threads);
} else {
	log("Skipping threads (--tables filter)");
}

// 4. Posts — incremental (id > prod max_id) or exact missing-ids
if (shouldGenerate("posts")) {
	generateInsertOrIgnoreTable("posts", TABLE_COLUMNS.posts);
} else {
	log("Skipping posts (--tables filter)");
}

// 5. Attachments — incremental (id > prod max_id) or exact missing-ids
if (shouldGenerate("attachments")) {
	generateInsertOrIgnoreTable("attachments", TABLE_COLUMNS.attachments);
} else {
	log("Skipping attachments (--tables filter)");
}

// 6. Post Comments — incremental (id > prod max_id) or exact missing-ids
if (shouldGenerate("post_comments")) {
	generateInsertOrIgnoreTable("post_comments", TABLE_COLUMNS.post_comments);
} else {
	log("Skipping post_comments (--tables filter)");
}

// 7. Checkins — upsert (all rows)
if (shouldGenerate("user_checkins")) {
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
} else {
	log("Skipping user_checkins (--tables filter)");
}

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
	const contNote =
		info.continuation_min_id != null || info.continuation_max_id != null
			? ` (continuation: ${info.continuation_min_id != null ? `id > ${info.continuation_min_id}` : ""}${info.continuation_min_id != null && info.continuation_max_id != null ? " AND " : ""}${info.continuation_max_id != null ? `id <= ${info.continuation_max_id}` : ""})`
			: "";
	log(
		`  ${table}: ${info.rows.toLocaleString()} rows → ${info.chunks} chunks (${info.strategy})${maxIdNote}${contNote}`,
	);
}
const totalBytes = allChunks.reduce((sum, c) => sum + c.bytes, 0);
log(
	`  Total: ${manifest.total_rows.toLocaleString()} rows in ${manifest.total_chunks} chunks (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
);
log(`  Manifest: ${OUT_DIR}/manifest.json`);
