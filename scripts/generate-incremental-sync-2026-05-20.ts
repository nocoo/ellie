#!/usr/bin/env bun
/**
 * Incremental D1 sync generator for 2026-05-20 dump.
 *
 * Reads reference/db/2026-05-20/{db_tongji_main_full,db_tongji_ucenter_full}.sql.gz
 * via legacy symlinks and produces:
 *   - reference/sync-2026-05-20/sql/01-threads-new.sql      (tid > 1184156)
 *   - reference/sync-2026-05-20/sql/02-posts-new.sql        (pid > 10135282)
 *   - reference/sync-2026-05-20/sql/03-threads-refresh.sql  (UPDATE on tids touched by new pids)
 *   - reference/sync-2026-05-20/sql/04-users-new.sql        (uid > 1146752)
 *   - reference/sync-2026-05-20/dryrun/report.json
 *   - reference/sync-2026-05-20/dryrun/forums-diff.json     (diff only, no SQL emitted)
 *
 * NOT writing attachments / messages / user_checkins in this sync (see report).
 * forums: dry-run diff only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { rowsToObjects, streamParseMySQLDump } from "../scripts/import/stream-parse-dump";

const DUMP_DIR = "reference/db/2026-05-20";
const OUT_SQL = "reference/sync-2026-05-20/sql";
const OUT_DRY = "reference/sync-2026-05-20/dryrun";

const D1 = {
	threads_max_id: 1184156,
	posts_max_id: 10135282,
	users_max_id: 1146752,
};

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

interface MySQLPost {
	pid: number;
	tid: number;
	fid: number;
	authorid: number;
	author: string;
	message: string;
	dateline: number;
	first: number;
	position: number;
	invisible: number;
}

// D1 silently truncates SQL imports at NUL — strip them defensively before quoting.
const NUL_CHAR = String.fromCharCode(0);
function escapeString(value: string | null | undefined): string {
	if (value === null || value === undefined) return "''";
	const s = String(value).split(NUL_CHAR).join("").replace(/\\/g, "\\\\").replace(/'/g, "''");
	return `'${s}'`;
}

async function streamFilter<T extends Record<string, unknown>>(
	file: string,
	table: string,
	predicate: (row: T) => boolean,
): Promise<T[]> {
	console.log(`  Streaming ${table} from ${file}...`);
	const collected: unknown[][] = [];
	let columns: string[] = [];
	const res = await streamParseMySQLDump(`${DUMP_DIR}/${file}`, table, {
		onRow: (row) => {
			collected.push(row);
		},
	});
	columns = res.columns;
	const objs = rowsToObjects(columns, collected) as T[];
	console.log(`    Found ${objs.length} rows in ${table}`);
	const filtered = objs.filter(predicate);
	console.log(`    After filter: ${filtered.length}`);
	return filtered;
}

interface UCMember {
	uid: number;
	username: string;
	password: string;
	email: string;
	regip: string;
	regdate: number;
	lastloginip: number;
	lastlogintime: number;
	salt: string;
}
interface CommonMember {
	uid: number;
	email: string;
	username: string;
	status: number;
	adminid: number;
	groupid: number;
	regdate: number;
	credits: number;
	freeze?: number;
}
interface MemberCount {
	uid: number;
	threads: number;
	posts: number;
	digestposts: number;
	oltime: number;
}
interface MemberProfile {
	uid: number;
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
}
interface MemberStatus {
	uid: number;
	lastactivity: number;
	lastip: string;
}
interface MemberFieldForum {
	uid: number;
	sightml: string;
}
interface UserGroup {
	groupid: number;
	grouptitle: string;
	stars: number;
	color: string;
}

interface MySQLForum {
	fid: number;
	fup: number;
	name: string;
	status: number;
	displayorder: number;
	threads: number;
	posts: number;
	type: string;
	lastpost: string;
	moderators: string;
}

interface D1User {
	id: number;
	username: string;
	email: string;
	password_hash: string;
	password_salt: string;
	avatar: string;
	status: number;
	role: number;
	reg_date: number;
	last_login: number;
	threads: number;
	posts: number;
	credits: number;
	signature: string;
	group_title: string;
	group_stars: number;
	group_color: string;
	custom_title: string;
	digest_posts: number;
	ol_time: number;
	gender: number;
	birth_year: number;
	birth_month: number;
	birth_day: number;
	reside_province: string;
	reside_city: string;
	graduate_school: string;
	bio: string;
	interest: string;
	qq: string;
	site: string;
	last_activity: number;
	reg_ip: string;
	last_ip: string;
}

function threadInsert(t: MySQLThread, lastPosterId: number): string {
	return `INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, replies, views, closed, sticky, digest, special, highlight, recommends, post_table_id, type_name, last_poster_id) VALUES (${t.tid}, ${t.fid}, ${t.authorid}, ${escapeString(t.author || "")}, ${escapeString(t.subject || "")}, ${t.dateline || 0}, ${t.lastpost || 0}, ${escapeString(t.lastposter || "")}, ${t.replies || 0}, ${t.views || 0}, ${t.closed || 0}, ${t.displayorder || 0}, ${t.digest || 0}, ${t.special || 0}, ${t.highlight || 0}, ${t.recommends || 0}, ${t.posttableid || 0}, '', ${lastPosterId});`;
}

function postInsert(p: MySQLPost): string {
	return `INSERT INTO posts (id, thread_id, forum_id, author_id, author_name, content, created_at, is_first, position, invisible) VALUES (${p.pid}, ${p.tid}, ${p.fid}, ${p.authorid}, ${escapeString(p.author || "")}, ${escapeString(p.message || "")}, ${p.dateline || 0}, ${p.first || 0}, ${p.position || 0}, ${p.invisible || 0});`;
}

function threadRefresh(t: MySQLThread, lastPosterId: number): string {
	return `UPDATE threads SET last_post_at=${t.lastpost || 0}, last_poster=${escapeString(t.lastposter || "")}, last_poster_id=${lastPosterId}, replies=${t.replies || 0}, views=${t.views || 0}, closed=${t.closed || 0}, sticky=${t.displayorder || 0}, digest=${t.digest || 0}, special=${t.special || 0}, highlight=${t.highlight || 0}, recommends=${t.recommends || 0} WHERE id=${t.tid};`;
}

function userInsert(u: D1User): string {
	return `INSERT INTO users (id, username, email, password_hash, password_salt, avatar, status, role, reg_date, last_login, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, last_activity, reg_ip, last_ip) VALUES (${u.id}, ${escapeString(u.username)}, ${escapeString(u.email)}, ${escapeString(u.password_hash)}, ${escapeString(u.password_salt)}, ${escapeString(u.avatar)}, ${u.status}, ${u.role}, ${u.reg_date}, ${u.last_login}, ${u.threads}, ${u.posts}, ${u.credits}, ${escapeString(u.signature)}, ${escapeString(u.group_title)}, ${u.group_stars}, ${escapeString(u.group_color)}, ${escapeString(u.custom_title)}, ${u.digest_posts}, ${u.ol_time}, ${u.gender}, ${u.birth_year}, ${u.birth_month}, ${u.birth_day}, ${escapeString(u.reside_province)}, ${escapeString(u.reside_city)}, ${escapeString(u.graduate_school)}, ${escapeString(u.bio)}, ${escapeString(u.interest)}, ${escapeString(u.qq)}, ${escapeString(u.site)}, ${u.last_activity}, ${escapeString(u.reg_ip)}, ${escapeString(u.last_ip)});`;
}

function countBy<T>(arr: T[], f: (t: T) => number | string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const x of arr) {
		const k = String(f(x));
		out[k] = (out[k] || 0) + 1;
	}
	return out;
}

function nullScan(s: string): number {
	let n = 0;
	for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0) n++;
	return n;
}

function profileFields(p: MemberProfile | undefined) {
	return {
		gender: p?.gender || 0,
		birth_year: p?.birthyear || 0,
		birth_month: p?.birthmonth || 0,
		birth_day: p?.birthday || 0,
		reside_province: p?.resideprovince || "",
		reside_city: p?.residecity || "",
		graduate_school: p?.graduateschool || "",
		bio: p?.bio || "",
		interest: p?.interest || "",
		qq: p?.qq || "",
		site: p?.site || "",
	};
}

function buildD1User(
	u: UCMember,
	m: CommonMember | undefined,
	c: MemberCount | undefined,
	p: MemberProfile | undefined,
	s: MemberStatus | undefined,
	f: MemberFieldForum | undefined,
	ug: UserGroup | undefined,
): D1User {
	const userStatus = m && (m.status === -1 || m.freeze === 1) ? -1 : 0;
	return {
		id: u.uid,
		username: u.username,
		email: u.email || m?.email || "",
		password_hash: u.password,
		password_salt: u.salt,
		avatar: "",
		status: userStatus,
		role: m?.adminid ?? 0,
		reg_date: m?.regdate || u.regdate || 0,
		last_login: u.lastlogintime || 0,
		threads: c?.threads || 0,
		posts: c?.posts || 0,
		credits: m?.credits || 0,
		signature: f?.sightml || "",
		group_title: ug?.grouptitle || "",
		group_stars: ug?.stars || 0,
		group_color: ug?.color || "",
		custom_title: "",
		digest_posts: c?.digestposts || 0,
		ol_time: c?.oltime || 0,
		...profileFields(p),
		last_activity: s?.lastactivity || 0,
		reg_ip: u.regip || "",
		last_ip: s?.lastip || "",
	};
}

interface JoinedUsersResult {
	users: D1User[];
	missing: {
		member: number;
		count: number;
		profile: number;
		status: number;
	};
}

async function loadJoinedUsers(minUid: number): Promise<JoinedUsersResult> {
	const ucMembers = await streamFilter<UCMember>(
		"ucenter.sql.gz",
		"uc_members",
		(u) => u.uid > minUid,
	);
	console.log(`> uc_members delta: ${ucMembers.length}`);
	const newUids = new Set(ucMembers.map((u) => u.uid));

	const commonMembers = await streamFilter<CommonMember>(
		"main_small.sql.gz",
		"pre_common_member",
		(m) => newUids.has(m.uid),
	);
	const commonMap = new Map(commonMembers.map((m) => [m.uid, m]));

	const memberCount = await streamFilter<MemberCount>(
		"user_extra.sql.gz",
		"pre_common_member_count",
		(m) => newUids.has(m.uid),
	);
	const countMap = new Map(memberCount.map((m) => [m.uid, m]));

	const memberProfile = await streamFilter<MemberProfile>(
		"user_extra.sql.gz",
		"pre_common_member_profile",
		(m) => newUids.has(m.uid),
	);
	const profileMap = new Map(memberProfile.map((m) => [m.uid, m]));

	const memberStatus = await streamFilter<MemberStatus>(
		"user_extra.sql.gz",
		"pre_common_member_status",
		(m) => newUids.has(m.uid),
	);
	const statusMap = new Map(memberStatus.map((m) => [m.uid, m]));

	const memberFieldForum = await streamFilter<MemberFieldForum>(
		"user_extra.sql.gz",
		"pre_common_member_field_forum",
		(m) => newUids.has(m.uid),
	);
	const fieldForumMap = new Map(memberFieldForum.map((m) => [m.uid, m]));

	const usergroups = await streamFilter<UserGroup>(
		"user_extra.sql.gz",
		"pre_common_usergroup",
		() => true,
	);
	const groupMap = new Map(usergroups.map((g) => [g.groupid, g]));

	const users = ucMembers
		.map((u) => {
			const m = commonMap.get(u.uid);
			return buildD1User(
				u,
				m,
				countMap.get(u.uid),
				profileMap.get(u.uid),
				statusMap.get(u.uid),
				fieldForumMap.get(u.uid),
				m ? groupMap.get(m.groupid) : undefined,
			);
		})
		.sort((a, b) => a.id - b.id);

	return {
		users,
		missing: {
			member: users.filter((u) => !commonMap.has(u.id)).length,
			count: users.filter((u) => !countMap.has(u.id)).length,
			profile: users.filter((u) => !profileMap.has(u.id)).length,
			status: users.filter((u) => !statusMap.has(u.id)).length,
		},
	};
}

async function main() {
	mkdirSync(OUT_SQL, { recursive: true });
	mkdirSync(OUT_DRY, { recursive: true });

	// --- THREADS (1 pass over main_full for full thread table) ---
	const newThreads = (
		await streamFilter<MySQLThread>("thread.sql.gz", "pre_forum_thread", () => true)
	).filter((t) => t.tid > D1.threads_max_id);
	newThreads.sort((a, b) => a.tid - b.tid);
	console.log(`> NEW threads (tid > ${D1.threads_max_id}): ${newThreads.length}`);

	// --- POSTS (1 pass over main_full, collect delta only) ---
	const newPosts = await streamFilter<MySQLPost>(
		"post_main.sql.gz",
		"pre_forum_post",
		(p) => p.pid > D1.posts_max_id,
	);
	newPosts.sort((a, b) => a.pid - b.pid);
	console.log(`> NEW posts (pid > ${D1.posts_max_id}): ${newPosts.length}`);

	// --- Touched-tid refresh ---
	const newTidSet = new Set(newThreads.map((t) => t.tid));
	const touchedOldTids = new Set<number>();
	for (const p of newPosts) if (!newTidSet.has(p.tid)) touchedOldTids.add(p.tid);
	console.log(`> Touched old tids: ${touchedOldTids.size}`);

	// --- Re-stream pre_forum_thread for refresh rows ---
	const refreshThreads = await streamFilter<MySQLThread>("thread.sql.gz", "pre_forum_thread", (t) =>
		touchedOldTids.has(t.tid),
	);
	refreshThreads.sort((a, b) => a.tid - b.tid);
	console.log(`> Refresh thread rows: ${refreshThreads.length}`);

	// --- USERS (uid > D1 max) ---
	const { users: newUsers, missing: userMissing } = await loadJoinedUsers(D1.users_max_id);
	console.log(`> NEW users joined: ${newUsers.length}`);

	// --- FORUMS diff ---
	console.log("Loading source forums (pre_forum_forum)...");
	const srcForums = await streamFilter<MySQLForum>(
		"main_small.sql.gz",
		"pre_forum_forum",
		() => true,
	);
	console.log(`  Source forums: ${srcForums.length}`);

	// last_poster_id: lookup from new users + threads' own authorid when match
	const lastPosterIdFor = (t: MySQLThread): number => (t.lastposter === t.author ? t.authorid : 0);

	// Build SQL files
	const threadsNewSQL = newThreads.map((t) => threadInsert(t, lastPosterIdFor(t))).join("\n");
	const postsNewSQL = newPosts.map(postInsert).join("\n");
	const threadsRefreshSQL = refreshThreads
		.map((t) => threadRefresh(t, lastPosterIdFor(t)))
		.join("\n");
	const usersNewSQL = newUsers.map(userInsert).join("\n");

	writeFileSync(`${OUT_SQL}/01-threads-new.sql`, `${threadsNewSQL}\n`);
	writeFileSync(`${OUT_SQL}/02-posts-new.sql`, `${postsNewSQL}\n`);
	writeFileSync(`${OUT_SQL}/03-threads-refresh.sql`, `${threadsRefreshSQL}\n`);
	writeFileSync(
		`${OUT_SQL}/04-users-new.sql`,
		usersNewSQL.endsWith("\n") ? usersNewSQL : `${usersNewSQL}\n`,
	);

	const report = {
		captured_at: new Date().toISOString(),
		baseline_d1: D1,
		dump: {
			path: DUMP_DIR,
			main_md5: "3bea1077c65e2af9c8ed0c01113954bd",
			ucenter_md5: "447acbc249ebd6bc04be47991858c4ad",
		},
		threads_new: {
			rows: newThreads.length,
			tid_range: [newThreads[0]?.tid, newThreads[newThreads.length - 1]?.tid],
			forum_distribution: countBy(newThreads, (t) => t.fid),
			tids: newThreads.map((t) => t.tid),
			sql_bytes: threadsNewSQL.length,
			sql_nul_bytes: nullScan(threadsNewSQL),
		},
		posts_new: {
			rows: newPosts.length,
			pid_range: [newPosts[0]?.pid, newPosts[newPosts.length - 1]?.pid],
			distinct_tids: new Set(newPosts.map((p) => p.tid)).size,
			distinct_authors: new Set(newPosts.map((p) => p.authorid)).size,
			sql_bytes: postsNewSQL.length,
			sql_nul_bytes: nullScan(postsNewSQL),
		},
		threads_refresh: {
			rows: refreshThreads.length,
			tids: refreshThreads.map((t) => t.tid),
			sql_bytes: threadsRefreshSQL.length,
			sql_nul_bytes: nullScan(threadsRefreshSQL),
		},
		users_new: {
			rows: newUsers.length,
			uid_range: [newUsers[0]?.id, newUsers[newUsers.length - 1]?.id],
			coverage: {
				missing_pre_common_member: userMissing.member,
				missing_pre_common_member_count: userMissing.count,
				missing_pre_common_member_profile: userMissing.profile,
				missing_pre_common_member_status: userMissing.status,
			},
			sql_bytes: usersNewSQL.length,
			sql_nul_bytes: nullScan(usersNewSQL),
		},
		known_historical_gap_attachments: {
			tids: [1160808, 1160846, 1182277, 1182278],
			pids: [10001159, 10001304, 10001305, 10001306, 10001307, 10117431, 10117432],
			aids: [85915, 85930, 85931, 85932, 85933, 85934, 85935, 85936, 86020, 87277, 87278],
			author_uid: 91296,
			forum_id: 114,
			fk_status:
				"ALL aids reference tids/pids that are themselves missing in D1. Skipped this sync. Defer to pre-cutover catch-up.",
		},
		skipped: {
			attachments_new_aid: 0,
			messages: "source max(pmid)=436863 < D1 max(id)=436865 (P0 + native); 0 to write",
			user_checkins:
				"D1 count=2816 > source paulsign count=2797. Reverse diff -> report only, no write",
		},
		forums: { source_count: srcForums.length, d1_count: 247 },
	};

	writeFileSync(`${OUT_DRY}/report.json`, JSON.stringify(report, null, 2));
	writeFileSync(
		`${OUT_DRY}/forums-source.json`,
		JSON.stringify(
			srcForums.map((f) => ({
				fid: f.fid,
				name: f.name,
				status: f.status,
				displayorder: f.displayorder,
				fup: f.fup,
				threads: f.threads,
				posts: f.posts,
			})),
			null,
			2,
		),
	);
	console.log("\n=== DRY-RUN REPORT ===");
	console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
