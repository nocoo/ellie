/**
 * Table extractors — transform raw parsed rows from SQL dumps into D1 row records.
 *
 * Each extractor maps Discuz source columns to Ellie D1 columns,
 * applying filters and transformations per docs/02-database-schema.md and 03-migration.md.
 */

import type { RowRecord } from "../load/batch-insert";
import { getAvatarValue } from "../transform/avatar";
import { bbcodeToHtml } from "../transform/bbcode";
import { validateEncoding } from "../transform/encoding";
import { mapPassword } from "../transform/password";
import type { ParsedRow } from "./parser";

// ─── Forums ────────────────────────────────────────────────────────────────────

/**
 * Source columns for pre_forum_forum (from main_small dump):
 * fid, fup, name, type, status, displayorder, threads, posts, lastpost, ...
 *
 * We also need pre_forum_forumfield for description and icon.
 * Since we're parsing SQL dumps (not live queries), we handle the two tables
 * separately and join in the orchestrator.
 */

/** Column indices for pre_forum_forum INSERT VALUES. */
const FORUM_COLS = {
	fid: 0,
	fup: 1,
	name: 2,
	type: 7,
	status: 3,
	displayorder: 4,
	threads: 5,
	posts: 6,
	lastpost: 8,
} as const;

/**
 * Parse the DZ lastpost field: "tid\tsubject\ttimestamp\tposter"
 */
export function parseLastPost(lastpost: string | null): {
	lastThreadId: number;
	lastPostAt: number;
	lastPoster: string;
} {
	if (!lastpost) return { lastThreadId: 0, lastPostAt: 0, lastPoster: "" };

	const parts = lastpost.split("\t");
	return {
		lastThreadId: Number.parseInt(parts[0] ?? "0", 10) || 0,
		lastPostAt: Number.parseInt(parts[2] ?? "0", 10) || 0,
		lastPoster: parts[3] ?? "",
	};
}

/**
 * Extract a forum row. Returns null if filtered out (status != 1).
 */
export function extractForum(
	row: ParsedRow,
	forumFields: Map<number, { description: string; icon: string }>,
): RowRecord | null {
	const status = Number(row[FORUM_COLS.status]);
	if (status !== 1) return null; // Filter hidden forums

	const fid = Number(row[FORUM_COLS.fid]);
	const lastpost = parseLastPost(row[FORUM_COLS.lastpost] ?? null);
	const fields = forumFields.get(fid);

	return {
		id: fid,
		parent_id: Number(row[FORUM_COLS.fup]) || 0,
		name: row[FORUM_COLS.name] ?? "",
		description: fields?.description ?? "",
		icon: fields?.icon ?? "",
		display_order: Number(row[FORUM_COLS.displayorder]) || 0,
		threads: Number(row[FORUM_COLS.threads]) || 0,
		posts: Number(row[FORUM_COLS.posts]) || 0,
		type: row[FORUM_COLS.type] ?? "forum",
		status: 1,
		last_thread_id: lastpost.lastThreadId,
		last_post_at: lastpost.lastPostAt,
		last_poster: lastpost.lastPoster,
	};
}

// ─── Users ─────────────────────────────────────────────────────────────────────

/** Column indices for uc_members INSERT VALUES. */
const UC_MEMBER_COLS = {
	uid: 0,
	username: 1,
	password: 2,
	salt: 3,
	email: 4,
	lastlogintime: 8,
} as const;

/** Column indices for pre_common_member INSERT VALUES. */
const MEMBER_COLS = {
	uid: 0,
	status: 4,
	avatarstatus: 6,
	adminid: 8,
	regdate: 12,
	credits: 13,
	freeze: 22,
} as const;

/** Column indices for pre_common_member_count INSERT VALUES. */
const MEMBER_COUNT_COLS = {
	uid: 0,
	threads: 2,
	posts: 3,
} as const;

/** Data from pre_common_member or pre_common_member_archive for one user. */
export interface MemberData {
	status: number;
	avatarstatus: number;
	adminid: number;
	regdate: number;
	credits: number;
	freeze: number;
}

/** Data from pre_common_member_count for one user. */
export interface MemberCountData {
	threads: number;
	posts: number;
}

/** Parse a pre_common_member row into MemberData. */
export function parseMemberRow(row: ParsedRow): { uid: number; data: MemberData } {
	return {
		uid: Number(row[MEMBER_COLS.uid]),
		data: {
			status: Number(row[MEMBER_COLS.status]) || 0,
			avatarstatus: Number(row[MEMBER_COLS.avatarstatus]) || 0,
			adminid: Number(row[MEMBER_COLS.adminid]) || 0,
			regdate: Number(row[MEMBER_COLS.regdate]) || 0,
			credits: Number(row[MEMBER_COLS.credits]) || 0,
			freeze: Number(row[MEMBER_COLS.freeze]) || 0,
		},
	};
}

/** Parse a pre_common_member_count row. */
export function parseMemberCountRow(row: ParsedRow): { uid: number; data: MemberCountData } {
	return {
		uid: Number(row[MEMBER_COUNT_COLS.uid]),
		data: {
			threads: Number(row[MEMBER_COUNT_COLS.threads]) || 0,
			posts: Number(row[MEMBER_COUNT_COLS.posts]) || 0,
		},
	};
}

/**
 * Build a user row from uc_members + optional member data + optional count data.
 *
 * For active users: member data comes from pre_common_member.
 * For archived users: member data comes from pre_common_member_archive, status forced to -2.
 */
export function extractUser(
	ucRow: ParsedRow,
	member: MemberData | null,
	counts: MemberCountData | null,
	isArchived: boolean,
): RowRecord {
	const uid = Number(ucRow[UC_MEMBER_COLS.uid]);
	const pw = mapPassword({
		hash: ucRow[UC_MEMBER_COLS.password] ?? "",
		salt: ucRow[UC_MEMBER_COLS.salt] ?? "",
	});

	let status = 0;
	if (isArchived) {
		status = -2;
	} else if (member) {
		status = member.freeze === 1 ? -1 : (member.status ?? 0);
	}

	return {
		id: uid,
		username: ucRow[UC_MEMBER_COLS.username] ?? "",
		email: ucRow[UC_MEMBER_COLS.email] ?? "",
		password_hash: pw.passwordHash,
		password_salt: pw.passwordSalt,
		avatar: member ? getAvatarValue(uid, member.avatarstatus) : "",
		status,
		role: member?.adminid ?? 0,
		reg_date: member?.regdate ?? 0,
		last_login: Number(ucRow[UC_MEMBER_COLS.lastlogintime]) || 0,
		threads: counts?.threads ?? 0,
		posts: counts?.posts ?? 0,
		credits: member?.credits ?? 0,
	};
}

// ─── Threads ───────────────────────────────────────────────────────────────────

/** Column indices for pre_forum_thread INSERT VALUES. */
const THREAD_COLS = {
	tid: 0,
	fid: 1,
	posttableid: 2,
	authorid: 4,
	author: 5,
	subject: 6,
	dateline: 7,
	lastpost: 8,
	lastposter: 9,
	views: 10,
	replies: 11,
	displayorder: 12,
	digest: 14,
	closed: 15,
	special: 17,
	highlight: 19,
	recommend_add: 21,
	recommend_sub: 22,
} as const;

/**
 * Extract a thread row. Returns null if filtered out.
 * Filters: displayorder >= 0 (visible) AND closed <= 1 (skip merged).
 */
export function extractThread(row: ParsedRow): RowRecord | null {
	const displayorder = Number(row[THREAD_COLS.displayorder]) || 0;
	if (displayorder < 0) return null; // Hidden thread

	const closed = Number(row[THREAD_COLS.closed]) || 0;
	if (closed > 1) return null; // Merged thread — skip per migration decision

	const recommendAdd = Number(row[THREAD_COLS.recommend_add]) || 0;
	const recommendSub = Number(row[THREAD_COLS.recommend_sub]) || 0;

	return {
		id: Number(row[THREAD_COLS.tid]),
		forum_id: Number(row[THREAD_COLS.fid]),
		author_id: Number(row[THREAD_COLS.authorid]),
		author_name: row[THREAD_COLS.author] ?? "",
		subject: row[THREAD_COLS.subject] ?? "",
		created_at: Number(row[THREAD_COLS.dateline]) || 0,
		last_post_at: Number(row[THREAD_COLS.lastpost]) || 0,
		last_poster: row[THREAD_COLS.lastposter] ?? "",
		replies: Number(row[THREAD_COLS.replies]) || 0,
		views: Number(row[THREAD_COLS.views]) || 0,
		closed,
		sticky: displayorder, // displayorder maps to sticky
		digest: Number(row[THREAD_COLS.digest]) || 0,
		special: Number(row[THREAD_COLS.special]) || 0,
		highlight: Number(row[THREAD_COLS.highlight]) || 0,
		recommends: recommendAdd - recommendSub,
		post_table_id: Number(row[THREAD_COLS.posttableid]) || 0,
	};
}

// ─── Posts ──────────────────────────────────────────────────────────────────────

/** Column indices for pre_forum_post INSERT VALUES. */
const POST_COLS = {
	pid: 0,
	fid: 1,
	tid: 2,
	first: 3,
	author: 4,
	authorid: 5,
	dateline: 7,
	message: 8,
	invisible: 12,
	position: 16,
	bbcodeoff: 19,
	htmlon: 22,
} as const;

/** Stats tracked during post extraction. */
export interface PostExtractionStats {
	total: number;
	filtered: number;
	encodingRepaired: number;
	bbcodeFailures: number;
}

/**
 * Extract a post row. Returns null if filtered out (invisible != 0).
 */
export function extractPost(row: ParsedRow, stats?: PostExtractionStats): RowRecord | null {
	const invisible = Number(row[POST_COLS.invisible]) || 0;
	if (invisible !== 0) {
		if (stats) stats.filtered++;
		return null;
	}

	const message = row[POST_COLS.message] ?? "";
	const bbcodeoff = Number(row[POST_COLS.bbcodeoff]) === 1;
	const htmlon = Number(row[POST_COLS.htmlon]) === 1;

	// Encoding validation
	const { text: cleanMessage, repaired } = validateEncoding(message);
	if (repaired && stats) stats.encodingRepaired++;

	// BBCode → HTML conversion
	let content: string;
	try {
		content = bbcodeToHtml(cleanMessage, { bbcodeoff, htmlon });
	} catch {
		// BBCode parse failure — keep original text
		content = cleanMessage;
		if (stats) stats.bbcodeFailures++;
	}

	if (stats) stats.total++;

	return {
		id: Number(row[POST_COLS.pid]),
		thread_id: Number(row[POST_COLS.tid]),
		forum_id: Number(row[POST_COLS.fid]),
		author_id: Number(row[POST_COLS.authorid]),
		author_name: row[POST_COLS.author] ?? "",
		content,
		created_at: Number(row[POST_COLS.dateline]) || 0,
		is_first: Number(row[POST_COLS.first]) || 0,
		position: Number(row[POST_COLS.position]) || 0,
	};
}

// ─── Attachments ───────────────────────────────────────────────────────────────

/** Column indices for pre_forum_attachment (index table) INSERT VALUES. */
const ATTACH_INDEX_COLS = {
	aid: 0,
	tid: 1,
	pid: 2,
	uid: 3,
	tableid: 4,
	downloads: 5,
} as const;

/** Column indices for pre_forum_attachment_N (shard table) INSERT VALUES. */
const ATTACH_SHARD_COLS = {
	aid: 0,
	tid: 1,
	pid: 2,
	uid: 3,
	dateline: 4,
	filename: 5,
	filesize: 6,
	attachment: 7,
	isimage: 10,
	width: 12,
	thumb: 13,
} as const;

/** Data from the attachment index table. */
export interface AttachmentIndexData {
	aid: number;
	tid: number;
	pid: number;
	uid: number;
	tableid: number;
	downloads: number;
}

/** Parse attachment index table row. */
export function parseAttachmentIndex(row: ParsedRow): AttachmentIndexData {
	return {
		aid: Number(row[ATTACH_INDEX_COLS.aid]),
		tid: Number(row[ATTACH_INDEX_COLS.tid]),
		pid: Number(row[ATTACH_INDEX_COLS.pid]),
		uid: Number(row[ATTACH_INDEX_COLS.uid]),
		tableid: Number(row[ATTACH_INDEX_COLS.tableid]),
		downloads: Number(row[ATTACH_INDEX_COLS.downloads]) || 0,
	};
}

/**
 * Extract an attachment row by joining index data with shard data.
 */
export function extractAttachment(
	shardRow: ParsedRow,
	indexData: Map<number, AttachmentIndexData>,
): RowRecord | null {
	const aid = Number(shardRow[ATTACH_SHARD_COLS.aid]);
	const idx = indexData.get(aid);
	if (!idx) return null; // No matching index entry

	const attachmentPath = shardRow[ATTACH_SHARD_COLS.attachment] ?? "";
	// Convert DZ relative path to R2 object key
	const r2Key = attachmentPath ? `attachments/${attachmentPath}` : "";

	return {
		id: aid,
		thread_id: Number(shardRow[ATTACH_SHARD_COLS.tid]),
		post_id: Number(shardRow[ATTACH_SHARD_COLS.pid]),
		author_id: Number(shardRow[ATTACH_SHARD_COLS.uid]),
		filename: shardRow[ATTACH_SHARD_COLS.filename] ?? "",
		file_path: r2Key,
		file_size: Number(shardRow[ATTACH_SHARD_COLS.filesize]) || 0,
		is_image: Number(shardRow[ATTACH_SHARD_COLS.isimage]) || 0,
		width: Number(shardRow[ATTACH_SHARD_COLS.width]) || 0,
		has_thumb: Number(shardRow[ATTACH_SHARD_COLS.thumb]) || 0,
		downloads: idx.downloads,
		created_at: Number(shardRow[ATTACH_SHARD_COLS.dateline]) || 0,
	};
}
