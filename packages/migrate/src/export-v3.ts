/**
 * Export remaining posts (id >= 6882545) for D1 import.
 * Uses replace() for newlines to avoid expression depth limit.
 * Each file: 20K rows.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";

const DB_PATH = "output/ellie.db";
const OUT_DIR = "output/d1-import/v3";

mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

// Placeholder tokens that won't appear in real content
const LF_TOKEN = "{{LF}}";
const CR_TOKEN = "{{CR}}";

function sqlEscape(val: unknown): string {
	if (val === null || val === undefined) return "NULL";
	if (typeof val === "number") return String(val);

	let s = String(val);
	// Strip NULL bytes (corrupt data from legacy forum migrations)
	s = s.replaceAll("\x00", "");
	// Escape single quotes
	s = s.replace(/'/g, "''");

	const hasCR = s.includes("\r");
	const hasLF = s.includes("\n");

	if (!hasCR && !hasLF) return `'${s}'`;

	// Replace actual newlines with tokens
	if (hasCR) s = s.replaceAll("\r", CR_TOKEN);
	if (hasLF) s = s.replaceAll("\n", LF_TOKEN);

	// Wrap with replace() calls
	let expr = `'${s}'`;
	if (hasLF) expr = `replace(${expr},'${LF_TOKEN}',char(10))`;
	if (hasCR) expr = `replace(${expr},'${CR_TOKEN}',char(13))`;

	return expr;
}

// Verify
const t1 = sqlEscape("hello\nworld");
console.assert(t1 === `replace('hello${LF_TOKEN}world','${LF_TOKEN}',char(10))`, `FAIL: ${t1}`);
const t2 = sqlEscape("a\r\nb");
console.assert(t2.includes("replace(replace("), `FAIL: ${t2}`);
const t3 = sqlEscape("no newline");
console.assert(t3 === "'no newline'", `FAIL: ${t3}`);
console.log("Tests passed.");

// Also verify tokens don't appear in actual data
const tokenCheck = db
	.query(
		`SELECT COUNT(*) as c FROM posts WHERE content LIKE '%${LF_TOKEN}%' OR content LIKE '%${CR_TOKEN}%'`,
	)
	.get() as { c: number };
console.log(`Posts containing token strings: ${tokenCheck.c}`);
if (tokenCheck.c > 0) {
	console.error("ERROR: Token collision detected! Need different tokens.");
	process.exit(1);
}

const startId = 6882545;
const maxId = (db.query("SELECT MAX(id) as m FROM posts").get() as { m: number }).m;
const totalRemaining = (
	db.query(`SELECT COUNT(*) as c FROM posts WHERE id >= ${startId}`).get() as { c: number }
).c;
console.log(`Range: id ${startId}-${maxId}, ${totalRemaining.toLocaleString()} rows`);

// Clean old files
for (const f of new Bun.Glob("p*.sql").scanSync(OUT_DIR)) {
	unlinkSync(`${OUT_DIR}/${f}`);
}

const ROWS_PER_FILE = 20000;
let chunkNum = 1;
let grandTotal = 0;
let truncatedCount = 0;
let offset = 0;
const PAGE = 5000;

let writer: ReturnType<typeof Bun.file.prototype.writer> | null = null;
let currentRows = 0;
let currentFile = "";

function openNewChunk() {
	if (writer) {
		writer.flush();
		writer.end();
		const sizeMB = (Bun.file(currentFile).size / 1024 / 1024).toFixed(1);
		console.log(`  ${currentFile}: ${currentRows} rows, ${sizeMB} MB`);
	}
	currentFile = `${OUT_DIR}/p${String(chunkNum).padStart(3, "0")}.sql`;
	if (existsSync(currentFile)) unlinkSync(currentFile);
	writer = Bun.file(currentFile).writer();
	currentRows = 0;
	chunkNum++;
}

openNewChunk();

while (true) {
	const rows = db
		.query(`SELECT * FROM posts WHERE id >= ${startId} ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`)
		.all() as Record<string, unknown>[];

	if (rows.length === 0) break;
	const cols = Object.keys(rows[0]);

	for (const row of rows) {
		if (currentRows >= ROWS_PER_FILE) openNewChunk();
		// D1 max SQL statement: 100KB. We target 95KB to be safe.
		// Strategy: try full content first, if too long, progressively halve content.
		let content = String(row.content ?? "");
		let line: string;
		let attempts = 0;
		while (true) {
			const rowToWrite =
				attempts === 0 ? row : { ...row, content: `${content}\n[content truncated]` };
			const values = cols.map((c) => sqlEscape(rowToWrite[c])).join(",");
			line = `INSERT INTO posts VALUES(${values});\n`;
			// Use TextEncoder for accurate UTF-8 byte length
			const byteLen = new TextEncoder().encode(line).length;
			if (byteLen <= 95000) break;
			// Truncate: halve content length
			if (attempts === 0) {
				truncatedCount++;
			}
			content = content.slice(0, Math.floor(content.length / 2));
			attempts++;
			if (attempts > 20) break; // safety valve
		}
		if (writer && line) {
			writer.write(line);
		}
		currentRows++;
		grandTotal++;
	}

	offset += PAGE;
	if (grandTotal % 200000 === 0) {
		console.log(`  ${grandTotal.toLocaleString()} rows processed...`);
	}
}

// Close last file
if (writer) {
	writer.flush();
	writer.end();
	const sizeMB = (Bun.file(currentFile).size / 1024 / 1024).toFixed(1);
	console.log(`  ${currentFile}: ${currentRows} rows, ${sizeMB} MB`);
}

db.close();
console.log(
	`\nDone. ${grandTotal.toLocaleString()} rows in ${chunkNum - 1} files. ${truncatedCount} truncated.`,
);
