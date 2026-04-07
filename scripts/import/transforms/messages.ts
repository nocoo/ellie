/**
 * Messages Table Transform
 *
 * Maps Discuz PM tables (uc_pm_*) to D1 messages table
 *
 * Source tables:
 * - uc_pm_lists: Conversations (plid = conversation ID, subject)
 * - uc_pm_members: Conversation members (plid, uid)
 * - uc_pm_messages_0~9: Actual messages (pmid, plid, authorid, message, dateline)
 */

import { parseMySQLDump, rowsToObjects } from "../parse-dump";

const DUMP_DIR = "reference/db";

interface MySQLPMList {
	plid: number;
	authorid: number;
	subject: string;
	dateline: number;
}

interface MySQLPMMessage {
	pmid: number;
	plid: number;
	authorid: number;
	message: string;
	dateline: number;
	delstatus: number;
}

interface MySQLPMMember {
	plid: number;
	uid: number;
}

interface D1Message {
	id: number;
	sender_id: number;
	sender_name: string;
	receiver_id: number;
	receiver_name: string;
	subject: string;
	content: string;
	is_read: number;
	sender_deleted: number;
	receiver_deleted: number;
	created_at: number;
}

/**
 * Transform Discuz PM to D1 messages
 *
 * Note: This is a simplified transform. The original system supports
 * multi-member conversations, but we flatten to sender->receiver pairs.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: PM data conversion from Discuz
export async function transformMessages(
	options: { limit?: number; shards?: number[] } = {},
): Promise<D1Message[]> {
	const { limit, shards = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } = options;

	// Load conversation lists
	console.log("  Loading uc_pm_lists...");
	const { columns: listCols, rows: listRows } = parseMySQLDump(
		`${DUMP_DIR}/pm.sql.gz`,
		"uc_pm_lists",
		{ limit: 10000 }, // Load conversations
	);
	const lists = rowsToObjects(listCols, listRows) as MySQLPMList[];
	const listMap = new Map<number, MySQLPMList>();
	for (const l of lists) {
		listMap.set(l.plid, l);
	}
	console.log(`    Loaded ${lists.length} conversations`);

	// Load conversation members
	console.log("  Loading uc_pm_members...");
	const { columns: memberCols, rows: memberRows } = parseMySQLDump(
		`${DUMP_DIR}/pm.sql.gz`,
		"uc_pm_members",
		{ limit: 50000 },
	);
	const members = rowsToObjects(memberCols, memberRows) as MySQLPMMember[];
	// Group members by plid
	const membersByPlid = new Map<number, number[]>();
	for (const m of members) {
		const existing = membersByPlid.get(m.plid) || [];
		existing.push(m.uid);
		membersByPlid.set(m.plid, existing);
	}
	console.log(`    Loaded ${members.length} member records`);

	// Load and transform messages from shards
	const result: D1Message[] = [];
	let collected = 0;
	let nextId = 1;

	for (const shard of shards) {
		if (limit && collected >= limit) break;

		const table = `uc_pm_messages_${shard}`;
		console.log(`  Loading ${table}...`);

		const remainingLimit = limit ? limit - collected : undefined;
		const { columns, rows } = parseMySQLDump(`${DUMP_DIR}/pm.sql.gz`, table, {
			limit: remainingLimit,
		});
		const messages = rowsToObjects(columns, rows) as MySQLPMMessage[];
		console.log(`    Found ${messages.length} messages`);

		for (const msg of messages) {
			if (limit && collected >= limit) break;

			const list = listMap.get(msg.plid);
			const conversationMembers = membersByPlid.get(msg.plid) || [];

			// Find receiver (any member that's not the sender)
			const receiverId = conversationMembers.find((uid) => uid !== msg.authorid) || 0;

			result.push({
				id: nextId++,
				sender_id: msg.authorid,
				sender_name: "", // Would need to join with users table
				receiver_id: receiverId,
				receiver_name: "", // Would need to join with users table
				subject: list?.subject || "",
				content: msg.message || "",
				is_read: 1, // Assume read for historical data
				sender_deleted: msg.delstatus === 1 ? 1 : 0,
				receiver_deleted: msg.delstatus === 2 ? 1 : 0,
				created_at: msg.dateline || 0,
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
 * Generate SQL INSERT statements for messages
 */
export function generateMessagesSQL(messages: D1Message[]): string[] {
	const statements: string[] = [];

	for (const m of messages) {
		const sql = `INSERT INTO messages (id, sender_id, sender_name, receiver_id, receiver_name, subject, content, is_read, sender_deleted, receiver_deleted, created_at) VALUES (${m.id}, ${m.sender_id}, ${escapeString(m.sender_name)}, ${m.receiver_id}, ${escapeString(m.receiver_name)}, ${escapeString(m.subject)}, ${escapeString(m.content)}, ${m.is_read}, ${m.sender_deleted}, ${m.receiver_deleted}, ${m.created_at})`;
		statements.push(sql);
	}

	return statements;
}

// CLI for testing
if (import.meta.main) {
	console.log("Transforming messages (limit 100)...");
	const messages = await transformMessages({ limit: 100, shards: [0] });
	console.log(`\nTransformed ${messages.length} messages`);

	console.log("\nSample (first 3):");
	for (const m of messages.slice(0, 3)) {
		const preview = m.content.slice(0, 50).replace(/\n/g, " ");
		console.log(`  [${m.id}] ${m.sender_id} -> ${m.receiver_id}: ${preview}...`);
	}
}
