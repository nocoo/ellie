/**
 * MySQL dump parser — stream-parse gzipped SQL dumps and extract INSERT row data.
 *
 * Design per docs/03-migration.md "SQL Dump 解析器" section:
 * - Stream gzip files line-by-line
 * - Only process `INSERT INTO \`targetTable\`` lines
 * - Handle MySQL escapes: \', \\, \n, \r, \0, NULL
 * - Handle string values containing ),( (parentheses and commas)
 * - Support extended INSERT (multiple VALUES tuples per line)
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

/** A single parsed row: array of string | null values in column order. */
export type ParsedRow = (string | null)[];

/** Options for parsing a SQL dump file. */
export interface ParseOptions {
	/** The target table name to extract (without backtick quoting). */
	tableName: string;
	/** Optional callback invoked for each parsed row. */
	onRow?: (row: ParsedRow) => void;
	/** Optional progress callback — invoked every N rows. */
	onProgress?: (count: number) => void;
	/** Progress reporting interval (default: 10000). */
	progressInterval?: number;
}

/** MySQL backslash escape character map. */
const ESCAPE_MAP: Record<string, string> = {
	"'": "'",
	"\\": "\\",
	n: "\n",
	r: "\r",
	t: "\t",
	"0": "\0",
};

/** Resolve a MySQL backslash escape character. Unknown escapes return the char as-is. */
function resolveEscape(ch: string): string {
	return ESCAPE_MAP[ch] ?? ch;
}

/** Skip whitespace in `text` starting from `pos`, return new index. */
function skipSpaces(text: string, pos: number, len: number): number {
	let i = pos;
	while (i < len && text[i] === " ") i++;
	return i;
}

/**
 * Parse one field value starting at position `i` in the tuple body.
 * Returns the parsed value and the new index position.
 */
function parseValue(text: string, pos: number, len: number): { value: string | null; end: number } {
	if (text[pos] === "N" && text.substring(pos, pos + 4) === "NULL") {
		return { value: null, end: pos + 4 };
	}
	if (text[pos] === "'") {
		return parseQuotedString(text, pos);
	}
	// Unquoted value (number, etc.)
	let i = pos;
	while (i < len && text[i] !== "," && text[i] !== ")") i++;
	return { value: text.substring(pos, i), end: i };
}

/**
 * Parse a single VALUES tuple from a MySQL extended INSERT statement.
 *
 * The input `text` starts right after the opening `(` and we parse until the
 * matching closing `)`. Returns the parsed row and the index just past `)`.
 */
export function parseTuple(text: string, start: number): { row: ParsedRow; end: number } {
	const row: ParsedRow = [];
	let i = start;
	const len = text.length;

	while (i < len) {
		i = skipSpaces(text, i, len);

		if (text[i] === ")") {
			return { row, end: i + 1 };
		}

		if (row.length > 0 && text[i] === ",") {
			i++;
			i = skipSpaces(text, i, len);
		}

		if (text[i] === ")") {
			return { row, end: i + 1 };
		}

		const { value, end } = parseValue(text, i, len);
		row.push(value);
		i = end;
	}

	return { row, end: i };
}

/**
 * Parse a MySQL single-quoted string starting at position `start`.
 * Handles escape sequences: \', \\, \n, \r, \t, \0, ''
 */
export function parseQuotedString(text: string, start: number): { value: string; end: number } {
	// start should point to the opening quote
	let i = start + 1;
	const len = text.length;
	const parts: string[] = [];
	let segStart = i;

	while (i < len) {
		const ch = text[i];

		if (ch === "\\") {
			if (i > segStart) parts.push(text.substring(segStart, i));
			i++;
			if (i >= len) break;
			parts.push(resolveEscape(text[i]));
			i++;
			segStart = i;
			continue;
		}

		if (ch === "'") {
			if (i + 1 < len && text[i + 1] === "'") {
				// Doubled single quote escape
				if (i > segStart) parts.push(text.substring(segStart, i));
				parts.push("'");
				i += 2;
				segStart = i;
			} else {
				// End of string
				if (i > segStart) parts.push(text.substring(segStart, i));
				return { value: parts.join(""), end: i + 1 };
			}
			continue;
		}

		i++;
	}

	// Should not reach here for well-formed SQL
	if (i > segStart) parts.push(text.substring(segStart, i));
	return { value: parts.join(""), end: i };
}

/**
 * Extract all VALUES tuples from a single INSERT INTO line.
 *
 * Expected format:
 *   INSERT INTO `tableName` VALUES (...),(...),(...);
 */
export function parseInsertLine(line: string, tableName: string): ParsedRow[] {
	const prefix = `INSERT INTO \`${tableName}\` VALUES `;
	if (!line.startsWith(prefix)) return [];

	const rows: ParsedRow[] = [];
	let i = prefix.length;
	const len = line.length;

	while (i < len) {
		// Skip whitespace and commas between tuples
		while (i < len && (line[i] === " " || line[i] === ",")) i++;

		if (line[i] === "(") {
			const { row, end } = parseTuple(line, i + 1);
			rows.push(row);
			i = end;
		} else if (line[i] === ";") {
			break;
		} else {
			i++;
		}
	}

	return rows;
}

/**
 * Stream-parse a gzipped MySQL dump file and yield rows for the target table.
 *
 * @returns Total number of rows parsed.
 */
export async function parseDumpFile(filePath: string, options: ParseOptions): Promise<number> {
	const { tableName, onRow, onProgress, progressInterval = 10000 } = options;

	const prefix = `INSERT INTO \`${tableName}\` VALUES `;
	let totalRows = 0;

	const fileStream = createReadStream(filePath);
	const gunzip = createGunzip();
	const rl = createInterface({
		input: fileStream.pipe(gunzip),
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	for await (const line of rl) {
		if (!line.startsWith(prefix)) continue;

		const rows = parseInsertLine(line, tableName);
		for (const row of rows) {
			onRow?.(row);
			totalRows++;

			if (onProgress && totalRows % progressInterval === 0) {
				onProgress(totalRows);
			}
		}
	}

	return totalRows;
}

/**
 * Non-streaming variant: parse an INSERT line from a plain string.
 * Useful for testing and small data.
 */
export function parseInsertStatement(sql: string, tableName: string): ParsedRow[] {
	const lines = sql.split("\n");
	const allRows: ParsedRow[] = [];
	for (const line of lines) {
		const rows = parseInsertLine(line, tableName);
		allRows.push(...rows);
	}
	return allRows;
}
