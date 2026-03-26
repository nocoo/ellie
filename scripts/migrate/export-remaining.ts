/**
 * Export remaining posts (id >= 6750000) in small chunks (~100MB each).
 * These are posts that haven't been imported to D1 yet.
 */
import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "node:fs";

const DB_PATH = "output/ellie.db";
const OUT_DIR = "output/d1-import";

const db = new Database(DB_PATH, { readonly: true });

function sqlEscape(val: unknown): string {
	if (val === null || val === undefined) return "NULL";
	if (typeof val === "number") return String(val);
	const s = String(val).replace(/'/g, "''");
	return `'${s}'`;
}

// Export posts in small chunks: id range step of 250K
// Remaining range: 6750000 to max
const maxId = (db.query("SELECT MAX(id) as m FROM posts").get() as { m: number }).m;
console.log(`Max post id: ${maxId}`);

const STEP = 250000;
const startId = 6750000;
let chunkNum = 1;

for (let minId = startId; minId <= maxId; minId += STEP) {
	const nextId = minId + STEP;
	const where = nextId > maxId ? `id >= ${minId}` : `id >= ${minId} AND id < ${nextId}`;

	const count = (db.query(`SELECT COUNT(*) as c FROM posts WHERE ${where}`).get() as { c: number })
		.c;
	if (count === 0) continue;

	const filename = `05-posts-r${chunkNum}.sql`;
	const filepath = `${OUT_DIR}/${filename}`;

	// Delete old file if exists
	if (existsSync(filepath)) unlinkSync(filepath);

	console.log(
		`${filename}: id ${minId}-${nextId > maxId ? maxId : nextId}, ${count.toLocaleString()} rows...`,
	);

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
	console.log(`  ${filename}: done. ${total.toLocaleString()} rows, ${sizeMB} MB`);
	chunkNum++;
}

db.close();
console.log("\nAll remaining chunks exported.");
