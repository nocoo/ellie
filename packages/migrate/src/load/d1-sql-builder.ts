/**
 * Pure D1 SQL generation functions — no bun:sqlite dependency.
 *
 * Extracted so the generator's SQL output can be tested in vitest (Node)
 * without pulling in the bun:sqlite runtime.
 */

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
			chunks: number;
			rows: number;
			files: string[];
		}
	>;
	chunks: ChunkInfo[];
}

/**
 * Format rows into upsert SQL chunk content.
 * Returns the full file content string and its byte size.
 */
export function formatUpsertChunk(
	table: string,
	columns: string[],
	conflictColumn: string,
	updateColumns: string[],
	rows: Array<Record<string, string | number | null>>,
): { content: string; bytes: number } {
	const statements = rows.map((row) =>
		buildUpsertStatement(table, columns, conflictColumn, updateColumns, row),
	);
	const content = `${statements.join("\n\n")}\n`;
	return { content, bytes: Buffer.byteLength(content, "utf-8") };
}

/**
 * Format rows into INSERT OR IGNORE SQL chunk content.
 * Returns the full file content string and its byte size.
 */
export function formatInsertOrIgnoreChunk(
	table: string,
	columns: string[],
	rows: Array<Record<string, string | number | null>>,
): { content: string; bytes: number } {
	const statements = rows.map((row) => buildInsertOrIgnoreStatement(table, columns, row));
	const content = `${statements.join("\n")}\n`;
	return { content, bytes: Buffer.byteLength(content, "utf-8") };
}

/** Generate a zero-padded chunk filename. */
export function chunkFileName(table: string, chunkNum: number): string {
	return `${table}-${String(chunkNum).padStart(3, "0")}.sql`;
}
