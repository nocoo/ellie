/**
 * Attachments Table Transform
 *
 * Maps pre_forum_attachment_0~9 to D1 attachments table
 */

import { parseMySQLDump, rowsToObjects } from "../parse-dump";

const DUMP_DIR = "reference/db";

interface MySQLAttachment {
	aid: number;
	tid: number;
	pid: number;
	uid: number;
	dateline: number;
	filename: string;
	filesize: number;
	attachment: string;
	isimage: number;
	width: number;
	thumb: number;
}

interface D1Attachment {
	id: number;
	thread_id: number;
	post_id: number;
	author_id: number;
	filename: string;
	file_path: string;
	file_size: number;
	is_image: number;
	width: number;
	has_thumb: number;
	downloads: number;
	created_at: number;
}

/**
 * Transform MySQL attachments to D1 format
 */
export async function transformAttachments(
	options: { limit?: number; shards?: number[] } = {},
): Promise<D1Attachment[]> {
	const { limit, shards = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } = options;

	const result: D1Attachment[] = [];
	let collected = 0;

	for (const shard of shards) {
		if (limit && collected >= limit) break;

		const table = `pre_forum_attachment_${shard}`;
		console.log(`  Loading ${table}...`);

		const remainingLimit = limit ? limit - collected : undefined;
		const { columns, rows } = parseMySQLDump(`${DUMP_DIR}/main_small.sql.gz`, table, {
			limit: remainingLimit,
		});
		const attachments = rowsToObjects(columns, rows) as MySQLAttachment[];
		console.log(`    Found ${attachments.length} attachments`);

		for (const att of attachments) {
			if (limit && collected >= limit) break;

			result.push({
				id: att.aid,
				thread_id: att.tid,
				post_id: att.pid,
				author_id: att.uid,
				filename: att.filename || "",
				file_path: att.attachment || "",
				file_size: att.filesize || 0,
				is_image: att.isimage || 0,
				width: att.width || 0,
				has_thumb: att.thumb || 0,
				downloads: 0, // Not in source data
				created_at: att.dateline || 0,
			});
			collected++;
		}
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
 * Generate SQL INSERT statements for attachments
 */
export function generateAttachmentsSQL(attachments: D1Attachment[]): string[] {
	const statements: string[] = [];

	for (const a of attachments) {
		const sql = `INSERT INTO attachments (id, thread_id, post_id, author_id, filename, file_path, file_size, is_image, width, has_thumb, downloads, created_at) VALUES (${a.id}, ${a.thread_id}, ${a.post_id}, ${a.author_id}, ${escapeString(a.filename)}, ${escapeString(a.file_path)}, ${a.file_size}, ${a.is_image}, ${a.width}, ${a.has_thumb}, ${a.downloads}, ${a.created_at})`;
		statements.push(sql);
	}

	return statements;
}

// CLI for testing
if (import.meta.main) {
	console.log("Transforming attachments (limit 100)...");
	const attachments = await transformAttachments({ limit: 100, shards: [0] });
	console.log(`\nTransformed ${attachments.length} attachments`);

	console.log("\nSample (first 3):");
	for (const a of attachments.slice(0, 3)) {
		console.log(`  [${a.id}] thread=${a.thread_id}, post=${a.post_id}: ${a.filename}`);
	}
}
