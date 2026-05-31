/**
 * Batch loader — write rows to local SQLite using bun:sqlite.
 *
 * Per docs/03-migration.md batch write section:
 * - Use bun:sqlite (zero dependency, Bun built-in)
 * - 500 rows per batch, wrapped in transactions
 * - Create tables first (DDL), indexes after all data is loaded
 * - Progress reporting every 10,000 rows
 */

import { Database } from "bun:sqlite";
import { INDEX_DDL, POST_LOAD_DDL, TABLE_COLUMNS, TABLE_DDL, type TableName } from "./schema";
import {
	type ExistsFilter,
	type UpsertConfig,
	buildFilteredUpsertSql,
	buildInsertSql,
	buildUpsertSql,
} from "./sql-builder";

// Re-export pure SQL builders and types for external consumers
export {
	buildFilteredUpsertSql,
	buildInsertSql,
	buildUpsertSql,
	createDeletedUserPlaceholder,
	type ExistsFilter,
	type UpsertConfig,
} from "./sql-builder";

/** Options for the batch loader. */
export interface LoaderOptions {
	/** Path to the SQLite database file. */
	dbPath: string;
	/** Batch size for INSERT transactions (default: 500). */
	batchSize?: number;
	/** Progress callback — invoked every N rows. */
	onProgress?: (table: string, count: number) => void;
	/** Progress reporting interval (default: 10000). */
	progressInterval?: number;
}

/** A row to insert: record of column name → value. */
export type RowRecord = Record<string, string | number | null>;

/**
 * BatchLoader manages writing data to a local SQLite database.
 */
export class BatchLoader {
	private db: Database;
	private batchSize: number;
	private onProgress?: (table: string, count: number) => void;
	private progressInterval: number;

	constructor(options: LoaderOptions) {
		this.db = new Database(options.dbPath);
		this.batchSize = options.batchSize ?? 500;
		this.onProgress = options.onProgress;
		this.progressInterval = options.progressInterval ?? 10000;

		// Enable WAL mode for better write performance
		this.db.run("PRAGMA journal_mode = WAL");
		// Defer foreign key checks until after all data is loaded
		this.db.run("PRAGMA foreign_keys = OFF");
	}

	/** Create all tables (no indexes yet). */
	createTables(): void {
		for (const ddl of TABLE_DDL) {
			this.db.run(ddl);
		}
	}

	/**
	 * Run post-load backfills. Call AFTER all rows are inserted and BEFORE
	 * indexes are built (some backfills are easier without indexes;
	 * existence-check sub-queries are tolerant of the missing indexes
	 * because data volumes here are small).
	 */
	applyPostLoadBackfills(): void {
		for (const ddl of POST_LOAD_DDL) {
			this.db.run(ddl);
		}
	}

	/** Create all indexes. Call after all data is loaded. */
	createIndexes(): void {
		for (const ddl of INDEX_DDL) {
			this.db.run(ddl);
		}
	}

	/**
	 * Insert rows into a table in batches.
	 *
	 * @param table - Target table name
	 * @param rows - Array of row records to insert
	 * @returns Number of rows inserted
	 */
	insertRows(table: TableName, rows: RowRecord[]): number {
		const columns = TABLE_COLUMNS[table];
		const sql = buildInsertSql(table, columns);
		const stmt = this.db.prepare(sql);

		let inserted = 0;

		for (let i = 0; i < rows.length; i += this.batchSize) {
			const batch = rows.slice(i, i + this.batchSize);
			const tx = this.db.transaction(() => {
				for (const row of batch) {
					const values = columns.map((col) => row[col] ?? null);
					stmt.run(...values);
					inserted++;

					if (this.onProgress && inserted % this.progressInterval === 0) {
						this.onProgress(table, inserted);
					}
				}
			});
			tx();
		}

		return inserted;
	}

	/**
	 * Create a streaming inserter for a table.
	 * Returns a function that accepts one row at a time; call flush() when done.
	 */
	createStreamInserter(table: TableName): StreamInserter {
		return new StreamInserter(
			this.db,
			table,
			this.batchSize,
			this.onProgress,
			this.progressInterval,
		);
	}

	/**
	 * Upsert rows into a table using ON CONFLICT DO UPDATE.
	 *
	 * For new rows: all TABLE_COLUMNS are inserted (app-owned columns get DEFAULTs).
	 * For existing rows: only updateColumns are overwritten; other columns are preserved.
	 *
	 * @param table - Target table name
	 * @param rows - Array of row records to upsert
	 * @param config - Upsert configuration (conflict column + update allowlist)
	 * @returns Number of rows upserted
	 */
	upsertRows(table: TableName, rows: RowRecord[], config: UpsertConfig): number {
		const columns = TABLE_COLUMNS[table];
		const sql = buildUpsertSql(table, columns, config);
		const stmt = this.db.prepare(sql);

		let upserted = 0;

		for (let i = 0; i < rows.length; i += this.batchSize) {
			const batch = rows.slice(i, i + this.batchSize);
			const tx = this.db.transaction(() => {
				for (const row of batch) {
					const values = columns.map((col) => row[col] ?? null);
					stmt.run(...values);
					upserted++;

					if (this.onProgress && upserted % this.progressInterval === 0) {
						this.onProgress(table, upserted);
					}
				}
			});
			tx();
		}

		return upserted;
	}

	/**
	 * Upsert rows with a WHERE EXISTS filter to skip orphan foreign keys.
	 *
	 * Uses INSERT INTO ... SELECT ... WHERE EXISTS to only insert/update rows
	 * whose sourceColumn value exists in the reference table. The extra bind
	 * parameter for the EXISTS check is appended automatically.
	 *
	 * @param table - Target table name
	 * @param rows - Array of row records to upsert
	 * @param config - Upsert configuration (conflict column + update allowlist)
	 * @param filter - Existence check configuration
	 * @returns Number of rows upserted (includes skipped-by-EXISTS rows in count)
	 */
	upsertRowsFiltered(
		table: TableName,
		rows: RowRecord[],
		config: UpsertConfig,
		filter: ExistsFilter,
	): number {
		const columns = TABLE_COLUMNS[table];
		const sql = buildFilteredUpsertSql(table, columns, config, filter);
		const stmt = this.db.prepare(sql);

		let processed = 0;

		for (let i = 0; i < rows.length; i += this.batchSize) {
			const batch = rows.slice(i, i + this.batchSize);
			const tx = this.db.transaction(() => {
				for (const row of batch) {
					const values = columns.map((col) => row[col] ?? null);
					// Append the EXISTS check value as extra bind parameter
					values.push(row[filter.sourceColumn] ?? null);
					stmt.run(...values);
					processed++;

					if (this.onProgress && processed % this.progressInterval === 0) {
						this.onProgress(table, processed);
					}
				}
			});
			tx();
		}

		return processed;
	}

	/** Get the underlying database instance (for queries/verification). */
	getDb(): Database {
		return this.db;
	}

	/** Close the database connection. */
	close(): void {
		this.db.close();
	}
}

/**
 * StreamInserter — buffers rows and flushes in batches within transactions.
 * Suitable for large tables (posts: 9.4M rows) where loading all rows into
 * memory is not feasible.
 */
export class StreamInserter {
	private db: Database;
	private table: TableName;
	private columns: string[];
	private stmt: ReturnType<Database["prepare"]>;
	private buffer: RowRecord[] = [];
	private batchSize: number;
	private totalInserted = 0;
	private onProgress?: (table: string, count: number) => void;
	private progressInterval: number;

	constructor(
		db: Database,
		table: TableName,
		batchSize: number,
		onProgress?: (table: string, count: number) => void,
		progressInterval = 10000,
	) {
		this.db = db;
		this.table = table;
		this.batchSize = batchSize;
		this.onProgress = onProgress;
		this.progressInterval = progressInterval;
		this.columns = TABLE_COLUMNS[table];
		this.stmt = db.prepare(buildInsertSql(table, this.columns));
	}

	/** Add a row to the buffer. Automatically flushes when batch size is reached. */
	add(row: RowRecord): void {
		this.buffer.push(row);
		if (this.buffer.length >= this.batchSize) {
			this.flushBuffer();
		}
	}

	/** Flush any remaining buffered rows. Must be called when done adding rows. */
	flush(): number {
		if (this.buffer.length > 0) {
			this.flushBuffer();
		}
		return this.totalInserted;
	}

	/** Get total number of rows inserted so far. */
	get count(): number {
		return this.totalInserted;
	}

	private flushBuffer(): void {
		const rows = this.buffer;
		this.buffer = [];

		const tx = this.db.transaction(() => {
			for (const row of rows) {
				const values = this.columns.map((col) => row[col] ?? null);
				this.stmt.run(...values);
				this.totalInserted++;

				if (this.onProgress && this.totalInserted % this.progressInterval === 0) {
					this.onProgress(this.table, this.totalInserted);
				}
			}
		});
		tx();
	}
}
