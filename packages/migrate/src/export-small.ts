/**
 * Export remaining posts (id > 6882544) in tiny chunks (~50MB each).
 * Picks up from where D1 import left off.
 */
import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "node:fs";

const DB_PATH = "output/ellie.db";
const OUT_DIR = "output/d1-import/small";

const db = new Database(DB_PATH, { readonly: true });

// Ensure output dir exists
const { mkdirSync } = await import("node:fs");
mkdirSync(OUT_DIR, { recursive: true });

function sqlEscape(val: unknown): string {
	if (val === null || val === undefined) return "NULL";
	if (typeof val === "number") return String(val);
	const s = String(val).replace(/'/g, "''");
	return `'${s}'`;
}

// Resume from where D1 left off: max_id in D1 is 6882544
// But we need to check if all rows with id <= 6882544 AND id >= 6750000 are imported
// D1 has 128,952 rows in range 6750000-6882544
// Local DB should have the same count for that range
const localCount = (
	db.query("SELECT COUNT(*) as c FROM posts WHERE id >= 6750000 AND id <= 6882544").get() as {
		c: number;
	}
).c;
console.log(`Local rows in 6750000-6882544: ${localCount}`);
console.log("D1 has 128,952 rows in this range");

if (localCount > 128952) {
	console.log(`WARNING: D1 is missing ${localCount - 128952} rows in range 6750000-6882544!`);
	console.log("These will need a separate fix. For now, starting from id > 6882544");
}

// Start from id > 6882544 (what D1 has)
const startId = 6882545;
const maxId = (db.query("SELECT MAX(id) as m FROM posts").get() as { m: number }).m;
console.log(`Exporting from id ${startId} to ${maxId}`);

const totalRemaining = (
	db.query(`SELECT COUNT(*) as c FROM posts WHERE id >= ${startId}`).get() as { c: number }
).c;
console.log(`Total remaining rows: ${totalRemaining.toLocaleString()}`);

// Use 100K ID step for smaller chunks
const STEP = 100000;
let chunkNum = 1;

for (let minId = startId; minId <= maxId; minId += STEP) {
	const nextId = minId + STEP;
	const where = nextId > maxId ? `id >= ${minId}` : `id >= ${minId} AND id < ${nextId}`;

	const count = (db.query(`SELECT COUNT(*) as c FROM posts WHERE ${where}`).get() as { c: number })
		.c;
	if (count === 0) continue;

	const filename = `posts-s${String(chunkNum).padStart(2, "0")}.sql`;
	const filepath = `${OUT_DIR}/${filename}`;

	if (existsSync(filepath)) unlinkSync(filepath);

	const file = Bun.file(filepath);
	const writer = file.writer();
	writer.write("PRAGMA foreign_keys = OFF;\n");

	const PAGE = 5000;
	let offset = 0;
	let total = 0;

	while (true) {
		const rows = db
			.query(`SELECT * FROM posts WHERE ${where} ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`)
			.all() as Record<string, unknown>[];

		if (rows.length === 0) break;
		const cols = Object.keys(rows[0]);

		for (const row of rows) {
			const values = cols.map((c) => sqlEscape(row[c])).join(",");
			writer.write(`INSERT INTO posts VALUES(${values});\n`);
		}

		total += rows.length;
		offset += PAGE;
	}

	writer.flush();
	writer.end();

	const stat = Bun.file(filepath);
	const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
	console.log(
		`  ${filename}: id ${minId}-${Math.min(nextId, maxId)}, ${total.toLocaleString()} rows, ${sizeMB} MB`,
	);
	chunkNum++;
}

// Also export the missing rows from the partial r1 import
// D1 has ids 6750001-6882544, but local has more rows in 6750000-7000000
const missingWhere = "id > 6882544 AND id < 6982545";
const missingCount = (
	db.query(`SELECT COUNT(*) as c FROM posts WHERE ${missingWhere}`).get() as { c: number }
).c;
console.log(`\nNote: ${missingCount} rows in gap 6882545-6982544 are included in s01`);

db.close();
console.log("\nAll small chunks exported.");
