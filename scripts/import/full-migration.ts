#!/usr/bin/env bun
/**
 * Full Migration Dry-Run Script
 *
 * Clears test DB and imports all data from MySQL dumps.
 * Must run tables in correct order due to FK dependencies.
 *
 * Order: Clear (reverse), Import (forward)
 * - posts → threads → forums → users (clear)
 * - users → forums → threads → posts (import)
 *
 * Usage:
 *   bun run scripts/import/full-migration.ts
 *   bun run scripts/import/full-migration.ts --table forums
 *   bun run scripts/import/full-migration.ts --skip-clear
 */

import { executeD1, getRowCount, verifyTestDb } from "./d1-importer";

// Table order for import (FK dependencies)
const IMPORT_ORDER = ["users", "forums", "threads", "posts", "attachments", "messages"] as const;

// Clear order is reverse of import
const CLEAR_ORDER = [...IMPORT_ORDER].reverse();

// Admin tables (no FK dependencies)
const ADMIN_TABLES = [
	"ip_bans",
	"censor_words",
	"settings",
	"reports",
	"admin_logs",
	"announcements",
] as const;

async function clearAllTables(): Promise<void> {
	console.log("📦 Clearing tables...");

	// First clear admin tables (no FK)
	for (const table of ADMIN_TABLES) {
		try {
			await executeD1(`DELETE FROM "${table}"`);
			console.log(`  ✅ ${table}`);
		} catch (_e) {
			console.log(`  ⚠️ ${table} (may not exist)`);
		}
	}

	// Then clear main tables in reverse FK order
	for (const table of CLEAR_ORDER) {
		try {
			await executeD1(`DELETE FROM "${table}"`);
			console.log(`  ✅ ${table}`);
		} catch (_e) {
			console.log(`  ⚠️ ${table} (may not exist or has FK issues)`);
		}
	}
}

async function verifyCounts(): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	for (const table of IMPORT_ORDER) {
		try {
			const count = await getRowCount(table);
			counts.set(table, count);
		} catch {
			counts.set(table, -1);
		}
	}
	return counts;
}

async function main() {
	const args = process.argv.slice(2);
	const skipClear = args.includes("--skip-clear");
	const tableIdx = args.indexOf("--table");
	const specificTable = tableIdx >= 0 ? args[tableIdx + 1] : null;

	console.log("🚀 Full Migration Dry-Run");
	console.log("=".repeat(60));

	// Safety check
	console.log("\n1. Verifying test database...");
	const isTest = await verifyTestDb();
	if (!isTest) {
		console.error("❌ SAFETY CHECK FAILED: Not connected to test database!");
		console.error("   Aborting to prevent accidental production data loss.");
		process.exit(1);
	}
	console.log("   ✅ Test database confirmed (tongjinet-db-test)");

	// Show current state
	console.log("\n2. Current state:");
	const beforeCounts = await verifyCounts();
	for (const [table, count] of beforeCounts) {
		console.log(`   ${table}: ${count >= 0 ? count : "N/A"} rows`);
	}

	// Clear
	if (!skipClear) {
		console.log("\n3. Clearing tables...");
		await clearAllTables();
	} else {
		console.log("\n3. Skipping clear (--skip-clear)");
	}

	// Import each table
	console.log("\n4. Importing data...");
	const tablesToImport = specificTable ? [specificTable] : (IMPORT_ORDER as unknown as string[]);

	for (const table of tablesToImport) {
		console.log(`\n--- ${table.toUpperCase()} ---`);
		try {
			// Dynamic import of table-specific importer
			const importerPath = `./import-${table}.ts`;
			const { importTable } = await import(importerPath);
			await importTable();
		} catch (e) {
			if ((e as Error).message.includes("Cannot find module")) {
				console.log(`  ⚠️ Importer not implemented yet: ${table}`);
			} else {
				console.error(`  ❌ Error importing ${table}:`, (e as Error).message);
			}
		}
	}

	// Final verification
	console.log("\n5. Final verification:");
	const afterCounts = await verifyCounts();
	console.log("   Table".padEnd(15) + "Before".padStart(12) + "After".padStart(12));
	console.log(`   ${"-".repeat(35)}`);
	for (const [table, after] of afterCounts) {
		const before = beforeCounts.get(table) ?? 0;
		const beforeStr = before >= 0 ? before.toLocaleString() : "N/A";
		const afterStr = after >= 0 ? after.toLocaleString() : "N/A";
		console.log(`   ${table.padEnd(15)}${beforeStr.padStart(12)}${afterStr.padStart(12)}`);
	}

	console.log(`\n${"=".repeat(60)}`);
	console.log("✨ Migration dry-run complete!");
}

main().catch((err) => {
	console.error("❌ Error:", err);
	process.exit(1);
});
