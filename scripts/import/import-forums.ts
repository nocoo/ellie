#!/usr/bin/env bun
/**
 * Import Forums to D1
 *
 * Usage:
 *   bun run scripts/import/import-forums.ts [--clear]
 */

import { batchExecuteD1, clearTable, getRowCount, verifyTestDb } from "./d1-importer";
import { generateForumsSQL, transformForums } from "./transforms/forums";

/**
 * Import forums table (can be called from full-migration.ts)
 */
export async function importTable(): Promise<{ success: number; failed: number; total: number }> {
	// Transform
	console.log("  Transforming forums data...");
	const forums = await transformForums();
	console.log(`    Transformed ${forums.length} forums`);

	// Generate SQL
	const statements = generateForumsSQL(forums);

	// Import
	console.log("  Importing to D1...");
	const startTime = Date.now();
	const { success, failed } = await batchExecuteD1(statements, {
		tableName: "forums",
		onProgress: (done, total) => {
			process.stdout.write(
				`\r    Progress: ${done}/${total} (${Math.round((done / total) * 100)}%)`,
			);
		},
	});
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\n    ✅ Imported: ${success} success, ${failed} failed in ${elapsed}s`);

	// Verify
	const count = await getRowCount("forums");
	if (count === forums.length) {
		console.log(`    ✅ Verified: ${count} rows`);
	} else {
		console.log(`    ⚠️ Row count mismatch: got ${count}, expected ${forums.length}`);
	}

	return { success, failed, total: forums.length };
}

async function main() {
	const args = process.argv.slice(2);
	const shouldClear = args.includes("--clear");

	console.log("🏛️ Forums Import");
	console.log("=".repeat(50));

	// Safety check
	console.log("\n1. Verifying test database...");
	const isTest = await verifyTestDb();
	if (!isTest) {
		console.error("❌ SAFETY CHECK FAILED: Not connected to test database!");
		process.exit(1);
	}
	console.log("   ✅ Test database confirmed");

	// Clear if requested
	if (shouldClear) {
		console.log("\n2. Clearing existing data...");
		await clearTable("forums");
		console.log("   ✅ Forums table cleared");
	}

	// Transform
	console.log("\n3. Transforming forums data...");
	const forums = await transformForums();
	console.log(`   ✅ Transformed ${forums.length} forums`);

	// Generate SQL
	console.log("\n4. Generating SQL statements...");
	const statements = generateForumsSQL(forums);
	console.log(`   ✅ Generated ${statements.length} INSERT statements`);

	// Import
	console.log("\n5. Importing to D1...");
	const startTime = Date.now();
	const { success, failed } = await batchExecuteD1(statements, {
		tableName: "forums",
		onProgress: (done, total) => {
			process.stdout.write(
				`\r   Progress: ${done}/${total} (${Math.round((done / total) * 100)}%)`,
			);
		},
	});
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\n   ✅ Imported: ${success} success, ${failed} failed in ${elapsed}s`);

	// Verify
	console.log("\n6. Verifying import...");
	const count = await getRowCount("forums");
	const expected = forums.length;

	if (count === expected) {
		console.log(`   ✅ Verified: ${count} rows (matches expected ${expected})`);
	} else {
		console.log(`   ⚠️ Row count mismatch: got ${count}, expected ${expected}`);
	}

	console.log(`\n${"=".repeat(50)}`);
	console.log("✨ Forums import complete!");
}

// Only run main() when executed directly, not when imported
if (import.meta.main) {
	main().catch((err) => {
		console.error("❌ Error:", err);
		process.exit(1);
	});
}
