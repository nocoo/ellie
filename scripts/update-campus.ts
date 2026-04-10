#!/usr/bin/env bun
/**
 * update-campus.ts — Update users.campus from profile dump
 *
 * Reads profile.sql.gz, extracts uid -> field1 mapping,
 * generates UPDATE statements for D1.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

const PROFILE_DUMP = "reference/db/profile.sql.gz";

interface CampusMapping {
	uid: number;
	campus: string;
}

async function extractCampusData(): Promise<CampusMapping[]> {
	const results: CampusMapping[] = [];

	const gunzip = createGunzip();
	const input = createReadStream(PROFILE_DUMP).pipe(gunzip);

	const rl = createInterface({ input });

	// Match INSERT INTO `pre_common_member_profile` VALUES ...
	const insertRegex = /INSERT INTO `pre_common_member_profile` VALUES/;

	for await (const line of rl) {
		if (!insertRegex.test(line)) continue;

		// Extract VALUES tuples: (uid, ..., field1, ...)
		// field1 is at index 42 (0-indexed)
		const valuesMatch = line.match(/VALUES\s*(.+);?$/);
		if (!valuesMatch) continue;

		const valuesStr = valuesMatch[1];
		// Split by "),(" to get individual tuples
		const tuples = valuesStr.split(/\),\s*\(/);

		for (const tuple of tuples) {
			// Clean up tuple
			const cleanTuple = tuple.replace(/^\(/, "").replace(/\)$/, "");

			// Parse values - this is tricky with SQL escaping
			// Simple approach: split by comma, handle quoted strings
			const values = parseSqlValues(cleanTuple);

			if (values.length > 42) {
				const uid = Number.parseInt(values[0], 10);
				const campus = values[42]?.replace(/^'|'$/g, "") || "";

				if (uid && campus) {
					results.push({ uid, campus });
				}
			}
		}
	}

	return results;
}

function parseSqlValues(tuple: string): string[] {
	const values: string[] = [];
	let current = "";
	let inQuote = false;
	let escapeNext = false;

	for (let i = 0; i < tuple.length; i++) {
		const char = tuple[i];

		if (escapeNext) {
			current += char;
			escapeNext = false;
			continue;
		}

		if (char === "\\") {
			escapeNext = true;
			current += char;
			continue;
		}

		if (char === "'" && !escapeNext) {
			inQuote = !inQuote;
			current += char;
			continue;
		}

		if (char === "," && !inQuote) {
			values.push(current.trim());
			current = "";
			continue;
		}

		current += char;
	}

	if (current) {
		values.push(current.trim());
	}

	return values;
}

async function main() {
	console.log("Extracting campus data from profile dump...");
	const mappings = await extractCampusData();
	console.log(`Found ${mappings.length} users with campus data`);

	// Group by campus to show statistics
	const stats = new Map<string, number>();
	for (const m of mappings) {
		stats.set(m.campus, (stats.get(m.campus) || 0) + 1);
	}
	console.log("\nCampus distribution:");
	for (const [campus, count] of Array.from(stats.entries()).sort((a, b) => b[1] - a[1])) {
		console.log(`  ${campus}: ${count}`);
	}

	// Generate SQL file for D1
	const sqlFile = "reference/db/update-campus.sql";
	const statements = mappings.map(
		(m) => `UPDATE users SET campus = '${m.campus.replace(/'/g, "''")}' WHERE id = ${m.uid};`,
	);

	await Bun.write(sqlFile, statements.join("\n"));
	console.log(`\nGenerated ${sqlFile} with ${statements.length} UPDATE statements`);
	console.log("\nTo apply, run:");
	console.log(
		"  cd apps/worker && cat ../../reference/db/update-campus.sql | npx wrangler d1 execute tongjinet-db --remote -c wrangler.toml --file=-",
	);
}

main().catch(console.error);
