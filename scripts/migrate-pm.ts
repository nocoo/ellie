#!/usr/bin/env bun
/**
 * Migrate Discuz UCenter PMs to D1
 *
 * Usage:
 * 1. First export from MySQL on tongji.nocoo.cloud:
 *    sudo mysql db_tongji_ucenter -N -e "SELECT ... INTO OUTFILE '/tmp/pms.csv' ..."
 * 2. Copy to local: scp tongji.nocoo.cloud:/tmp/pms.csv ./scripts/pms.csv
 * 3. Run this script: bun scripts/migrate-pm.ts
 */

import { $ } from "bun";

const BATCH_SIZE = 500; // D1 batch limit consideration
const CSV_FILE = "./scripts/pms.csv";

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

	const result = await $`/usr/bin/ssh tongji.nocoo.cloud "sudo mysql db_tongji_ucenter -N -B -e '
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
LEFT JOIN db_tongji_main.pre_common_member u1 ON p.msgfromid = u1.uid
LEFT JOIN db_tongji_main.pre_common_member u2 ON p.msgtoid = u2.uid
WHERE p.delstatus = 0
ORDER BY p.pmid
'"`.text();

	return result
		.trim()
		.split("\n")
		.map((line) => {
			const parts = line.split("\t");
			return {
				id: Number.parseInt(parts[0]),
				sender_id: Number.parseInt(parts[1]),
				sender_name: parts[2] || "unknown",
				receiver_id: Number.parseInt(parts[3]),
				receiver_name: parts[4] || "unknown",
				subject: parts[5] || "",
				content: (parts[6] || "").replace(/\\n/g, "\n"),
				is_read: Number.parseInt(parts[7]) || 0,
				sender_deleted: Number.parseInt(parts[8]) || 0,
				receiver_deleted: Number.parseInt(parts[9]) || 0,
				created_at: Number.parseInt(parts[10]) || 0,
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
			await $`cd apps/worker && npx wrangler d1 execute tongjinet-db --remote --file=../../${batchFile} -c wrangler.toml`.quiet();
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
