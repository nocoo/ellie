#!/usr/bin/env bun
/**
 * Import Threads to D1
 */

import { batchExecuteD1, getRowCount, verifyTestDb } from "./d1-importer";
import { generateThreadsSQL, transformThreads } from "./transforms/threads";

export async function importTable(
	options: { limit?: number } = {},
): Promise<{ success: number; failed: number; total: number }> {
	const { limit } = options;

	console.log("  Transforming threads data...");
	const threads = await transformThreads({ limit });
	console.log(`    Transformed ${threads.length} threads`);

	const statements = generateThreadsSQL(threads);

	console.log("  Importing to D1...");
	const startTime = Date.now();
	const { success, failed } = await batchExecuteD1(statements, {
		tableName: "threads",
		disableForeignKeys: true,
		onProgress: (done, total) => {
			process.stdout.write(
				`\r    Progress: ${done}/${total} (${Math.round((done / total) * 100)}%)`,
			);
		},
	});
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\n    ✅ Imported: ${success} success, ${failed} failed in ${elapsed}s`);

	const count = await getRowCount("threads");
	console.log(`    ✅ Verified: ${count} rows`);

	return { success, failed, total: threads.length };
}

async function main() {
	const args = process.argv.slice(2);
	const limitIdx = args.indexOf("--limit");
	const limit = limitIdx >= 0 ? Number.parseInt(args[limitIdx + 1], 10) : undefined;

	console.log("📝 Threads Import");
	console.log("=".repeat(50));

	console.log("\n1. Verifying test database...");
	const isTest = await verifyTestDb();
	if (!isTest) {
		console.error("❌ SAFETY CHECK FAILED!");
		process.exit(1);
	}
	console.log("   ✅ Test database confirmed");

	console.log("\n2. Importing threads...");
	const result = await importTable({ limit });

	console.log(`\n${"=".repeat(50)}`);
	console.log(`✨ Threads import complete! (${result.success}/${result.total})`);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("❌ Error:", err);
		process.exit(1);
	});
}
