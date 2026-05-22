#!/usr/bin/env bun
/**
 * import-comments.ts — Import post comments from postcomment dump
 *
 * Reads postcomment.sql.gz, extracts comments,
 * generates INSERT statements for D1.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

const COMMENT_DUMP = "reference/db/postcomment.sql.gz";

interface PostComment {
	id: number;
	tid: number;
	pid: number;
	author: string;
	authorid: number;
	dateline: number;
	comment: string;
	score: number;
	useip: string;
	rpid: number;
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

function unescapeSqlString(s: string): string {
	// Remove surrounding quotes
	let result = s.replace(/^'|'$/g, "");
	// Unescape common SQL escapes
	result = result
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\")
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t");
	return result;
}

function escapeSqlString(s: string): string {
	return s.replace(/'/g, "''");
}

async function extractComments(): Promise<PostComment[]> {
	const results: PostComment[] = [];

	const gunzip = createGunzip();
	const input = createReadStream(COMMENT_DUMP).pipe(gunzip);

	const rl = createInterface({ input });

	// Match INSERT INTO `pre_forum_postcomment` VALUES ...
	const insertRegex = /INSERT INTO `pre_forum_postcomment` VALUES/;

	for await (const line of rl) {
		if (!insertRegex.test(line)) continue;

		const valuesMatch = line.match(/VALUES\s*(.+);?$/);
		if (!valuesMatch) continue;

		const valuesStr = valuesMatch[1];
		// Split by "),(" to get individual tuples
		const tuples = valuesStr.split(/\),\s*\(/);

		for (const tuple of tuples) {
			const cleanTuple = tuple.replace(/^\(/, "").replace(/\)$/, "");
			const values = parseSqlValues(cleanTuple);

			// Column order: id, tid, pid, author, authorid, dateline, comment, score, useip, port, rpid
			if (values.length >= 11) {
				const comment: PostComment = {
					id: Number.parseInt(values[0], 10),
					tid: Number.parseInt(values[1], 10),
					pid: Number.parseInt(values[2], 10),
					author: unescapeSqlString(values[3]),
					authorid: Number.parseInt(values[4], 10),
					dateline: Number.parseInt(values[5], 10),
					comment: unescapeSqlString(values[6]),
					score: Number.parseInt(values[7], 10) || 0,
					useip: unescapeSqlString(values[8]),
					rpid: Number.parseInt(values[10], 10) || 0,
				};

				if (comment.id && comment.pid && comment.tid) {
					results.push(comment);
				}
			}
		}
	}

	return results;
}

async function main() {
	console.log("Extracting comments from postcomment dump...");
	const comments = await extractComments();
	console.log(`Found ${comments.length} comments`);

	// Generate SQL file for D1 - batch inserts for efficiency
	const sqlFile = "reference/db/import-comments.sql";
	const batchSize = 100;
	const statements: string[] = [];

	for (let i = 0; i < comments.length; i += batchSize) {
		const batch = comments.slice(i, i + batchSize);
		const values = batch
			.map(
				(c) =>
					`(${c.id}, ${c.tid}, ${c.pid}, ${c.authorid}, '${escapeSqlString(c.author)}', '${escapeSqlString(c.comment)}', ${c.score}, ${c.rpid}, '${escapeSqlString(c.useip)}', ${c.dateline})`,
			)
			.join(",\n");

		statements.push(
			`INSERT INTO post_comments (id, thread_id, post_id, author_id, author_name, content, score, reply_post_id, ip, created_at) VALUES\n${values};`,
		);
	}

	await Bun.write(sqlFile, statements.join("\n\n"));
	console.log(
		`\nGenerated ${sqlFile} with ${statements.length} INSERT statements (batch size: ${batchSize})`,
	);
	console.log("\nTo apply, run:");
	console.log(
		"  cd apps/worker && npx wrangler d1 execute YOUR_D1_DATABASE --remote -c wrangler.toml --file=../../reference/db/import-comments.sql",
	);
}

main().catch(console.error);
