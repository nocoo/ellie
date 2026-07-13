#!/usr/bin/env bun
/**
 * Import Users to D1
 *
 * Usage:
 *   bun run scripts/import/import-users.ts [--clear] [--limit N]
 */

import { batchExecuteD1, getRowCount, verifyTestDb } from "./d1-importer";
import { generateUsersSQL, transformUsers } from "./transforms/users";

/**
 * Import users table (can be called from full-migration.ts)
 */
export async function importTable(
	options: { limit?: number } = {},
): Promise<{ success: number; failed: number; total: number }> {
	const { limit } = options;

	// Transform
	console.log("  Transforming users data...");
	const users = await transformUsers({ limit });
	console.log(`    Transformed ${users.length} users`);

	// Generate SQL
	const statements = generateUsersSQL(users);

	// Import
	console.log("  Importing to D1...");
	const startTime = Date.now();
	const { success, failed } = await batchExecuteD1(statements, {
		tableName: "users",
		onProgress: (done, total) => {
			process.stdout.write(
				`\r    Progress: ${done}/${total} (${Math.round((done / total) * 100)}%)`,
			);
		},
	});
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\n    ✅ Imported: ${success} success, ${failed} failed in ${elapsed}s`);

	// Verify
	const count = await getRowCount("users");
	if (count >= users.length) {
		console.log(`    ✅ Verified: ${count} rows`);
	} else {
		console.log(`    ⚠️ Row count: got ${count}, expected ${users.length}`);
	}

	return { success, failed, total: users.length };
}

async function main() {
	const args = process.argv.slice(2);
	const limitIdx = args.indexOf("--limit");
	const limit = limitIdx >= 0 ? Number.parseInt(args[limitIdx + 1], 10) : undefined;

	console.log("👥 Users Import");
	console.log("=".repeat(50));

	// Safety check
	console.log("\n1. Verifying test database...");
	const isTest = await verifyTestDb();
	if (!isTest) {
		console.error("❌ SAFETY CHECK FAILED: Not connected to test database!");
		process.exit(1);
	}
	console.log("   ✅ Test database confirmed");

	// Import
	console.log("\n2. Importing users...");
	const result = await importTable({ limit });

	console.log(`\n${"=".repeat(50)}`);
	console.log(`✨ Users import complete! (${result.success}/${result.total})`);
}

// Only run main() when executed directly
if (import.meta.main) {
	main().catch((err) => {
		console.error("❌ Error:", err);
		process.exit(1);
	});
}
