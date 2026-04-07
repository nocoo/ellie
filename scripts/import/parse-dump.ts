#!/usr/bin/env bun
/**
 * MySQL Dump Parser
 *
 * Parses MySQL dump files and extracts INSERT statements as JSON rows.
 * Handles:
 * - Gzipped files
 * - Multi-value INSERT statements
 * - Escaped quotes and special characters
 * - MySQL-specific syntax
 *
 * Usage:
 *   bun run scripts/import/parse-dump.ts <dump.sql.gz> <table_name>
 *   bun run scripts/import/parse-dump.ts reference/db/ucenter.sql.gz uc_members --limit 10
 */

import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

interface ParseOptions {
  limit?: number;
  offset?: number;
}

/**
 * Parse a MySQL dump file and extract rows for a specific table
 */
export function parseMySQLDump(
  filePath: string,
  tableName: string,
  options: ParseOptions = {}
): { columns: string[]; rows: unknown[][] } {
  const { limit, offset = 0 } = options;

  // Read file (decompress if gzipped)
  let content: string;
  if (filePath.endsWith(".gz")) {
    const compressed = readFileSync(filePath);
    content = gunzipSync(compressed).toString("utf-8");
  } else {
    content = readFileSync(filePath, "utf-8");
  }

  // Find CREATE TABLE to get column names
  const createTableRegex = new RegExp(
    `CREATE TABLE \`${tableName}\`\\s*\\(([^;]+)\\)`,
    "i"
  );
  const createMatch = content.match(createTableRegex);

  let columns: string[] = [];
  if (createMatch) {
    // Extract column names from CREATE TABLE
    const columnDefs = createMatch[1];
    const columnMatches = columnDefs.matchAll(/`(\w+)`\s+\w+/g);
    for (const match of columnMatches) {
      // Skip if it's a KEY or INDEX definition
      if (
        !match[0].includes("PRIMARY") &&
        !match[0].includes("KEY") &&
        !match[0].includes("INDEX")
      ) {
        columns.push(match[1]);
      }
    }
  }

  // Find INSERT INTO statements for this table
  const insertRegex = new RegExp(
    `INSERT INTO \`${tableName}\` VALUES\\s*(.+?);`,
    "gs"
  );

  const rows: unknown[][] = [];
  let skipped = 0;
  let collected = 0;

  for (const match of content.matchAll(insertRegex)) {
    const valuesStr = match[1];

    // Parse individual row tuples: (val1, val2, ...), (val1, val2, ...)
    const rowMatches = parseValueTuples(valuesStr);

    for (const rowValues of rowMatches) {
      if (offset > 0 && skipped < offset) {
        skipped++;
        continue;
      }

      if (limit && collected >= limit) {
        return { columns, rows };
      }

      rows.push(rowValues);
      collected++;
    }
  }

  return { columns, rows };
}

/**
 * Parse value tuples from INSERT VALUES clause
 * Handles: (1,'text',NULL), (2,'more','data')
 */
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
        // Check for doubled quote (MySQL escape)
        if (valuesStr[i + 1] === stringChar) {
          currentValue += char;
          i++; // Skip next quote
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
        // End of tuple
        current.push(parseValue(currentValue.trim()));
        rows.push(current);
        currentValue = "";
      } else {
        currentValue += char;
      }
      continue;
    }

    if (char === "," && depth === 1) {
      // Value separator within tuple
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

  // Quoted string
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    let str = value.slice(1, -1);
    // Unescape MySQL escapes
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

  // Number
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }

  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }

  // Hex literal
  if (value.startsWith("0x") || value.startsWith("X'")) {
    return value; // Keep as-is for now
  }

  return value;
}

/**
 * Convert parsed rows to objects using column names
 */
export function rowsToObjects(
  columns: string[],
  rows: unknown[][]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

// CLI
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: bun run parse-dump.ts <dump.sql.gz> <table_name> [--limit N] [--offset N] [--json]");
    process.exit(1);
  }

  const filePath = args[0];
  const tableName = args[1];

  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : undefined;

  const offsetIdx = args.indexOf("--offset");
  const offset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1]) : 0;

  const asJson = args.includes("--json");

  console.error(`Parsing ${filePath} for table ${tableName}...`);

  const start = Date.now();
  const { columns, rows } = parseMySQLDump(filePath, tableName, { limit, offset });
  const elapsed = Date.now() - start;

  console.error(`Found ${columns.length} columns, ${rows.length} rows in ${elapsed}ms`);
  console.error(`Columns: ${columns.join(", ")}`);

  if (asJson) {
    const objects = rowsToObjects(columns, rows);
    console.log(JSON.stringify(objects, null, 2));
  } else {
    // Print first few rows as preview
    const preview = rows.slice(0, 5);
    for (const row of preview) {
      console.log(row);
    }
    if (rows.length > 5) {
      console.log(`... and ${rows.length - 5} more rows`);
    }
  }
}
