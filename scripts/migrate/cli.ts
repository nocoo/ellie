/**
 * CLI argument parsing for the migration script.
 *
 * Separated from index.ts so unit tests can import just this module
 * without pulling in the full orchestration code (which needs real dump files).
 */

import { parseArgs } from "node:util";

/** Configuration for the migration pipeline. */
export interface MigrateConfig {
	/** Path to dump files directory. */
	sourceDir: string;
	/** Path to output SQLite database file. */
	dbPath: string;
	/** Batch size for INSERT transactions. */
	batchSize: number;
	/** Progress reporting interval (rows). */
	progressInterval: number;
}

export const DEFAULT_CONFIG: MigrateConfig = {
	sourceDir: "reference/db",
	dbPath: "output/ellie.db",
	batchSize: 500,
	progressInterval: 10000,
};

/**
 * Parse CLI arguments into a partial config object.
 */
export function parseCliArgs(args: string[]): Partial<MigrateConfig> {
	const { values } = parseArgs({
		args,
		options: {
			db: { type: "string" },
			source: { type: "string" },
			batch: { type: "string" },
		},
		strict: false,
	});

	const config: Partial<MigrateConfig> = {};
	if (values.db) config.dbPath = values.db;
	if (values.source) config.sourceDir = values.source;
	if (values.batch) config.batchSize = Number(values.batch);
	return config;
}
