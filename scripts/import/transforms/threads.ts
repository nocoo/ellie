/**
 * Threads Table Transform
 *
 * Maps pre_forum_thread to D1 threads table
 */

import { parseMySQLDump, rowsToObjects } from "../parse-dump";

const DUMP_DIR = "reference/db";

interface MySQLThread {
	tid: number;
	fid: number;
	authorid: number;
	author: string;
	subject: string;
	dateline: number;
	lastpost: number;
	lastposter: string;
	replies: number;
	views: number;
	closed: number;
	displayorder: number;
	digest: number;
	special: number;
	highlight: number;
	recommends: number;
	posttableid: number;
	typeid?: number;
}

interface ThreadType {
	typeid: number;
	name: string;
}

interface D1Thread {
	id: number;
	forum_id: number;
	author_id: number;
	author_name: string;
	subject: string;
	created_at: number;
	last_post_at: number;
	last_poster: string;
	replies: number;
	views: number;
	closed: number;
	sticky: number;
	digest: number;
	special: number;
	highlight: number;
	recommends: number;
	post_table_id: number;
	type_name: string;
	last_poster_id: number;
}

/**
 * Transform MySQL threads to D1 format
 */
export async function transformThreads(
	options: { limit?: number; offset?: number } = {},
): Promise<D1Thread[]> {
	const { limit, offset = 0 } = options;

	console.log("  Loading pre_forum_thread...");
	const { columns, rows } = parseMySQLDump(`${DUMP_DIR}/thread.sql.gz`, "pre_forum_thread", {
		limit: limit ? limit + offset : undefined,
		offset,
	});
	const threads = rowsToObjects(columns, rows) as MySQLThread[];
	console.log(`    Found ${threads.length} threads`);

	// Load thread types
	console.log("  Loading pre_forum_threadtype...");
	const { columns: typeCols, rows: typeRows } = parseMySQLDump(
		`${DUMP_DIR}/user_extra.sql.gz`,
		"pre_forum_threadtype",
	);
	const types = rowsToObjects(typeCols, typeRows) as ThreadType[];
	const typeMap = new Map<number, string>();
	for (const t of types) {
		typeMap.set(t.typeid, t.name);
	}
	console.log(`    Found ${typeMap.size} thread types`);

	// Transform
	console.log("  Transforming...");
	const result: D1Thread[] = [];

	for (const thread of threads) {
		result.push({
			id: thread.tid,
			forum_id: thread.fid,
			author_id: thread.authorid,
			author_name: thread.author || "",
			subject: thread.subject || "",
			created_at: thread.dateline || 0,
			last_post_at: thread.lastpost || 0,
			last_poster: thread.lastposter || "",
			replies: thread.replies || 0,
			views: thread.views || 0,
			closed: thread.closed || 0,
			sticky: thread.displayorder || 0,
			digest: thread.digest || 0,
			special: thread.special || 0,
			highlight: thread.highlight || 0,
			recommends: thread.recommends || 0,
			post_table_id: thread.posttableid || 0,
			type_name: thread.typeid ? typeMap.get(thread.typeid) || "" : "",
			last_poster_id: 0, // Will be computed later
		});
	}

	return result;
}

function escapeString(value: string | null | undefined): string {
	if (value === null || value === undefined) {
		return "''";
	}
	const escaped = String(value).replace(/'/g, "''");
	return `'${escaped}'`;
}

/**
 * Generate SQL INSERT statements for threads
 */
export function generateThreadsSQL(threads: D1Thread[]): string[] {
	const statements: string[] = [];

	for (const t of threads) {
		const sql = `INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, replies, views, closed, sticky, digest, special, highlight, recommends, post_table_id, type_name, last_poster_id) VALUES (${t.id}, ${t.forum_id}, ${t.author_id}, ${escapeString(t.author_name)}, ${escapeString(t.subject)}, ${t.created_at}, ${t.last_post_at}, ${escapeString(t.last_poster)}, ${t.replies}, ${t.views}, ${t.closed}, ${t.sticky}, ${t.digest}, ${t.special}, ${t.highlight}, ${t.recommends}, ${t.post_table_id}, ${escapeString(t.type_name)}, ${t.last_poster_id})`;
		statements.push(sql);
	}

	return statements;
}

// CLI for testing
if (import.meta.main) {
	console.log("Transforming threads (limit 100 for testing)...");
	const threads = await transformThreads({ limit: 100 });
	console.log(`\nTransformed ${threads.length} threads`);

	console.log("\nSample (first 3):");
	for (const t of threads.slice(0, 3)) {
		console.log(
			`  [${t.id}] ${t.subject.slice(0, 40)}... (forum=${t.forum_id}, replies=${t.replies})`,
		);
	}
}
