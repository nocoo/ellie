/**
 * Export remaining posts to D1-compatible SQL files.
 * KEY FIX: Escape newlines so every INSERT is a single line.
 * D1 import parses SQL line-by-line, so multi-line INSERTs fail silently.
 *
 * Approach: replace \n with ' || char(10) || ' and \r with ' || char(13) || '
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";

const DB_PATH = "output/ellie.db";
const OUT_DIR = "output/d1-import/v2";

mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

function sqlEscape(val: unknown): string {
	if (val === null || val === undefined) return "NULL";
	if (typeof val === "number") return String(val);

	let s = String(val);
	// Escape single quotes
	s = s.replace(/'/g, "''");

	// Check for control characters that would cause multi-line SQL
	if (s.includes("\n") || s.includes("\r")) {
		// Split on newlines and rejoin with char(10)/char(13) concatenation
		// This ensures the INSERT stays on one line
		const parts: string[] = [];
		let current = "";
		for (let i = 0; i < s.length; i++) {
			const ch = s[i];
			if (ch === "\r") {
				if (current) parts.push(`'${current}'`);
				else if (parts.length === 0) parts.push("''");
				parts.push("char(13)");
				current = "";
			} else if (ch === "\n") {
				if (current) parts.push(`'${current}'`);
				else if (parts.length === 0) parts.push("''");
				parts.push("char(10)");
				current = "";
			} else {
				current += ch;
			}
		}
		if (current) parts.push(`'${current}'`);
		else if (
			parts.length > 0 &&
			(parts[parts.length - 1] === "char(10)" || parts[parts.length - 1] === "char(13)")
		) {
			parts.push("''");
		}

		return parts.join(" || ");
	}

	return `'${s}'`;
}

// Verify escape function works correctly
const test1 = sqlEscape("hello\nworld");
console.assert(test1 === "'hello' || char(10) || 'world'", `Test failed: ${test1}`);
const test2 = sqlEscape("no newlines");
console.assert(test2 === "'no newlines'", `Test failed: ${test2}`);
const test3 = sqlEscape("a\r\nb");
console.assert(test3 === "'a' || char(13) || char(10) || 'b'", `Test failed: ${test3}`);
const test4 = sqlEscape("\nstart");
console.assert(test4 === "'' || char(10) || 'start'", `Test failed: ${test4}`);
console.log("Escape function tests passed.");

// Get the current D1 state: 6,515,268 posts, max_id = 6,882,544
const startId = 6882545;
const maxId = (db.query("SELECT MAX(id) as m FROM posts").get() as { m: number }).m;
console.log(`Exporting from id ${startId} to ${maxId}`);

const totalRemaining = (
	db.query(`SELECT COUNT(*) as c FROM posts WHERE id >= ${startId}`).get() as { c: number }
).c;
console.log(`Total remaining rows: ${totalRemaining.toLocaleString()}`);

// Use 100K step
const STEP = 100000;
let chunkNum = 1;
let grandTotal = 0;

for (let minId = startId; minId <= maxId; minId += STEP) {
	const nextId = minId + STEP;
	const where = nextId > maxId ? `id >= ${minId}` : `id >= ${minId} AND id < ${nextId}`;

	const count = (db.query(`SELECT COUNT(*) as c FROM posts WHERE ${where}`).get() as { c: number })
		.c;
	if (count === 0) continue;

	const filename = `posts-${String(chunkNum).padStart(2, "0")}.sql`;
	const filepath = `${OUT_DIR}/${filename}`;

	if (existsSync(filepath)) unlinkSync(filepath);

	const file = Bun.file(filepath);
	const writer = file.writer();

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
		`  ${filename}: id ${minId}-${Math.min(nextId - 1, maxId)}, ${total.toLocaleString()} rows, ${sizeMB} MB`,
	);
	chunkNum++;
	grandTotal += total;
}

db.close();
console.log(`\nDone. ${grandTotal.toLocaleString()} rows in ${chunkNum - 1} files.`);
