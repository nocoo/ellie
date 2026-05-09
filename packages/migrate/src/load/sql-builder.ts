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

/** Configuration for a WHERE EXISTS pre-filter on INSERT. */
export interface ExistsFilter {
	/** Table to check existence in (e.g., "users"). */
	referenceTable: string;
	/** Column in the reference table to match (e.g., "id"). */
	referenceColumn: string;
	/** Column in the source row whose value is checked (e.g., "user_id"). */
	sourceColumn: string;
}

/**
 * Build an INSERT ... SELECT ... WHERE EXISTS ... ON CONFLICT DO UPDATE SQL statement.
 *
 * Uses INSERT INTO ... SELECT ?,?... WHERE EXISTS (SELECT 1 FROM refTable WHERE refCol = ?)
 * to skip rows that reference non-existent parent rows (e.g., checkins for deleted users).
 * The caller must append the sourceColumn value as an extra bind parameter after the
 * normal column values.
 *
 * @param table - Target table name
 * @param columns - All column names in INSERT order
 * @param config - Upsert configuration (conflict column + update allowlist)
 * @param filter - Existence check configuration
 * @returns Parameterized SQL string (column count + 1 parameters)
 * @throws Error if updateColumns is empty or contains the conflict column
 */
export function buildFilteredUpsertSql(
	table: string,
	columns: string[],
	config: UpsertConfig,
	filter: ExistsFilter,
): string {
	if (config.updateColumns.length === 0) {
		throw new Error(`buildFilteredUpsertSql: updateColumns must not be empty for table "${table}"`);
	}
	if (config.updateColumns.includes(config.conflictColumn)) {
		throw new Error(
			`buildFilteredUpsertSql: updateColumns must not contain the conflict column "${config.conflictColumn}"`,
		);
	}
	const placeholders = columns.map(() => "?").join(",");
	const updateSet = config.updateColumns.map((col) => `${col} = excluded.${col}`).join(", ");
	return `INSERT INTO ${table} (${columns.join(",")}) SELECT ${placeholders} WHERE EXISTS (SELECT 1 FROM ${filter.referenceTable} WHERE ${filter.referenceColumn} = ?) ON CONFLICT(${config.conflictColumn}) DO UPDATE SET ${updateSet}`;
}

/**
 * Create a placeholder user record for a deleted/missing author.
 *
 * Covers every column in TABLE_COLUMNS.users so BatchLoader won't bind NULL
 * on NOT NULL columns. The placeholder uses status=-3 to distinguish from
 * real users.
 */
export function createDeletedUserPlaceholder(uid: number): Record<string, string | number | null> {
	return {
		id: uid,
		username: `[已删除用户${uid}]`,
		email: "",
		password_hash: "",
		password_salt: "",
		avatar: "",
		status: -3, // Placeholder status
		role: 0,
		reg_date: 0,
		last_login: 0,
		threads: 0,
		posts: 0,
		credits: 0,
		coins: 0,
		signature: "",
		group_title: "",
		group_stars: 0,
		group_color: "",
		custom_title: "",
		digest_posts: 0,
		ol_time: 0,
		gender: 0,
		birth_year: 0,
		birth_month: 0,
		birth_day: 0,
		reside_province: "",
		reside_city: "",
		graduate_school: "",
		bio: "",
		interest: "",
		qq: "",
		site: "",
		last_activity: 0,
		reg_ip: "",
		last_ip: "",
		campus: "",
		has_avatar: 0,
	};
}
