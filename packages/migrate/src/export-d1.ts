/**
 * Export ellie.db to D1-compatible SQL files.
 * Avoids sqlite3 CLI's unistr() which D1 doesn't support.
 */
import { Database } from "bun:sqlite";

const DB_PATH = "output/ellie.db";
const OUT_DIR = "output/d1-import";

const db = new Database(DB_PATH, { readonly: true });

function sqlEscape(val: unknown): string {
	if (val === null || val === undefined) return "NULL";
	if (typeof val === "number") return String(val);
	// String: escape single quotes by doubling
	const s = String(val).replace(/'/g, "''");
	return `'${s}'`;
}

function exportTable(table: string, filename: string, whereClause?: string): number {
	const where = whereClause ? ` WHERE ${whereClause}` : "";
	const rows = db.query(`SELECT * FROM ${table}${where}`).all() as Record<string, unknown>[];
	if (rows.length === 0) return 0;

	const cols = Object.keys(rows[0]);
	const file = Bun.file(`${OUT_DIR}/${filename}`);
	const writer = file.writer();

	writer.write("PRAGMA defer_foreign_keys = true;\n");

	// Write in batches of 200 rows per INSERT for efficiency
	const BATCH = 200;
	for (let i = 0; i < rows.length; i += BATCH) {
		const batch = rows.slice(i, i + BATCH);
		const values = batch
			.map((row) => `(${cols.map((c) => sqlEscape(row[c])).join(",")})`)
			.join(",\n");
		writer.write(`INSERT INTO ${table} VALUES\n${values};\n`);
	}

	writer.flush();
	writer.end();
	return rows.length;
}

function exportTableChunked(
	table: string,
	filenamePrefix: string,
	idRanges: [number, number][],
): void {
	for (let i = 0; i < idRanges.length; i++) {
		const [minId, maxId] = idRanges[i];
		const filename = `${filenamePrefix}-${i + 1}.sql`;
		const where =
			maxId === Number.POSITIVE_INFINITY ? `id >= ${minId}` : `id >= ${minId} AND id < ${maxId}`;

		const count = db.query(`SELECT COUNT(*) as c FROM ${table} WHERE ${where}`).get() as {
			c: number;
		};
		console.log(`  ${filename}: ${count.c.toLocaleString()} rows...`);

		const file = Bun.file(`${OUT_DIR}/${filename}`);
		const writer = file.writer();
		writer.write("PRAGMA defer_foreign_keys = true;\n");

		// Stream in pages, one INSERT per row (D1 has 100KB SQL length limit)
		const PAGE = 5000;
		let offset = 0;
		let total = 0;

		while (true) {
			const rows = db
				.query(`SELECT * FROM ${table} WHERE ${where} ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`)
				.all() as Record<string, unknown>[];

			if (rows.length === 0) break;
			const cols = Object.keys(rows[0]);

			for (const row of rows) {
				const values = cols.map((c) => sqlEscape(row[c])).join(",");
				writer.write(`INSERT INTO ${table} VALUES(${values});\n`);
			}

			total += rows.length;
			offset += PAGE;

			if (total % 500000 === 0) {
				console.log(`    ${total.toLocaleString()} rows written...`);
			}
		}

		writer.flush();
		writer.end();
		console.log(`  ${filename}: done. ${total.toLocaleString()} rows.`);
	}
}

const t0 = Date.now();

console.log("Exporting forums...");
const forums = exportTable("forums", "02-forums.sql");
console.log(`  ${forums} rows`);

console.log("Exporting users...");
const users = exportTable("users", "03-users.sql");
console.log(`  ${users.toLocaleString()} rows`);

console.log("Exporting threads...");
const threads = exportTable("threads", "04-threads.sql");
console.log(`  ${threads.toLocaleString()} rows`);

console.log("Exporting posts (chunked)...");
exportTableChunked("posts", "05-posts", [
	[0, 1500000],
	[1500000, 3000000],
	[3000000, 4500000],
	[4500000, 6000000],
	[6000000, 7500000],
	[7500000, 9000000],
	[9000000, Number.POSITIVE_INFINITY],
]);

console.log("Exporting attachments...");
const attachments = exportTable("attachments", "06-attachments.sql");
console.log(`  ${attachments.toLocaleString()} rows`);

db.close();
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
