#!/usr/bin/env bun
/**
 * Migrate Discuz UCenter PMs to D1
 *
 * Required env vars:
 *   MIGRATION_SSH_HOST  — VPS hostname
 *   MIGRATION_SSH_USER  — SSH username (optional, defaults to current user)
 *   MIGRATION_MYSQL_DB  — UCenter database name (default: db_ucenter)
 *   MIGRATION_MYSQL_MAIN_DB — Main Discuz database (default: db_main)
 *
 * Usage:
 * 1. Set env vars (or export in shell)
 * 2. Run: bun scripts/migrate-pm.ts
 */

import { $ } from "bun";

function bail(msg: string): never {
	console.error(`ERROR: ${msg}`);
	process.exit(1);
}

const SSH_HOST = process.env.MIGRATION_SSH_HOST ?? bail("Set MIGRATION_SSH_HOST");
const SSH_USER = process.env.MIGRATION_SSH_USER ?? process.env.USER ?? "root";
const MYSQL_UC_DB = process.env.MIGRATION_MYSQL_DB ?? "db_ucenter";
const MYSQL_MAIN_DB = process.env.MIGRATION_MYSQL_MAIN_DB ?? "db_main";

const BATCH_SIZE = 500;

interface PmRow {
	id: number;
	sender_id: number;
	sender_name: string;
	receiver_id: number;
	receiver_name: string;
	subject: string;
	content: string;
	is_read: number;
	sender_deleted: number;
	receiver_deleted: number;
	created_at: number;
}

async function exportFromMysql() {
	console.log("Exporting from MySQL...");

	const result = await $`/usr/bin/ssh ${SSH_USER}@${SSH_HOST} "sudo mysql ${MYSQL_UC_DB} -N -B -e '
SELECT
    p.pmid,
    p.msgfromid,
    COALESCE(u1.username, p.msgfrom, \"unknown\"),
    p.msgtoid,
    COALESCE(u2.username, \"unknown\"),
    REPLACE(p.subject, \"\t\", \" \"),
    REPLACE(REPLACE(p.message, \"\t\", \" \"), \"\n\", \"\\\\n\"),
    CASE WHEN p.new = 0 THEN 1 ELSE 0 END,
    0,
    0,
    p.dateline
FROM uc_pms p
LEFT JOIN ${MYSQL_MAIN_DB}.pre_common_member u1 ON p.msgfromid = u1.uid
LEFT JOIN ${MYSQL_MAIN_DB}.pre_common_member u2 ON p.msgtoid = u2.uid
WHERE p.delstatus = 0
ORDER BY p.pmid
'"`.text();

	return result
		.trim()
		.split("\n")
		.map((line) => {
			const parts = line.split("\t");
			return {
				id: Number.parseInt(parts[0], 10),
				sender_id: Number.parseInt(parts[1], 10),
				sender_name: parts[2] || "unknown",
				receiver_id: Number.parseInt(parts[3], 10),
				receiver_name: parts[4] || "unknown",
				subject: parts[5] || "",
				content: (parts[6] || "").replace(/\\n/g, "\n"),
				is_read: Number.parseInt(parts[7], 10) || 0,
				sender_deleted: Number.parseInt(parts[8], 10) || 0,
				receiver_deleted: Number.parseInt(parts[9], 10) || 0,
				created_at: Number.parseInt(parts[10], 10) || 0,
			} as PmRow;
		});
}

async function importToD1(rows: PmRow[]) {
	console.log(`Importing ${rows.length} rows to D1...`);

	// Generate SQL file
	const sqlLines: string[] = [];

	for (const row of rows) {
		const escapedSubject = row.subject.replace(/'/g, "''");
		const escapedContent = row.content.replace(/'/g, "''");
		const escapedSenderName = row.sender_name.replace(/'/g, "''");
		const escapedReceiverName = row.receiver_name.replace(/'/g, "''");

		sqlLines.push(
			`INSERT INTO messages (id, sender_id, sender_name, receiver_id, receiver_name, subject, content, is_read, sender_deleted, receiver_deleted, created_at) VALUES (${row.id}, ${row.sender_id}, '${escapedSenderName}', ${row.receiver_id}, '${escapedReceiverName}', '${escapedSubject}', '${escapedContent}', ${row.is_read}, ${row.sender_deleted}, ${row.receiver_deleted}, ${row.created_at});`,
		);
	}

	// Write to SQL file
	const sqlFile = "./scripts/pms-import.sql";
	await Bun.write(sqlFile, sqlLines.join("\n"));
	console.log(`Written ${sqlLines.length} INSERT statements to ${sqlFile}`);

	// Import in batches
	const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
	for (let i = 0; i < totalBatches; i++) {
		const start = i * BATCH_SIZE;
		const end = Math.min(start + BATCH_SIZE, rows.length);
		const batchSql = sqlLines.slice(start, end).join("\n");

		const batchFile = `./scripts/pms-batch-${i}.sql`;
		await Bun.write(batchFile, batchSql);

		console.log(`Batch ${i + 1}/${totalBatches}: importing rows ${start + 1}-${end}...`);

		try {
			await $`cd apps/worker && npx wrangler d1 execute YOUR_D1_DATABASE --remote --file=../../${batchFile} -c wrangler.toml`.quiet();
			console.log(`  ✓ Batch ${i + 1} imported successfully`);
		} catch (err) {
			console.error(`  ✗ Batch ${i + 1} failed:`, err);
		}

		// Clean up batch file
		await $`rm ${batchFile}`.quiet();
	}
}

async function main() {
	console.log("=== Discuz PM Migration to D1 ===\n");

	// Export from MySQL
	const rows = await exportFromMysql();
	console.log(`Exported ${rows.length} PMs from MySQL\n`);

	if (rows.length === 0) {
		console.log("No data to import");
		return;
	}

	// Preview first few rows
	console.log("Preview (first 3 rows):");
	for (const row of rows.slice(0, 3)) {
		console.log(
			`  #${row.id}: ${row.sender_name} -> ${row.receiver_name}: ${row.subject || "(no subject)"}`,
		);
	}
	console.log("");

	// Import to D1
	await importToD1(rows);

	console.log("\n=== Migration Complete ===");
}

main().catch(console.error);
