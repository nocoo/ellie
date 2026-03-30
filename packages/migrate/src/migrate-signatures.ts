/**
 * Standalone migration script — extract user signatures from MySQL dump
 * and generate D1-compatible SQL UPDATE statements.
 *
 * Source tables:
 *   - pre_common_member_field_forum (sightml at column index 5)
 *   - pre_common_member_field_forum_archive (same schema)
 *
 * Usage:
 *   bun run packages/migrate/src/migrate-signatures.ts \
 *     --source reference/db/member_field_forum.sql.gz \
 *     --output reference/db/signature-updates.sql
 *
 * Then apply to D1:
 *   npx wrangler d1 execute tongjinet-db -c apps/worker/wrangler.toml \
 *     --file reference/db/signature-updates.sql
 */

import { writeFileSync } from "node:fs";
import { parseDumpFile } from "./extract/parser";

// ─── Column indices (from DDL in schema_all.sql) ─────────────────────
// uid(0), publishfeed(1), customshow(2), customstatus(3), medals(4),
// sightml(5), groupterms(6), authstr(7), groups(8), attentiongroup(9)
const COL_UID = 0;
const COL_SIGHTML = 5;

// ─── CLI args ────────────────────────────────────────────────────────

function parseArgs(): { source: string; output: string } {
	const args = process.argv.slice(2);
	let source = "reference/db/member_field_forum.sql.gz";
	let output = "reference/db/signature-updates.sql";

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--source" && args[i + 1]) {
			source = args[++i];
		} else if (args[i] === "--output" && args[i + 1]) {
			output = args[++i];
		}
	}

	return { source, output };
}

/** Escape a string value for SQL single-quoted literal. */
function sqlEscape(value: string): string {
	return value.replace(/'/g, "''");
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
	const { source, output } = parseArgs();
	console.log(`Source: ${source}`);
	console.log(`Output: ${output}`);

	// Collect uid → sightml from both main and archive tables
	const signatures = new Map<number, string>();

	// Parse main table
	console.log("\nParsing pre_common_member_field_forum...");
	const mainCount = await parseDumpFile(source, {
		tableName: "pre_common_member_field_forum",
		onRow: (row) => {
			const uid = Number.parseInt(row[COL_UID] ?? "0", 10);
			const sightml = row[COL_SIGHTML] ?? "";
			if (uid > 0 && sightml.length > 0) {
				signatures.set(uid, sightml);
			}
		},
		onProgress: (n) => process.stdout.write(`\r  main: ${n} rows...`),
	});
	console.log(`\n  main table: ${mainCount} rows parsed, ${signatures.size} with signatures`);

	// Parse archive table (same file, same schema)
	console.log("\nParsing pre_common_member_field_forum_archive...");
	const archiveCount = await parseDumpFile(source, {
		tableName: "pre_common_member_field_forum_archive",
		onRow: (row) => {
			const uid = Number.parseInt(row[COL_UID] ?? "0", 10);
			const sightml = row[COL_SIGHTML] ?? "";
			// Only add if not already in main table (main takes priority)
			if (uid > 0 && sightml.length > 0 && !signatures.has(uid)) {
				signatures.set(uid, sightml);
			}
		},
		onProgress: (n) => process.stdout.write(`\r  archive: ${n} rows...`),
	});
	console.log(
		`\n  archive table: ${archiveCount} rows parsed, total signatures: ${signatures.size}`,
	);

	// Generate SQL UPDATE statements
	console.log(`\nGenerating ${signatures.size} UPDATE statements...`);
	const lines: string[] = [];
	lines.push(
		"-- Auto-generated: user signature migration from Discuz pre_common_member_field_forum",
	);
	lines.push(`-- Generated at: ${new Date().toISOString()}`);
	lines.push(`-- Total updates: ${signatures.size}`);
	lines.push("");

	for (const [uid, sightml] of signatures) {
		lines.push(`UPDATE users SET signature = '${sqlEscape(sightml)}' WHERE id = ${uid};`);
	}

	lines.push("");

	writeFileSync(output, lines.join("\n"), "utf-8");
	console.log(`Written to: ${output}`);
	console.log("Done!");
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
