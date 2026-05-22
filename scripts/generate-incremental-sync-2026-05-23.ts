#!/usr/bin/env bun
/**
 * Final incremental D1 sync generator for 2026-05-23.
 *
 * Source: VPS live queries (snapshot ~2026-05-22T22:46 UTC)
 * Watermark: threads.max_id=1184175 / posts.max_id=10135458 / users.max_id=1146907
 *
 * Produces:
 *   - reference/sync-2026-05-23/sql/01-threads-new.sql      (3 rows)
 *   - reference/sync-2026-05-23/sql/02-posts-new.sql        (19 rows)
 *   - reference/sync-2026-05-23/sql/03-threads-refresh.sql  (1 row, tid=1184174)
 *   - reference/sync-2026-05-23/sql/04-users-new.sql        (25 rows)
 *   - reference/sync-2026-05-23/dryrun/report.json
 */

import { readFileSync, writeFileSync } from "node:fs";

const OUT_SQL = "reference/sync-2026-05-23/sql";
const OUT_DRY = "reference/sync-2026-05-23/dryrun";

const D1_WATERMARK = {
	threads_max_id: 1184175,
	posts_max_id: 10135458,
	users_max_id: 1146907,
	attachments_max_id: 87329,
	messages_max_id: 436865,
};

function esc(value: string | null | undefined): string {
	if (value === null || value === undefined) return "''";
	const s = String(value).replace(/\0/g, "").replace(/'/g, "''");
	return `'${s}'`;
}

// --- Threads ---
interface ThreadRow {
	tid: number;
	fid: number;
	authorid: number;
	author: string;
	subject: string;
	dateline: number;
	lastpost: number;
	lastposter: string;
	lastposterid: number;
	replies: number;
	views: number;
	closed: number;
	displayorder: number;
	digest: number;
	special: number;
	highlight: number;
	recommends: number;
	posttableid: number;
	typeid: number;
}

const threads: ThreadRow[] = [
	{
		tid: 1184176,
		fid: 236,
		authorid: 8782,
		author: "段誉只爱语嫣",
		subject: "2026年5月22日签到记录贴",
		dateline: 1779407302,
		lastpost: 1779420096,
		lastposter: "cqs623",
		lastposterid: 180632,
		replies: 3,
		views: 0,
		closed: 1,
		displayorder: 0,
		digest: 0,
		special: 0,
		highlight: 1,
		recommends: 0,
		posttableid: 0,
		typeid: 0,
	},
	{
		tid: 1184177,
		fid: 111,
		authorid: 905274,
		author: "麻小麻",
		subject: "中国移动通信集团青海有限公司2026暑期实习生招聘公告",
		dateline: 1779414983,
		lastpost: 1779414983,
		lastposter: "麻小麻",
		lastposterid: 905274,
		replies: 0,
		views: 16,
		closed: 0,
		displayorder: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		posttableid: 0,
		typeid: 0,
	},
	{
		tid: 1184178,
		fid: 111,
		authorid: 905274,
		author: "麻小麻",
		subject: "中移九天2026梦想+实习生计划启动！",
		dateline: 1779430870,
		lastpost: 1779430870,
		lastposter: "麻小麻",
		lastposterid: 905274,
		replies: 0,
		views: 13,
		closed: 0,
		displayorder: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		posttableid: 0,
		typeid: 0,
	},
];

const threadsSql = threads
	.map(
		(t) =>
			`INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, last_poster_id, replies, views, closed, sticky, digest, special, highlight, recommends, post_table_id, type_id, type_name) VALUES (${t.tid}, ${t.fid}, ${t.authorid}, ${esc(t.author)}, ${esc(t.subject)}, ${t.dateline}, ${t.lastpost}, ${esc(t.lastposter)}, ${t.lastposterid}, ${t.replies}, ${t.views}, ${t.closed}, ${t.displayorder}, ${t.digest}, ${t.special}, ${t.highlight}, ${t.recommends}, ${t.posttableid}, 0, '');`,
	)
	.join("\n");
writeFileSync(`${OUT_SQL}/01-threads-new.sql`, `${threadsSql}\n`);

// --- Posts ---
const postsRaw = readFileSync("reference/db/2026-05-23/posts_raw.tsv", "utf-8").trim().split("\n");

const postsSql = postsRaw
	.map((line) => {
		const parts = line.split("\t");
		const pid = Number(parts[0]);
		const tid = Number(parts[1]);
		const fid = Number(parts[2]);
		const authorid = Number(parts[3]);
		const author = parts[4];
		const message = parts[5];
		const dateline = Number(parts[6]);
		const first = Number(parts[7]);
		const position = Number(parts[8]);
		const invisible = Number(parts[9]);
		return `INSERT INTO posts (id, thread_id, forum_id, author_id, author_name, content, created_at, is_first, position, is_hidden) VALUES (${pid}, ${tid}, ${fid}, ${authorid}, ${esc(author)}, ${esc(message)}, ${dateline}, ${first}, ${position}, ${invisible});`;
	})
	.join("\n");
writeFileSync(`${OUT_SQL}/02-posts-new.sql`, `${postsSql}\n`);

// --- Thread metadata refresh (tid=1184174) ---
const refreshSql = `UPDATE threads SET last_post_at = 1779465588, last_poster = 'love135', last_poster_id = 182083, replies = 29, views = 604, closed = 0, sticky = 0, digest = 0, special = 0, highlight = 0, recommends = 0 WHERE id = 1184174;\n`;
writeFileSync(`${OUT_SQL}/03-threads-refresh.sql`, refreshSql);

// --- Users ---
interface UserRow {
	uid: number;
	username: string;
	email: string;
	password_hash: string;
	password_salt: string;
	status: number;
	groupid: number;
	regdate: number;
	credits: number;
	threads: number;
	posts: number;
	lastactivity: number;
	lastip: string;
	regip: string;
}

const usersData: UserRow[] = [
	{
		uid: 1146908,
		username: "wddede",
		email: "grrggrrggt@qq.com",
		password_hash: "eb7fdb4636be0937b214472a4a866098",
		password_salt: "9e6bbe",
		status: 0,
		groupid: 8,
		regdate: 1779409224,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409224,
		lastip: "162.159.113.126",
		regip: "162.159.113.127",
	},
	{
		uid: 1146909,
		username: "wdedfe",
		email: "vrvrvrvrrgbr@qq.com",
		password_hash: "aa1345ae2b2c298669b4316ab6433135",
		password_salt: "6e1b96",
		status: 0,
		groupid: 8,
		regdate: 1779409285,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409285,
		lastip: "162.159.113.126",
		regip: "162.159.113.127",
	},
	{
		uid: 1146910,
		username: "effeefrf",
		email: "rvtvtggthtthyh@qq.com",
		password_hash: "849c7fb6ac81fbb86b25fc2d18a84d84",
		password_salt: "ba281a",
		status: 0,
		groupid: 8,
		regdate: 1779409354,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409354,
		lastip: "162.159.113.127",
		regip: "162.159.113.127",
	},
	{
		uid: 1146911,
		username: "dwdwdwxe",
		email: "tggtgththt@qq.com",
		password_hash: "968cd128f9bff21828c79c5559bdb32a",
		password_salt: "111a8b",
		status: 0,
		groupid: 8,
		regdate: 1779409423,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409423,
		lastip: "162.159.113.127",
		regip: "162.159.113.126",
	},
	{
		uid: 1146912,
		username: "zwdexe",
		email: "frfrcrrggr@qq.com",
		password_hash: "5519a56debcf0e417c88b893750b16e7",
		password_salt: "033617",
		status: 0,
		groupid: 8,
		regdate: 1779409486,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409486,
		lastip: "162.159.113.127",
		regip: "162.159.113.126",
	},
	{
		uid: 1146913,
		username: "xxeedxeef",
		email: "grrgrggtbttb@qq.com",
		password_hash: "ebf2fb96b531157d4c61e4dfb0f1279c",
		password_salt: "334e29",
		status: 0,
		groupid: 8,
		regdate: 1779409553,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409553,
		lastip: "162.159.113.127",
		regip: "162.159.113.126",
	},
	{
		uid: 1146914,
		username: "xwxxwxw",
		email: "egvrrvvrrvt@qq.com",
		password_hash: "d41fb59ab642126ef2969cec64dd836b",
		password_salt: "726333",
		status: 0,
		groupid: 8,
		regdate: 1779409621,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409621,
		lastip: "162.159.113.127",
		regip: "162.159.113.127",
	},
	{
		uid: 1146915,
		username: "xwwxxe",
		email: "grgrrghgrgr@qq.com",
		password_hash: "3109f80f7d009ac7463a6d9cd2fdfcd6",
		password_salt: "b2a50a",
		status: 0,
		groupid: 8,
		regdate: 1779409689,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409689,
		lastip: "162.159.113.127",
		regip: "162.159.113.126",
	},
	{
		uid: 1146916,
		username: "ceeccdc",
		email: "efgrgrgrrvrv@qq.com",
		password_hash: "cfe570e6dec73b0ab3f9bab6c547e90c",
		password_salt: "cb6297",
		status: 0,
		groupid: 8,
		regdate: 1779409803,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779409803,
		lastip: "172.71.102.153",
		regip: "104.23.172.19",
	},
	{
		uid: 1146917,
		username: "zfzfzzfxf",
		email: "cyyccycucu@qq.com",
		password_hash: "2132be2219fd8c367dcaceac502e1073",
		password_salt: "5995df",
		status: 0,
		groupid: 8,
		regdate: 1779410628,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779410628,
		lastip: "172.71.102.152",
		regip: "172.71.102.152",
	},
	{
		uid: 1146918,
		username: "xggxxyyx",
		email: "tdtdtdtddtdt@qq.com",
		password_hash: "efb553aef2b34526c6b89dfcfb023130",
		password_salt: "08bfdd",
		status: 0,
		groupid: 8,
		regdate: 1779410831,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779410831,
		lastip: "172.71.183.203",
		regip: "172.71.183.204",
	},
	{
		uid: 1146919,
		username: "xdzfsrssf",
		email: "fxxgdtddttd@qq.com",
		password_hash: "824edac6224eb21e570026147f5e4ff4",
		password_salt: "a7f2ab",
		status: 0,
		groupid: 8,
		regdate: 1779410905,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779410905,
		lastip: "172.71.183.203",
		regip: "172.71.183.204",
	},
	{
		uid: 1146920,
		username: "zgzxftx",
		email: "gdrsrsrsts@qq.com",
		password_hash: "01c1195ee5db6b22b24430d274587947",
		password_salt: "147db1",
		status: 0,
		groupid: 8,
		regdate: 1779410975,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779410975,
		lastip: "172.71.183.204",
		regip: "172.71.183.204",
	},
	{
		uid: 1146921,
		username: "xtztzdtzt",
		email: "gdtdydfyfy@qq.com",
		password_hash: "adaaa36b2bafac2521adb8e54849a18e",
		password_salt: "be8074",
		status: 0,
		groupid: 8,
		regdate: 1779411034,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779411034,
		lastip: "172.71.183.204",
		regip: "172.71.183.203",
	},
	{
		uid: 1146922,
		username: "ffgghh",
		email: "zssddfffff@qq.com",
		password_hash: "76dc4d96de5fbfb427839ec7ad178a10",
		password_salt: "5c276e",
		status: 0,
		groupid: 8,
		regdate: 1779418276,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779418276,
		lastip: "172.70.46.191",
		regip: "172.70.46.190",
	},
	{
		uid: 1146923,
		username: "llopjjjh",
		email: "vbnvbnzzzzzvbn@qq.com",
		password_hash: "c096fe9f7e9b00d25d2ffdb14a5838cf",
		password_salt: "0bdd88",
		status: 0,
		groupid: 8,
		regdate: 1779418351,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779418351,
		lastip: "172.70.46.191",
		regip: "172.70.46.191",
	},
	{
		uid: 1146924,
		username: "lookkjj",
		email: "vbnvbnzzzvbnzzzzzvbn@qq.com",
		password_hash: "b00fafc48bcf5ea795f5def5ee524fb2",
		password_salt: "7ddddb",
		status: 0,
		groupid: 8,
		regdate: 1779418422,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779418422,
		lastip: "172.70.46.191",
		regip: "172.70.46.191",
	},
	{
		uid: 1146925,
		username: "bfffffff",
		email: "vbnvvbnzzzzzvbn@qq.com",
		password_hash: "c72fee4d59e0c7479e798c4ba7c68cd9",
		password_salt: "24d0bb",
		status: 0,
		groupid: 8,
		regdate: 1779418496,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779418496,
		lastip: "172.70.46.191",
		regip: "172.70.46.191",
	},
	{
		uid: 1146926,
		username: "gjjjjn",
		email: "bnmbnmnbmbn@qq.com",
		password_hash: "54f0e241ef38f92e9206fce13c078644",
		password_salt: "4efdb4",
		status: 0,
		groupid: 8,
		regdate: 1779428883,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779428883,
		lastip: "172.71.95.86",
		regip: "104.23.172.18",
	},
	{
		uid: 1146927,
		username: "kpiuh",
		email: "bnmbnzzmnbmzzzzm@qq.com",
		password_hash: "34217fd9c5978c9cb0f6ebcd483e6024",
		password_salt: "674744",
		status: 0,
		groupid: 8,
		regdate: 1779429172,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779429172,
		lastip: "172.71.95.86",
		regip: "104.23.166.180",
	},
	{
		uid: 1146928,
		username: "zzrrzrz",
		email: "ydyfyffucuuv@qq.com",
		password_hash: "3c4b58348eea0047fcebd5b8173988d1",
		password_salt: "5f401c",
		status: 0,
		groupid: 8,
		regdate: 1779430516,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779430516,
		lastip: "14.112.128.146",
		regip: "14.112.128.146",
	},
	{
		uid: 1146929,
		username: "zeaarsr",
		email: "yfyfyffufufu@qq.com",
		password_hash: "fa6d6cf401bee946f97b8bb95599b2d4",
		password_salt: "e9cc13",
		status: 0,
		groupid: 8,
		regdate: 1779430573,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779430573,
		lastip: "14.112.128.146",
		regip: "14.112.128.146",
	},
	{
		uid: 1146930,
		username: "zfzfzxgtx",
		email: "yfyfyfufuffu@qq.com",
		password_hash: "420af1dfee561cac6c317d5fdc607450",
		password_salt: "a1d870",
		status: 0,
		groupid: 8,
		regdate: 1779430920,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779430920,
		lastip: "14.112.128.146",
		regip: "14.112.128.146",
	},
	{
		uid: 1146931,
		username: "zearasrrs",
		email: "ycfyyfufcuu@qq.com",
		password_hash: "360302ae6b68013c658eec82deaccfa5",
		password_salt: "5d57f9",
		status: 0,
		groupid: 8,
		regdate: 1779430980,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779430980,
		lastip: "14.112.128.146",
		regip: "14.112.128.146",
	},
	{
		uid: 1146932,
		username: "吴霄",
		email: "516381596@qq.com",
		password_hash: "70006c3f0ef6fdd5a1c732506fabfd1c",
		password_salt: "171631",
		status: 0,
		groupid: 11,
		regdate: 1779446751,
		credits: 50,
		threads: 0,
		posts: 0,
		lastactivity: 1779446751,
		lastip: "172.68.22.4",
		regip: "183.193.143.159",
	},
];

// Map groupid → role: 1=admin(3), 2=supermod(2), 3=mod(1), rest=user(0)
function groupToRole(gid: number): number {
	if (gid === 1) return 3;
	if (gid === 2) return 2;
	if (gid === 3) return 1;
	return 0;
}

// Avatar from uid
function avatarPath(uid: number): string {
	const s = String(uid).padStart(9, "0");
	return `${s.slice(0, 3)}/${s.slice(3, 5)}/${s.slice(5, 7)}/${s.slice(7, 9)}_avatar_middle.jpg`;
}

const usersSql = usersData
	.map(
		(u) =>
			`INSERT INTO users (id, username, email, password_hash, password_salt, avatar, status, role, reg_date, last_login, threads, posts, credits, digest_posts, online_hours, gender, signature, reg_ip) VALUES (${u.uid}, ${esc(u.username)}, ${esc(u.email)}, ${esc(u.password_hash)}, ${esc(u.password_salt)}, ${esc(avatarPath(u.uid))}, ${u.status}, ${groupToRole(u.groupid)}, ${u.regdate}, ${u.lastactivity}, ${u.threads}, ${u.posts}, ${u.credits}, 0, 0, 0, '', ${esc(u.regip)});`,
	)
	.join("\n");
writeFileSync(`${OUT_SQL}/04-users-new.sql`, `${usersSql}\n`);

// --- Report ---
const report = {
	generated_at: new Date().toISOString(),
	source_snapshot_utc: "2026-05-22T22:46:16Z",
	d1_watermark: D1_WATERMARK,
	d1_live: {
		users: { count: 1142604, max_id: 1146907 },
		threads: { count: 986628, max_id: 1184175 },
		posts: { count: 9510769, max_id: 10135458 },
		attachments: { count: 76710, max_id: 87329 },
		messages: { count: 330088, max_id: 436865 },
		user_checkins: { count: 2816 },
	},
	source: {
		threads_main: { count: 790222, max_tid: 1184178 },
		threads_shards: { _1_max: 29924, _2_max: 102963, _3_max: 225652 },
		posts_main: { count: 6235195, max_pid: 10135477 },
		posts_shards: { _1_max: 10131885, _2_max: 10083403, _3_max: 10076967, _4_max: 10096786 },
		users_cm: { count_above_wm: 25, max_uid: 1146932 },
		users_uc: { count: 1141465, max_uid: 1146932 },
		attachments_master: { count: 78178, max_aid: 87329 },
		attachments_shards_total: 76721,
		messages_uc_pms: { count: 432920, max_pmid: 436863 },
		checkins_paulsign: { count: 2797, max_uid: 1140903, max_time: 1779420096 },
		checkins_paulsign2: { count: 108, max_uid: 810105, max_time: 1368532527 },
	},
	shard_sanity: {
		all_thread_shard_maxes_below_watermark: true,
		all_post_shard_maxes_below_watermark: true,
	},
	planned_writes: {
		"01-threads-new.sql": { rows: 3, tids: [1184176, 1184177, 1184178] },
		"02-posts-new.sql": { rows: 19, pids_range: "10135459..10135477" },
		"03-threads-refresh.sql": { rows: 1, tids: [1184174] },
		"04-users-new.sql": { rows: 25, uids_range: "1146908..1146932" },
	},
	report_only_no_write: {
		attachments: "source max_aid=87329 == D1 max=87329; 0 new aids; 11 historical gaps unchanged",
		messages: "source max_pmid=436863 < D1 max=436865; 0 new messages",
		user_checkins:
			"D1=2816 > source(paulsign)=2797; reverse diff unchanged; paulsign max_time=2026-05-22T01:41Z newer than D1 max but these are existing uid updates not new rows",
	},
	fk_validation: {
		thread_authors: "8782, 905274 → 2/2 in D1 users ✓",
		thread_forums: "111, 236 → 2/2 in D1 forums ✓",
		post_authors: "12 distinct uids → 12/12 in D1 users ✓",
		post_threads: "new tids 1184176-1184178 (created in 01) + old tid 1184174 (in D1) ✓",
		refresh_tids: "1184174 → 1/1 in D1 ✓",
		new_thread_typeid: "all 0 → no mapping needed",
	},
	deletions_drift: {
		threads_count_drop: -73,
		posts_count_drop: -195,
		note: "Hard DELETEs between 5-22 and 5-23 (moderation); max_id unchanged; not backfilled",
	},
	execution_order: [
		"04-users-new.sql",
		"01-threads-new.sql",
		"02-posts-new.sql",
		"03-threads-refresh.sql",
	],
	kv_cache_plan: {
		bump: [
			"thread:list:gen:111",
			"thread:list:gen:236",
			"thread:meta:gen:1184174",
			"thread:meta:gen:1184176",
			"thread:meta:gen:1184177",
			"thread:meta:gen:1184178",
			"post:list:gen:1184174",
			"post:list:gen:1184176",
			"post:list:gen:1184177",
			"post:list:gen:1184178",
		],
		ttl_only: [
			"user:public:v2:* (new uids TTL-based, not cached yet)",
			"user:mini:v2:* (same)",
			"forum:summary:gen (tiny count change, not bumping)",
		],
		not_bumped: [
			"digest:gen (no digest-affecting column changed)",
			"message/checkin caches (0 writes)",
		],
	},
};

writeFileSync(`${OUT_DRY}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

console.log("Generated:");
console.log(`  ${OUT_SQL}/01-threads-new.sql (3 rows)`);
console.log(`  ${OUT_SQL}/02-posts-new.sql (19 rows)`);
console.log(`  ${OUT_SQL}/03-threads-refresh.sql (1 row)`);
console.log(`  ${OUT_SQL}/04-users-new.sql (25 rows)`);
console.log(`  ${OUT_DRY}/report.json`);
