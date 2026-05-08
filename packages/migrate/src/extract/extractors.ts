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
	forumFields: Map<number, { description: string; icon: string; moderators: string }>,
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
		moderators: fields?.moderators ?? "",
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
	groupid: 9,
	regdate: 12,
	credits: 13,
	freeze: 22,
} as const;

/** Column indices for pre_common_member_count INSERT VALUES (verified from user_extra dump DDL). */
const MEMBER_COUNT_COLS = {
	uid: 0,
	extcredits1: 1, // "积分" — should equal pre_common_member.credits; kept for validation
	extcredits2: 2, // "同钱" — forum currency (coins), awarded by sign-in etc.
	posts: 10,
	threads: 11,
	digestposts: 12,
	oltime: 19,
} as const;

/** Column indices for pre_common_member_field_forum INSERT VALUES. */
const MEMBER_FIELD_FORUM_COLS = {
	uid: 0,
	customstatus: 3,
	sightml: 5,
} as const;

/** Column indices for pre_common_member_profile INSERT VALUES. */
const PROFILE_COLS = {
	uid: 0,
	gender: 2,
	birthyear: 3,
	birthmonth: 4,
	birthday: 5,
	resideprovince: 17,
	residecity: 18,
	graduateschool: 22,
	qq: 35,
	site: 39,
	bio: 40,
	interest: 41,
	field1: 42, // Campus (所在校区)
} as const;

/** Column indices for pre_common_member_status INSERT VALUES. */
const STATUS_COLS = {
	uid: 0,
	regip: 1,
	lastip: 2,
	lastactivity: 5,
} as const;

/** Column indices for pre_common_usergroup INSERT VALUES. */
const USERGROUP_COLS = {
	groupid: 0,
	grouptitle: 4,
	stars: 7,
	color: 8,
} as const;

/** Column indices for pre_forum_threadtype INSERT VALUES. */
const THREADTYPE_COLS = {
	typeid: 0,
	name: 3,
} as const;

/** Data from pre_common_member or pre_common_member_archive for one user. */
export interface MemberData {
	status: number;
	avatarstatus: number;
	adminid: number;
	groupid: number;
	regdate: number;
	credits: number;
	freeze: number;
}

/** Data from pre_common_member_count for one user. */
export interface MemberCountData {
	threads: number;
	posts: number;
	digestposts: number;
	oltime: number;
	extcredits1: number; // "积分" — for validation against credits
	extcredits2: number; // "同钱" (coins)
}

/** Data from pre_common_member_field_forum for one user. */
export interface MemberFieldForumData {
	customstatus: string;
	sightml: string;
}

/** Data from pre_common_member_profile for one user. */
export interface ProfileData {
	gender: number;
	birthyear: number;
	birthmonth: number;
	birthday: number;
	resideprovince: string;
	residecity: string;
	graduateschool: string;
	bio: string;
	interest: string;
	qq: string;
	site: string;
	campus: string;
}

/** Data from pre_common_member_status for one user. */
export interface StatusData {
	lastactivity: number;
	regip: string;
	lastip: string;
}

/** Data from pre_common_usergroup for one group. */
export interface UsergroupData {
	grouptitle: string;
	stars: number;
	color: string;
}

/** Parse a pre_common_member row into MemberData. */
export function parseMemberRow(row: ParsedRow): { uid: number; data: MemberData } {
	return {
		uid: Number(row[MEMBER_COLS.uid]),
		data: {
			status: Number(row[MEMBER_COLS.status]) || 0,
			avatarstatus: Number(row[MEMBER_COLS.avatarstatus]) || 0,
			adminid: Number(row[MEMBER_COLS.adminid]) || 0,
			groupid: Number(row[MEMBER_COLS.groupid]) || 0,
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
			digestposts: Number(row[MEMBER_COUNT_COLS.digestposts]) || 0,
			oltime: Number(row[MEMBER_COUNT_COLS.oltime]) || 0,
			extcredits1: Number(row[MEMBER_COUNT_COLS.extcredits1]) || 0,
			extcredits2: Number(row[MEMBER_COUNT_COLS.extcredits2]) || 0,
		},
	};
}

/** Parse a pre_common_member_field_forum row. */
export function parseMemberFieldForumRow(row: ParsedRow): {
	uid: number;
	data: MemberFieldForumData;
} {
	return {
		uid: Number(row[MEMBER_FIELD_FORUM_COLS.uid]),
		data: {
			customstatus: row[MEMBER_FIELD_FORUM_COLS.customstatus] ?? "",
			sightml: row[MEMBER_FIELD_FORUM_COLS.sightml] ?? "",
		},
	};
}

/** Parse a pre_common_member_profile row. */
export function parseProfileRow(row: ParsedRow): { uid: number; data: ProfileData } {
	return {
		uid: Number(row[PROFILE_COLS.uid]),
		data: {
			gender: Number(row[PROFILE_COLS.gender]) || 0,
			birthyear: Number(row[PROFILE_COLS.birthyear]) || 0,
			birthmonth: Number(row[PROFILE_COLS.birthmonth]) || 0,
			birthday: Number(row[PROFILE_COLS.birthday]) || 0,
			resideprovince: row[PROFILE_COLS.resideprovince] ?? "",
			residecity: row[PROFILE_COLS.residecity] ?? "",
			graduateschool: row[PROFILE_COLS.graduateschool] ?? "",
			bio: row[PROFILE_COLS.bio] ?? "",
			interest: row[PROFILE_COLS.interest] ?? "",
			qq: row[PROFILE_COLS.qq] ?? "",
			site: row[PROFILE_COLS.site] ?? "",
			campus: row[PROFILE_COLS.field1] ?? "",
		},
	};
}

/** Parse a pre_common_member_status row. */
export function parseStatusRow(row: ParsedRow): { uid: number; data: StatusData } {
	return {
		uid: Number(row[STATUS_COLS.uid]),
		data: {
			lastactivity: Number(row[STATUS_COLS.lastactivity]) || 0,
			regip: row[STATUS_COLS.regip] ?? "",
			lastip: row[STATUS_COLS.lastip] ?? "",
		},
	};
}

/** Parse a pre_common_usergroup row. */
export function parseUsergroupRow(row: ParsedRow): { groupid: number; data: UsergroupData } {
	return {
		groupid: Number(row[USERGROUP_COLS.groupid]),
		data: {
			grouptitle: row[USERGROUP_COLS.grouptitle] ?? "",
			stars: Number(row[USERGROUP_COLS.stars]) || 0,
			color: row[USERGROUP_COLS.color] ?? "",
		},
	};
}

/** Parse a pre_forum_threadtype row. */
export function parseThreadTypeRow(row: ParsedRow): { typeid: number; name: string } {
	return {
		typeid: Number(row[THREADTYPE_COLS.typeid]),
		name: row[THREADTYPE_COLS.name] ?? "",
	};
}

/** Compute user status from member data and archive flag. */
function computeUserStatus(member: MemberData | null, isArchived: boolean): number {
	if (isArchived) return -2;
	if (!member) return 0;
	return member.freeze === 1 ? -1 : (member.status ?? 0);
}

/** Build profile fields from optional ProfileData. */
function buildProfileFields(prof: ProfileData | null | undefined): Record<string, unknown> {
	return {
		gender: prof?.gender ?? 0,
		birth_year: prof?.birthyear ?? 0,
		birth_month: prof?.birthmonth ?? 0,
		birth_day: prof?.birthday ?? 0,
		reside_province: prof?.resideprovince ?? "",
		reside_city: prof?.residecity ?? "",
		graduate_school: prof?.graduateschool ?? "",
		bio: prof?.bio ?? "",
		interest: prof?.interest ?? "",
		qq: prof?.qq ?? "",
		site: prof?.site ?? "",
		campus: prof?.campus ?? "",
	};
}

/**
 * Build a user row from uc_members + optional member data + optional count data
 * + optional field_forum/profile/status/usergroup data.
 *
 * For active users: member data comes from pre_common_member.
 * For archived users: member data comes from pre_common_member_archive, status forced to -2.
 */
export function extractUser(
	ucRow: ParsedRow,
	member: MemberData | null,
	counts: MemberCountData | null,
	isArchived: boolean,
	extras?: {
		fieldForum?: MemberFieldForumData | null;
		profile?: ProfileData | null;
		status?: StatusData | null;
		usergroup?: UsergroupData | null;
	},
): RowRecord {
	const uid = Number(ucRow[UC_MEMBER_COLS.uid]);
	const pw = mapPassword({
		hash: ucRow[UC_MEMBER_COLS.password] ?? "",
		salt: ucRow[UC_MEMBER_COLS.salt] ?? "",
	});

	const ff = extras?.fieldForum;
	const ug = extras?.usergroup;

	return {
		id: uid,
		username: ucRow[UC_MEMBER_COLS.username] ?? "",
		// Legacy contact emails are unverified; users must re-add email after verification.
		email: "",
		password_hash: pw.passwordHash,
		password_salt: pw.passwordSalt,
		avatar: member ? getAvatarValue(uid, member.avatarstatus) : "",
		has_avatar: member && member.avatarstatus > 0 ? 1 : 0,
		status: computeUserStatus(member, isArchived),
		role: member?.adminid ?? 0,
		reg_date: member?.regdate ?? 0,
		last_login: Number(ucRow[UC_MEMBER_COLS.lastlogintime]) || 0,
		threads: counts?.threads ?? 0,
		posts: counts?.posts ?? 0,
		credits: member?.credits ?? 0,
		coins: counts?.extcredits2 ?? 0,
		signature: ff?.sightml ?? "",
		group_title: ug?.grouptitle ?? "",
		group_stars: ug?.stars ?? 0,
		group_color: ug?.color ?? "",
		custom_title: ff?.customstatus ?? "",
		digest_posts: counts?.digestposts ?? 0,
		ol_time: counts?.oltime ?? 0,
		...buildProfileFields(extras?.profile),
		last_activity: extras?.status?.lastactivity ?? 0,
		reg_ip: extras?.status?.regip ?? "",
		last_ip: extras?.status?.lastip ?? "",
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
	typeid: 3,
	// sortid: 4, readperm: 5, price: 6,
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
 * Optionally resolves typeid → type_name via threadTypeMap.
 */
export function extractThread(
	row: ParsedRow,
	threadTypeMap?: Map<number, string>,
): RowRecord | null {
	const tid = Number(row[THREAD_COLS.tid]);
	if (!tid) return null; // Skip corrupt rows

	const displayorder = Number(row[THREAD_COLS.displayorder]) || 0;
	const closed = Number(row[THREAD_COLS.closed]) || 0;
	const recommendAdd = Number(row[THREAD_COLS.recommend_add]) || 0;
	const recommendSub = Number(row[THREAD_COLS.recommend_sub]) || 0;
	const typeid = Number(row[THREAD_COLS.typeid]) || 0;

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
		type_name: (typeid > 0 && threadTypeMap?.get(typeid)) || "",
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

// ─── Post Comments (点评) ──────────────────────────────────────────────────────

/**
 * Column indices for pre_forum_postcomment INSERT VALUES.
 * id, tid, pid, author, authorid, dateline, comment, score, useip, port, rpid
 */
const POSTCOMMENT_COLS = {
	id: 0,
	tid: 1,
	pid: 2,
	author: 3,
	authorid: 4,
	dateline: 5,
	comment: 6,
	score: 7,
	useip: 8,
	// port: 9,
	rpid: 10,
} as const;

/**
 * Extract a post comment row.
 */
export function extractPostComment(row: ParsedRow): RowRecord | null {
	const id = Number(row[POSTCOMMENT_COLS.id]);
	if (!id) return null; // Skip corrupt rows

	return {
		id,
		thread_id: Number(row[POSTCOMMENT_COLS.tid]),
		post_id: Number(row[POSTCOMMENT_COLS.pid]),
		author_id: Number(row[POSTCOMMENT_COLS.authorid]),
		author_name: row[POSTCOMMENT_COLS.author] ?? "",
		content: row[POSTCOMMENT_COLS.comment] ?? "",
		score: Number(row[POSTCOMMENT_COLS.score]) || 0,
		reply_post_id: Number(row[POSTCOMMENT_COLS.rpid]) || 0,
		ip: row[POSTCOMMENT_COLS.useip] ?? "",
		created_at: Number(row[POSTCOMMENT_COLS.dateline]) || 0,
	};
}
