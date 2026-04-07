/**
 * D1 Batch Importer
 *
 * Imports data into D1 using batched INSERT statements.
 * Handles rate limiting and provides progress feedback.
 */

import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const CONFIG = {
	testDb: "tongjinet-db-test",
	wranglerConfig: "apps/worker/wrangler.toml",
	batchSize: 50, // Rows per batch
	maxSqlLength: 90000, // D1 limit is 100KB, leave margin
};

/**
 * Execute a single SQL command on D1 (via command line)
 */
export async function executeD1(command: string): Promise<unknown> {
	const result =
		await $`npx wrangler d1 execute ${CONFIG.testDb} -c ${CONFIG.wranglerConfig} --remote --json --command ${command}`
			.text()
			.catch((e) => {
				console.error("D1 error:", e.message);
				throw e;
			});
	return JSON.parse(result);
}

/**
 * Execute SQL via file (handles special characters better)
 */
export async function executeD1File(sql: string): Promise<unknown> {
	const tmpFile = join(tmpdir(), `d1-import-${Date.now()}.sql`);
	try {
		writeFileSync(tmpFile, sql, "utf-8");
		const result =
			await $`npx wrangler d1 execute ${CONFIG.testDb} -c ${CONFIG.wranglerConfig} --remote --json --file ${tmpFile}`
				.text()
				.catch((e) => {
					console.error("D1 error:", e.message);
					throw e;
				});
		// Extract JSON from output (wrangler adds progress indicators before JSON)
		const jsonStart = result.indexOf("[");
		if (jsonStart === -1) {
			throw new Error(`No JSON found in D1 response: ${result.slice(0, 200)}`);
		}
		return JSON.parse(result.slice(jsonStart));
	} finally {
		try {
			unlinkSync(tmpFile);
		} catch {
			// ignore cleanup errors
		}
	}
}

/**
 * Execute multiple SQL statements in batches
 * Uses file-based execution to handle special characters properly
 */
export async function batchExecuteD1(
	statements: string[],
	options: {
		tableName: string;
		onProgress?: (done: number, total: number) => void;
		disableForeignKeys?: boolean;
	} = {
		tableName: "unknown",
	},
): Promise<{ success: number; failed: number }> {
	const { tableName: _tableName, onProgress, disableForeignKeys = false } = options;
	let success = 0;
	let failed = 0;
	let batch: string[] = [];
	let batchLength = 0;

	const flush = async () => {
		if (batch.length === 0) return;

		// Build SQL with optional FK disable
		const sqlParts: string[] = [];
		if (disableForeignKeys) {
			sqlParts.push("PRAGMA foreign_keys = OFF");
		}
		sqlParts.push(...batch);
		if (disableForeignKeys) {
			sqlParts.push("PRAGMA foreign_keys = ON");
		}
		const sql = sqlParts.join("; ");

		try {
			await executeD1File(sql);
			success += batch.length;
		} catch (_e) {
			// Try individual statements on batch failure
			for (const stmt of batch) {
				try {
					const singleSql = disableForeignKeys
						? `PRAGMA foreign_keys = OFF; ${stmt}; PRAGMA foreign_keys = ON`
						: stmt;
					await executeD1File(singleSql);
					success++;
				} catch {
					failed++;
					console.error(`  Failed: ${stmt.slice(0, 100)}...`);
				}
			}
		}

		batch = [];
		batchLength = 0;
		onProgress?.(success + failed, statements.length);
	};

	for (const stmt of statements) {
		// Check if adding this statement would exceed limits
		if (batch.length >= CONFIG.batchSize || batchLength + stmt.length > CONFIG.maxSqlLength) {
			await flush();
		}

		batch.push(stmt);
		batchLength += stmt.length + 2; // +2 for "; "
	}

	await flush();

	return { success, failed };
}

/**
 * Clear a table in D1 (disables FK checks temporarily)
 */
export async function clearTable(tableName: string): Promise<void> {
	console.log(`  Clearing ${tableName}...`);
	// SQLite doesn't support disabling FK checks in a single statement with DELETE
	// So we use PRAGMA foreign_keys = OFF but that doesn't work in D1
	// Instead, clear dependent tables first or use proper order
	await executeD1(`DELETE FROM "${tableName}"`);
}

/**
 * Get row count for a table
 */
export async function getRowCount(tableName: string): Promise<number> {
	const result = (await executeD1(`SELECT COUNT(*) as cnt FROM "${tableName}"`)) as Array<{
		results: Array<{ cnt: number }>;
	}>;
	return result[0]?.results?.[0]?.cnt ?? 0;
}

/**
 * Verify test database isolation
 */
export async function verifyTestDb(): Promise<boolean> {
	try {
		const result = (await executeD1("SELECT value FROM _test_marker WHERE key = 'env'")) as Array<{
			results: Array<{ value: string }>;
		}>;
		return result[0]?.results?.[0]?.value === "test";
	} catch {
		return false;
	}
}

// CLI for testing
if (import.meta.main) {
	console.log("Testing D1 connection...");

	const isTest = await verifyTestDb();
	console.log(`Test DB verified: ${isTest}`);

	if (!isTest) {
		console.error("ERROR: Not connected to test database!");
		process.exit(1);
	}

	const count = await getRowCount("forums");
	console.log(`Current forums count: ${count}`);
}
