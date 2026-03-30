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
 * fid, fup, type, name, status, displayorder, styleid, threads, posts,
 * todayposts, yesterdayposts, rank, oldrank, lastpost, ...
 *
 * Verified against CREATE TABLE in main_small.sql.gz.
 *
 * We also need pre_forum_forumfield for description and icon.
 * Since we're parsing SQL dumps (not live queries), we handle the two tables
 * separately and join in the orchestrator.
 */

/** Column indices for pre_forum_forum INSERT VALUES (verified from dump DDL). */
const FORUM_COLS = {
	fid: 0,
	fup: 1,
	type: 2,
	name: 3,
	status: 4,
	displayorder: 5,
	// styleid: 6,
	threads: 7,
	posts: 8,
	// todayposts: 9, yesterdayposts: 10, rank: 11, oldrank: 12,
	lastpost: 13,
} as const;

/**
 * Parse the DZ lastpost field: "tid\tsubject\ttimestamp\tposter"
 */
export function parseLastPost(lastpost: string | null): {
	lastThreadId: number;
	lastPostAt: number;
	lastPoster: string;
	lastThreadSubject: string;
} {
	if (!lastpost) return { lastThreadId: 0, lastPostAt: 0, lastPoster: "", lastThreadSubject: "" };

	const parts = lastpost.split("\t");
	return {
		lastThreadId: Number.parseInt(parts[0] ?? "0", 10) || 0,
		lastThreadSubject: parts[1] ?? "",
		lastPostAt: Number.parseInt(parts[2] ?? "0", 10) || 0,
		lastPoster: parts[3] ?? "",
	};
}

/**
 * Extract a forum row. All forums are migrated (status passed through).
 * Returns null only for the undefined/corrupt row edge case.
 */
export function extractForum(
	row: ParsedRow,
	forumFields: Map<number, { description: string; icon: string }>,
): RowRecord | null {
	const fid = Number(row[FORUM_COLS.fid]);
	if (!fid) return null; // Skip corrupt/undefined rows

	const status = Number(row[FORUM_COLS.status]) || 0;
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
		status,
		last_thread_id: lastpost.lastThreadId,
		last_post_at: lastpost.lastPostAt,
		last_poster: lastpost.lastPoster,
		last_thread_subject: lastpost.lastThreadSubject,
	};
}

// ─── Users ─────────────────────────────────────────────────────────────────────

/**
 * Column indices for uc_members INSERT VALUES (verified from dump DDL).
 *
 * uid, username, password, email, myid, myidkey, regip, regdate,
 * lastloginip, lastlogintime, salt, secques
 */
const UC_MEMBER_COLS = {
	uid: 0,
	username: 1,
	password: 2,
	email: 3,
	// myid: 4, myidkey: 5, regip: 6, regdate: 7, lastloginip: 8,
	lastlogintime: 9,
	salt: 10,
	// secques: 11,
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

/**
 * Column indices for pre_forum_thread INSERT VALUES (verified from dump DDL).
 *
 * tid, fid, posttableid, typeid, sortid, readperm, price, author, authorid,
 * subject, dateline, lastpost, lastposter, views, replies, displayorder,
 * highlight, digest, rate, special, attachment, moderated, closed, stickreply,
 * recommends, recommend_add, recommend_sub, ...
 */
const THREAD_COLS = {
	tid: 0,
	fid: 1,
	posttableid: 2,
	// typeid: 3, sortid: 4, readperm: 5, price: 6,
	author: 7,
	authorid: 8,
	subject: 9,
	dateline: 10,
	lastpost: 11,
	lastposter: 12,
	views: 13,
	replies: 14,
	displayorder: 15,
	highlight: 16,
	digest: 17,
	// rate: 18,
	special: 19,
	// attachment: 20, moderated: 21,
	closed: 22,
	// stickreply: 23, recommends: 24,
	recommend_add: 25,
	recommend_sub: 26,
} as const;

/**
 * Extract a thread row. All threads are migrated (status passed through).
 */
export function extractThread(row: ParsedRow): RowRecord | null {
	const tid = Number(row[THREAD_COLS.tid]);
	if (!tid) return null; // Skip corrupt rows

	const displayorder = Number(row[THREAD_COLS.displayorder]) || 0;
	const closed = Number(row[THREAD_COLS.closed]) || 0;
	const recommendAdd = Number(row[THREAD_COLS.recommend_add]) || 0;
	const recommendSub = Number(row[THREAD_COLS.recommend_sub]) || 0;

	return {
		id: tid,
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

/**
 * Column indices for pre_forum_post INSERT VALUES (verified from dump DDL).
 *
 * pid, fid, tid, first, author, authorid, subject, dateline, message,
 * useip, port, invisible, anonymous, usesig, htmlon, bbcodeoff,
 * smileyoff, parseurloff, attachment, rate, ratetimes, status,
 * tags, comment, replycredit, position
 */
const POST_COLS = {
	pid: 0,
	fid: 1,
	tid: 2,
	first: 3,
	author: 4,
	authorid: 5,
	// subject: 6,
	dateline: 7,
	message: 8,
	// useip: 9, port: 10,
	invisible: 11,
	// anonymous: 12, usesig: 13,
	htmlon: 14,
	bbcodeoff: 15,
	// smileyoff: 16, parseurloff: 17, attachment: 18,
	// rate: 19, ratetimes: 20, status: 21, tags: 22, comment: 23, replycredit: 24,
	position: 25,
} as const;

/** Stats tracked during post extraction. */
export interface PostExtractionStats {
	total: number;
	filtered: number;
	encodingRepaired: number;
	bbcodeFailures: number;
	/** Called when BBCode conversion fails for a post. */
	onBbcodeFailure?: (pid: number, error: string) => void;
	/** Called when encoding repair is applied to a post. */
	onEncodingFailure?: (pid: number, issue: string) => void;
}

/**
 * Extract a post row. All posts are migrated (invisible status passed through).
 */
export function extractPost(row: ParsedRow, stats?: PostExtractionStats): RowRecord | null {
	const pid = Number(row[POST_COLS.pid]);
	if (!pid) return null; // Skip corrupt rows

	const invisible = Number(row[POST_COLS.invisible]) || 0;
	const message = row[POST_COLS.message] ?? "";
	const bbcodeoff = Number(row[POST_COLS.bbcodeoff]) === 1;
	const htmlon = Number(row[POST_COLS.htmlon]) === 1;

	// Encoding validation
	const { text: cleanMessage, repaired } = validateEncoding(message);
	if (repaired) {
		if (stats) stats.encodingRepaired++;
		stats?.onEncodingFailure?.(pid, "encoding repaired from GBK mojibake");
	}

	// BBCode → HTML conversion
	let content: string;
	try {
		content = bbcodeToHtml(cleanMessage, { bbcodeoff, htmlon });
	} catch (err) {
		// BBCode parse failure — keep original text
		content = cleanMessage;
		if (stats) stats.bbcodeFailures++;
		const errMsg = err instanceof Error ? err.message : String(err);
		stats?.onBbcodeFailure?.(pid, errMsg);
	}

	if (stats) stats.total++;

	return {
		id: pid,
		thread_id: Number(row[POST_COLS.tid]),
		forum_id: Number(row[POST_COLS.fid]),
		author_id: Number(row[POST_COLS.authorid]),
		author_name: row[POST_COLS.author] ?? "",
		content,
		created_at: Number(row[POST_COLS.dateline]) || 0,
		is_first: Number(row[POST_COLS.first]) || 0,
		position: Number(row[POST_COLS.position]) || 0,
		invisible,
	};
}

// ─── Attachments ───────────────────────────────────────────────────────────────

/**
 * Column indices for pre_forum_attachment (index table) INSERT VALUES.
 * Verified from dump DDL: aid, tid, pid, downloads, uid, tableid
 */
const ATTACH_INDEX_COLS = {
	aid: 0,
	tid: 1,
	pid: 2,
	downloads: 3,
	uid: 4,
	tableid: 5,
} as const;

/**
 * Column indices for pre_forum_attachment_N (shard table) INSERT VALUES.
 * Verified from dump DDL: aid, tid, pid, uid, dateline, filename, filesize,
 * attachment, remote, description, readperm, price, isimage, width, thumb, picid, sha1
 */
const ATTACH_SHARD_COLS = {
	aid: 0,
	tid: 1,
	pid: 2,
	uid: 3,
	dateline: 4,
	filename: 5,
	filesize: 6,
	attachment: 7,
	// remote: 8, description: 9, readperm: 10, price: 11,
	isimage: 12,
	width: 13,
	thumb: 14,
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
