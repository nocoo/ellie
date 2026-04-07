/**
 * Users Table Transform
 *
 * Maps multiple MySQL tables to D1 users table:
 * - uc_members (primary source: uid, username, password, salt, email)
 * - pre_common_member (status, role, reg_date, credits)
 * - pre_common_member_count (threads, posts, digest_posts, ol_time)
 * - pre_common_member_profile (gender, birth, location, bio, etc.)
 * - pre_common_member_status (last_activity, last_ip)
 * - pre_common_member_field_forum (signature)
 * - pre_common_usergroup (group_title, group_stars, group_color)
 */

import { parseMySQLDump, rowsToObjects } from "../parse-dump";

const DUMP_DIR = "reference/db";

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

/**
 * Load and index a table by uid
 */
function loadAndIndex<T extends { uid: number }>(file: string, table: string): Map<number, T> {
	const { columns, rows } = parseMySQLDump(`${DUMP_DIR}/${file}`, table);
	const objects = rowsToObjects(columns, rows) as T[];
	const map = new Map<number, T>();
	for (const obj of objects) {
		map.set(obj.uid, obj);
	}
	return map;
}

/**
 * Transform MySQL users to D1 format
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: User data merge from multiple tables
export async function transformUsers(
	options: { limit?: number; offset?: number } = {},
): Promise<D1User[]> {
	const { limit, offset = 0 } = options;

	// Load uc_members (primary source)
	console.log("  Loading uc_members...");
	const { columns: ucCols, rows: ucRows } = parseMySQLDump(
		`${DUMP_DIR}/ucenter.sql.gz`,
		"uc_members",
		{ limit: limit ? limit + offset : undefined, offset },
	);
	const ucMembers = rowsToObjects(ucCols, ucRows) as UCMember[];
	console.log(`    Found ${ucMembers.length} uc_members`);

	// Load supporting tables
	console.log("  Loading pre_common_member...");
	const memberMap = loadAndIndex<CommonMember>("main_small.sql.gz", "pre_common_member");
	console.log(`    Found ${memberMap.size} common_members`);

	console.log("  Loading pre_common_member_count...");
	const countMap = loadAndIndex<MemberCount>("user_extra.sql.gz", "pre_common_member_count");
	console.log(`    Found ${countMap.size} member_counts`);

	console.log("  Loading pre_common_member_profile...");
	const profileMap = loadAndIndex<MemberProfile>("user_extra.sql.gz", "pre_common_member_profile");
	console.log(`    Found ${profileMap.size} member_profiles`);

	console.log("  Loading pre_common_member_status...");
	const statusMap = loadAndIndex<MemberStatus>("user_extra.sql.gz", "pre_common_member_status");
	console.log(`    Found ${statusMap.size} member_statuses`);

	console.log("  Loading pre_common_member_field_forum...");
	const fieldForumMap = loadAndIndex<MemberFieldForum>(
		"user_extra.sql.gz",
		"pre_common_member_field_forum",
	);
	console.log(`    Found ${fieldForumMap.size} member_field_forums`);

	console.log("  Loading pre_common_usergroup...");
	const { columns: ugCols, rows: ugRows } = parseMySQLDump(
		`${DUMP_DIR}/user_extra.sql.gz`,
		"pre_common_usergroup",
	);
	const usergroups = rowsToObjects(ugCols, ugRows) as UserGroup[];
	const groupMap = new Map<number, UserGroup>();
	for (const ug of usergroups) {
		groupMap.set(ug.groupid, ug);
	}
	console.log(`    Found ${groupMap.size} usergroups`);

	// Transform
	console.log("  Transforming...");
	const result: D1User[] = [];

	for (const uc of ucMembers) {
		const member = memberMap.get(uc.uid);
		const count = countMap.get(uc.uid);
		const profile = profileMap.get(uc.uid);
		const status = statusMap.get(uc.uid);
		const fieldForum = fieldForumMap.get(uc.uid);
		const usergroup = member ? groupMap.get(member.groupid) : undefined;

		// Determine status
		let userStatus = 0; // normal
		if (member) {
			if (member.status === -1 || member.freeze === 1) {
				userStatus = -1; // banned
			}
		}

		// Map adminid to role
		// DZ: 0=user, 1=admin, 2=super-mod, 3=mod
		const role = member?.adminid ?? 0;

		result.push({
			id: uc.uid,
			username: uc.username,
			email: uc.email || member?.email || "",
			password_hash: uc.password,
			password_salt: uc.salt,
			avatar: "", // Computed from uid: avatars/{uid}.jpg
			status: userStatus,
			role: role,
			reg_date: member?.regdate || uc.regdate || 0,
			last_login: uc.lastlogintime || 0,
			threads: count?.threads || 0,
			posts: count?.posts || 0,
			credits: member?.credits || 0,
			signature: fieldForum?.sightml || "",
			group_title: usergroup?.grouptitle || "",
			group_stars: usergroup?.stars || 0,
			group_color: usergroup?.color || "",
			custom_title: "", // Not available in source data
			digest_posts: count?.digestposts || 0,
			ol_time: count?.oltime || 0,
			gender: profile?.gender || 0,
			birth_year: profile?.birthyear || 0,
			birth_month: profile?.birthmonth || 0,
			birth_day: profile?.birthday || 0,
			reside_province: profile?.resideprovince || "",
			reside_city: profile?.residecity || "",
			graduate_school: profile?.graduateschool || "",
			bio: profile?.bio || "",
			interest: profile?.interest || "",
			qq: profile?.qq || "",
			site: profile?.site || "",
			last_activity: status?.lastactivity || 0,
			reg_ip: uc.regip || "",
			last_ip: status?.lastip || "",
		});
	}

	return result;
}

/**
 * Escape a string for SQL
 */
function escapeString(value: string | null | undefined): string {
	if (value === null || value === undefined) {
		return "''";
	}
	// Escape single quotes by doubling them (SQLite style)
	const escaped = String(value).replace(/'/g, "''");
	return `'${escaped}'`;
}

/**
 * Generate SQL INSERT statements for users
 */
export function generateUsersSQL(users: D1User[]): string[] {
	const statements: string[] = [];

	for (const user of users) {
		const sql = `INSERT INTO users (id, username, email, password_hash, password_salt, avatar, status, role, reg_date, last_login, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, last_activity, reg_ip, last_ip) VALUES (${user.id}, ${escapeString(user.username)}, ${escapeString(user.email)}, ${escapeString(user.password_hash)}, ${escapeString(user.password_salt)}, ${escapeString(user.avatar)}, ${user.status}, ${user.role}, ${user.reg_date}, ${user.last_login}, ${user.threads}, ${user.posts}, ${user.credits}, ${escapeString(user.signature)}, ${escapeString(user.group_title)}, ${user.group_stars}, ${escapeString(user.group_color)}, ${escapeString(user.custom_title)}, ${user.digest_posts}, ${user.ol_time}, ${user.gender}, ${user.birth_year}, ${user.birth_month}, ${user.birth_day}, ${escapeString(user.reside_province)}, ${escapeString(user.reside_city)}, ${escapeString(user.graduate_school)}, ${escapeString(user.bio)}, ${escapeString(user.interest)}, ${escapeString(user.qq)}, ${escapeString(user.site)}, ${user.last_activity}, ${escapeString(user.reg_ip)}, ${escapeString(user.last_ip)})`;
		statements.push(sql);
	}

	return statements;
}

// CLI for testing
if (import.meta.main) {
	console.log("Transforming users (limit 100 for testing)...");
	const users = await transformUsers({ limit: 100 });
	console.log(`\nTransformed ${users.length} users`);

	// Show sample
	console.log("\nSample (first 3):");
	for (const user of users.slice(0, 3)) {
		console.log(
			`  [${user.id}] ${user.username} (status=${user.status}, role=${user.role}, posts=${user.posts})`,
		);
	}

	// Generate SQL sample
	console.log("\nSQL sample (first 1):");
	const sql = generateUsersSQL(users.slice(0, 1));
	console.log(`  ${sql[0].slice(0, 300)}...`);
}
