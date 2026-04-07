/**
 * Streaming MySQL Dump Parser for Large Files
 *
 * Uses line-by-line streaming to handle files larger than 2GB
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

interface ParseOptions {
	limit?: number;
	offset?: number;
	onRow?: (row: unknown[]) => void;
}

/**
 * Stream parse a MySQL dump file for INSERT statements
 */
export async function streamParseMySQLDump(
	filePath: string,
	tableName: string,
	options: ParseOptions = {},
): Promise<{ columns: string[]; rows: unknown[][] }> {
	const { limit, offset = 0, onRow } = options;

	return new Promise((resolve, reject) => {
		const rows: unknown[][] = [];
		let columns: string[] = [];
		let skipped = 0;
		let collected = 0;
		let inCreateTable = false;
		let createTableBuffer = "";

		// Create read stream with decompression
		const fileStream = createReadStream(filePath);
		const stream = filePath.endsWith(".gz") ? fileStream.pipe(createGunzip()) : fileStream;

		const rl = createInterface({
			input: stream,
			crlfDelay: Number.POSITIVE_INFINITY,
		});

		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Parser state machine
		rl.on("line", (line) => {
			// Check if we've collected enough
			if (limit && collected >= limit) {
				rl.close();
				return;
			}

			// Look for CREATE TABLE to extract columns
			if (line.includes(`CREATE TABLE \`${tableName}\``)) {
				inCreateTable = true;
				createTableBuffer = line;
				return;
			}

			if (inCreateTable) {
				createTableBuffer += `\n${line}`;
				if (line.includes(";")) {
					// Parse columns from CREATE TABLE
					columns = extractColumns(createTableBuffer);
					inCreateTable = false;
					createTableBuffer = "";
				}
				return;
			}

			// Look for INSERT INTO statements
			if (line.startsWith(`INSERT INTO \`${tableName}\` VALUES`)) {
				// Extract values part
				const valuesStart = line.indexOf("VALUES");
				if (valuesStart === -1) return;

				const valuesStr = line.slice(valuesStart + 6).trim();
				// Remove trailing semicolon if present
				const cleanValues = valuesStr.endsWith(";") ? valuesStr.slice(0, -1) : valuesStr;

				// Parse tuples
				const tuples = parseValueTuples(cleanValues);

				for (const tuple of tuples) {
					if (limit && collected >= limit) break;

					if (offset > 0 && skipped < offset) {
						skipped++;
						continue;
					}

					if (onRow) {
						onRow(tuple);
					} else {
						rows.push(tuple);
					}
					collected++;
				}
			}
		});

		rl.on("close", () => {
			resolve({ columns, rows });
		});

		rl.on("error", (err) => {
			reject(err);
		});
	});
}

/**
 * Extract column names from CREATE TABLE statement
 */
function extractColumns(createTable: string): string[] {
	const columns: string[] = [];
	const matches = createTable.matchAll(/`(\w+)`\s+\w+/g);
	for (const match of matches) {
		if (!match[0].includes("PRIMARY") && !match[0].includes("KEY") && !match[0].includes("INDEX")) {
			columns.push(match[1]);
		}
	}
	return columns;
}

/**
 * Parse value tuples from INSERT VALUES clause
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Parser state machine
function parseValueTuples(valuesStr: string): unknown[][] {
	const rows: unknown[][] = [];
	let current: unknown[] = [];
	let inString = false;
	let stringChar = "";
	let currentValue = "";
	let depth = 0;
	let escaped = false;

	for (let i = 0; i < valuesStr.length; i++) {
		const char = valuesStr[i];

		if (escaped) {
			currentValue += char;
			escaped = false;
			continue;
		}

		if (char === "\\") {
			escaped = true;
			currentValue += char;
			continue;
		}

		if (inString) {
			if (char === stringChar) {
				if (valuesStr[i + 1] === stringChar) {
					currentValue += char;
					i++;
					continue;
				}
				inString = false;
			}
			currentValue += char;
			continue;
		}

		if (char === "'" || char === '"') {
			inString = true;
			stringChar = char;
			currentValue += char;
			continue;
		}

		if (char === "(") {
			if (depth === 0) {
				current = [];
				currentValue = "";
			} else {
				currentValue += char;
			}
			depth++;
			continue;
		}

		if (char === ")") {
			depth--;
			if (depth === 0) {
				current.push(parseValue(currentValue.trim()));
				rows.push(current);
				currentValue = "";
			} else {
				currentValue += char;
			}
			continue;
		}

		if (char === "," && depth === 1) {
			current.push(parseValue(currentValue.trim()));
			currentValue = "";
			continue;
		}

		if (depth > 0) {
			currentValue += char;
		}
	}

	return rows;
}

/**
 * Parse a single MySQL value
 */
function parseValue(value: string): unknown {
	if (value === "NULL" || value === "null") {
		return null;
	}

	if (
		(value.startsWith("'") && value.endsWith("'")) ||
		(value.startsWith('"') && value.endsWith('"'))
	) {
		let str = value.slice(1, -1);
		str = str
			.replace(/\\n/g, "\n")
			.replace(/\\r/g, "\r")
			.replace(/\\t/g, "\t")
			.replace(/\\'/g, "'")
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, "\\")
			.replace(/''/g, "'")
			.replace(/""/g, '"');
		return str;
	}

	if (/^-?\d+$/.test(value)) {
		return Number.parseInt(value, 10);
	}

	if (/^-?\d+\.\d+$/.test(value)) {
		return Number.parseFloat(value);
	}

	return value;
}

/**
 * Convert parsed rows to objects
 */
export function rowsToObjects(columns: string[], rows: unknown[][]): Record<string, unknown>[] {
	return rows.map((row) => {
		const obj: Record<string, unknown> = {};
		columns.forEach((col, i) => {
			obj[col] = row[i];
		});
		return obj;
	});
}

// CLI for testing
if (import.meta.main) {
	const args = process.argv.slice(2);
	const filePath = args[0] || "reference/db/post_main.sql.gz";
	const tableName = args[1] || "pre_forum_post";
	const limit = 10;

	console.log(`Streaming parse ${filePath} for ${tableName} (limit ${limit})...`);

	const start = Date.now();
	const { columns, rows } = await streamParseMySQLDump(filePath, tableName, {
		limit,
	});
	const elapsed = Date.now() - start;

	console.log(`Found ${columns.length} columns, ${rows.length} rows in ${elapsed}ms`);
	console.log(`Columns: ${columns.slice(0, 10).join(", ")}...`);

	for (const row of rows.slice(0, 3)) {
		console.log(row.slice(0, 5));
	}
}
