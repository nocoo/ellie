/**
 * Pure D1 SQL generation functions — no bun:sqlite dependency.
 *
 * Extracted so the generator's SQL output can be tested in vitest (Node)
 * without pulling in the bun:sqlite runtime.
 */

import { createHash } from "node:crypto";

/**
 * Escape a value for inline SQL. Strings are single-quoted with internal
 * quotes doubled; numbers pass through; null becomes NULL.
 */
export function escapeSQL(val: string | number | null): string {
	if (val === null) return "NULL";
	if (typeof val === "number") return String(val);
	return `'${String(val).replace(/'/g, "''")}'`;
}

/**
 * Build a single inline INSERT ... ON CONFLICT DO UPDATE SET statement.
 *
 * Unlike sql-builder.ts (which returns parameterized `?` SQL for bun:sqlite
 * prepared statements), this produces a fully-expanded SQL string with
 * literal values — suitable for writing to a `.sql` chunk file that
 * `wrangler d1 execute --file` will consume.
 */
export function buildUpsertStatement(
	table: string,
	columns: string[],
	conflictColumn: string,
	updateColumns: string[],
	row: Record<string, string | number | null>,
): string {
	const vals = columns.map((col) => escapeSQL(row[col]));
	const updateSet = updateColumns.map((col) => `${col} = excluded.${col}`).join(",\n    ");
	return `INSERT INTO ${table} (${columns.join(",")}) VALUES (${vals.join(",")}) ON CONFLICT(${conflictColumn}) DO UPDATE SET\n    ${updateSet};`;
}

/**
 * Build a single inline INSERT OR IGNORE statement.
 */
export function buildInsertOrIgnoreStatement(
	table: string,
	columns: string[],
	row: Record<string, string | number | null>,
): string {
	const vals = columns.map((col) => escapeSQL(row[col]));
	return `INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES (${vals.join(",")});`;
}

/** Chunk metadata for the manifest. */
export interface ChunkInfo {
	file: string;
	table: string;
	rows: number;
	bytes: number;
	strategy: "upsert" | "insert_or_ignore";
	/** Primary keys of all rows in this chunk, for post-execution verification. */
	pk_list: number[];
}

/** Production state for a single table. */
export interface TableProductionState {
	count: number;
	max_id: number;
}

/** Full production state loaded from production-state.json. */
export interface ProductionState {
	captured_at: string;
	database: { name: string; id: string };
	backup: {
		path: string;
		size_gb: number;
		tables_included: string[];
		tables_excluded: string[];
	};
	tables: Record<string, TableProductionState>;
}

/** Manifest output written to manifest.json. */
export interface Manifest {
	generated_at: string;
	source_db: string;
	chunk_size: number;
	production_state: ProductionState;
	total_chunks: number;
	total_rows: number;
	tables: Record<
		string,
		{
			strategy: string;
			prod_max_id: number | null;
			source_total_rows: number;
			source_rows_after_max: number | null;
			continuation_min_id?: number | null;
			continuation_max_id?: number | null;
			effective_chunk_size?: number;
			chunks: number;
			rows: number;
			files: string[];
		}
	>;
	chunks: ChunkInfo[];
}

/**
 * Format rows into upsert SQL chunk content.
 * Returns the full file content string, its byte size, and the primary key list.
 */
export function formatUpsertChunk(
	table: string,
	columns: string[],
	conflictColumn: string,
	updateColumns: string[],
	rows: Array<Record<string, string | number | null>>,
): { content: string; bytes: number; pk_list: number[] } {
	const statements = rows.map((row) =>
		buildUpsertStatement(table, columns, conflictColumn, updateColumns, row),
	);
	const content = `${statements.join("\n\n")}\n`;
	const pk_list = rows.map((row) => row[conflictColumn] as number);
	return { content, bytes: Buffer.byteLength(content, "utf-8"), pk_list };
}

/**
 * Format rows into INSERT OR IGNORE SQL chunk content.
 * Returns the full file content string, its byte size, and the primary key list.
 */
export function formatInsertOrIgnoreChunk(
	table: string,
	columns: string[],
	rows: Array<Record<string, string | number | null>>,
): { content: string; bytes: number; pk_list: number[] } {
	const statements = rows.map((row) => buildInsertOrIgnoreStatement(table, columns, row));
	const content = `${statements.join("\n")}\n`;
	const pk_list = rows.map((row) => row.id as number);
	return { content, bytes: Buffer.byteLength(content, "utf-8"), pk_list };
}

/** Generate a zero-padded chunk filename. */
export function chunkFileName(table: string, chunkNum: number): string {
	return `${table}-${String(chunkNum).padStart(3, "0")}.sql`;
}

/** FK relationship definition — shared between dry-run integrity and remote verification. */
export interface FkRelation {
	table: string;
	col: string;
	ref: string;
	refCol: string;
}

/**
 * Canonical FK relationships for all tables.
 * Must stay in sync with schema DDL and verify/integrity.ts.
 */
export const FK_RELATIONS: FkRelation[] = [
	{ table: "threads", col: "forum_id", ref: "forums", refCol: "id" },
	{ table: "threads", col: "author_id", ref: "users", refCol: "id" },
	{ table: "posts", col: "thread_id", ref: "threads", refCol: "id" },
	{ table: "posts", col: "forum_id", ref: "forums", refCol: "id" },
	{ table: "posts", col: "author_id", ref: "users", refCol: "id" },
	{ table: "attachments", col: "post_id", ref: "posts", refCol: "id" },
	{ table: "attachments", col: "thread_id", ref: "threads", refCol: "id" },
	{ table: "attachments", col: "author_id", ref: "users", refCol: "id" },
	{ table: "user_checkins", col: "user_id", ref: "users", refCol: "id" },
];

/** Table execution order — FK dependency order. */
export const IMPORT_TABLE_ORDER = [
	"forums",
	"users",
	"threads",
	"posts",
	"attachments",
	"user_checkins",
] as const;

/**
 * Compute a SHA-256 fingerprint for a manifest, used to bind execution logs
 * to a specific generation run. Covers all content fields that affect execution:
 * production_state, tables, chunks, chunk_size, source_db, generated_at.
 */
export function computeManifestFingerprint(manifest: Manifest): string {
	const canonical = JSON.stringify({
		generated_at: manifest.generated_at,
		source_db: manifest.source_db,
		chunk_size: manifest.chunk_size,
		production_state: manifest.production_state,
		tables: manifest.tables,
		chunks: manifest.chunks,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Validate that a chunk filename is safe — basename only, no path traversal.
 * Returns true if the filename is safe.
 */
export function isValidChunkFilename(file: string): boolean {
	if (!file) return false;
	if (file.includes("/") || file.includes("\\")) return false;
	if (file.includes("..")) return false;
	if (file.startsWith("/")) return false;
	if (!file.endsWith(".sql")) return false;
	return true;
}

/**
 * Validate manifest structural consistency:
 *   - Every file in tables[*].files has a matching entry in chunks[]
 *   - Every chunk is referenced by exactly one table's files list
 *   - All filenames pass safety validation
 * Throws on any inconsistency.
 */
export function validateManifestStructure(manifest: Manifest): void {
	const chunkMap = new Map(manifest.chunks.map((c) => [c.file, c]));
	const referencedFiles = new Set<string>();

	for (const [table, tableInfo] of Object.entries(manifest.tables)) {
		for (const file of tableInfo.files) {
			if (!isValidChunkFilename(file)) {
				throw new Error(`Unsafe filename in tables.${table}.files: "${file}"`);
			}
			if (!chunkMap.has(file)) {
				throw new Error(
					`tables.${table}.files references "${file}" which is not in manifest.chunks`,
				);
			}
			const chunk = chunkMap.get(file);
			if (chunk && chunk.table !== table) {
				throw new Error(
					`tables.${table}.files references "${file}" but chunk.table is "${chunk.table}"`,
				);
			}
			referencedFiles.add(file);
		}
	}

	for (const chunk of manifest.chunks) {
		if (!isValidChunkFilename(chunk.file)) {
			throw new Error(`Unsafe filename in manifest.chunks: "${chunk.file}"`);
		}
		if (!referencedFiles.has(chunk.file)) {
			throw new Error(`manifest.chunks contains "${chunk.file}" not referenced by any table`);
		}
	}
}

/**
 * Build an FK orphan-check SQL query from an FkRelation definition.
 * Uses generic aliases (child/parent) for consistency.
 */
export function buildFkCheckQuery(fk: FkRelation): string {
	return `SELECT COUNT(*) as cnt FROM ${fk.table} child LEFT JOIN ${fk.ref} parent ON child.${fk.col} = parent.${fk.refCol} WHERE parent.${fk.refCol} IS NULL`;
}

/**
 * Detect whether stderr is a warning-only message (no actual ERROR).
 * Returns true if stderr contains D1 unavailable warning but no error indicators.
 */
export function isWarningOnly(stderr: string): boolean {
	if (!stderr) return false;
	// Strip ANSI escape sequences for reliable pattern matching
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use \x1b
	const clean = stderr.replace(/\x1b\[[0-9;]*m/g, "");
	const hasWarning =
		clean.includes("WARNING") &&
		(clean.includes("unavailable to serve queries") || clean.includes("may take some time"));
	const hasError =
		clean.includes("ERROR") ||
		clean.includes("Error:") ||
		clean.includes("SQLITE_") ||
		clean.includes("SQL error");
	return hasWarning && !hasError;
}
