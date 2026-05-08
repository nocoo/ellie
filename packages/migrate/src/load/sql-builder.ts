/**
 * Pure SQL builder functions — no bun:sqlite dependency.
 *
 * Extracted so upsert SQL generation can be tested in vitest (Node) without
 * pulling in the bun:sqlite runtime. BatchLoader delegates to these.
 */

/** Configuration for upsert (ON CONFLICT DO UPDATE). */
export interface UpsertConfig {
	/** Column used for ON CONFLICT (e.g., "id" or "user_id"). */
	conflictColumn: string;
	/** Columns to update on conflict. Only these are overwritten for existing rows. */
	updateColumns: string[];
}

/**
 * Build an INSERT SQL statement.
 *
 * @param table - Target table name
 * @param columns - Column names in INSERT order
 * @returns Parameterized INSERT SQL string
 */
export function buildInsertSql(table: string, columns: string[]): string {
	const placeholders = columns.map(() => "?").join(",");
	return `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`;
}

/**
 * Build an INSERT ... ON CONFLICT DO UPDATE SQL statement.
 *
 * Validates that updateColumns is non-empty and that conflictColumn is not in
 * the update set — these would produce invalid or semantically wrong SQL.
 *
 * @param table - Target table name
 * @param columns - All column names in INSERT order
 * @param config - Upsert configuration (conflict column + update allowlist)
 * @returns Parameterized upsert SQL string
 * @throws Error if updateColumns is empty or contains the conflict column
 */
export function buildUpsertSql(table: string, columns: string[], config: UpsertConfig): string {
	if (config.updateColumns.length === 0) {
		throw new Error(`buildUpsertSql: updateColumns must not be empty for table "${table}"`);
	}
	if (config.updateColumns.includes(config.conflictColumn)) {
		throw new Error(
			`buildUpsertSql: updateColumns must not contain the conflict column "${config.conflictColumn}"`,
		);
	}
	const placeholders = columns.map(() => "?").join(",");
	const updateSet = config.updateColumns.map((col) => `${col} = excluded.${col}`).join(", ");
	return `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders}) ON CONFLICT(${config.conflictColumn}) DO UPDATE SET ${updateSet}`;
}
