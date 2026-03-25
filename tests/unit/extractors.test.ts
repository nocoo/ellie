import { describe, expect, test } from "bun:test";
import {
	type AttachmentIndexData,
	type MemberCountData,
	type MemberData,
	type PostExtractionStats,
	extractAttachment,
	extractForum,
	extractPost,
	extractThread,
	extractUser,
	parseAttachmentIndex,
	parseLastPost,
	parseMemberCountRow,
	parseMemberRow,
} from "../../scripts/migrate/extract/extractors";
import type { ParsedRow } from "../../scripts/migrate/extract/parser";

// ─── Helper: build a sparse ParsedRow from index→value pairs ──────────────────

function row(entries: Record<number, string>): ParsedRow {
	const maxIdx = Math.max(...Object.keys(entries).map(Number));
	const arr: string[] = Array.from({ length: maxIdx + 1 }, () => "");
	for (const [idx, val] of Object.entries(entries)) {
		arr[Number(idx)] = val;
	}
	return arr;
}

// ─── parseLastPost ────────────────────────────────────────────────────────────

describe("parseLastPost", () => {
	test("parses tab-separated lastpost field", () => {
		const result = parseLastPost("123\tSome subject\t1700000000\tadmin");
		expect(result).toEqual({
			lastThreadId: 123,
			lastPostAt: 1700000000,
			lastPoster: "admin",
		});
	});

	test("returns zeros for null input", () => {
		expect(parseLastPost(null)).toEqual({
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
		});
	});

	test("returns zeros for empty string", () => {
		expect(parseLastPost("")).toEqual({
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
		});
	});

	test("handles partial lastpost (missing poster)", () => {
		const result = parseLastPost("42\tTitle\t1600000000");
		expect(result.lastThreadId).toBe(42);
		expect(result.lastPostAt).toBe(1600000000);
		expect(result.lastPoster).toBe("");
	});

	test("handles non-numeric tid gracefully", () => {
		const result = parseLastPost("abc\tTitle\txyz\tuser");
		expect(result.lastThreadId).toBe(0);
		expect(result.lastPostAt).toBe(0);
		expect(result.lastPoster).toBe("user");
	});
});

// ─── extractForum ─────────────────────────────────────────────────────────────

describe("extractForum", () => {
	// FORUM_COLS: fid=0, fup=1, name=2, status=3, displayorder=4, threads=5, posts=6, type=7, lastpost=8
	const forumFields = new Map<number, { description: string; icon: string }>();
	forumFields.set(10, { description: "Test forum desc", icon: "icon.png" });

	function forumRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "10", // fid
			1: "0", // fup
			2: "General Discussion", // name
			3: "1", // status (active)
			4: "1", // displayorder
			5: "100", // threads
			6: "500", // posts
			7: "forum", // type
			8: "42\tLast thread\t1700000000\tadmin", // lastpost
			...overrides,
		});
	}

	test("extracts active forum with all fields", () => {
		const result = extractForum(forumRow(), forumFields);
		expect(result).not.toBeNull();
		expect(result).toEqual({
			id: 10,
			parent_id: 0,
			name: "General Discussion",
			description: "Test forum desc",
			icon: "icon.png",
			display_order: 1,
			threads: 100,
			posts: 500,
			type: "forum",
			status: 1,
			last_thread_id: 42,
			last_post_at: 1700000000,
			last_poster: "admin",
		});
	});

	test("filters out hidden forums (status != 1)", () => {
		expect(extractForum(forumRow({ 3: "0" }), forumFields)).toBeNull();
		expect(extractForum(forumRow({ 3: "2" }), forumFields)).toBeNull();
	});

	test("uses empty strings when forumFields has no entry", () => {
		const result = extractForum(forumRow({ 0: "999" }), forumFields);
		expect(result).not.toBeNull();
		expect(result?.description).toBe("");
		expect(result?.icon).toBe("");
	});

	test("handles sub-forum type and parent_id", () => {
		const result = extractForum(forumRow({ 1: "5", 7: "sub" }), forumFields);
		expect(result).not.toBeNull();
		expect(result?.parent_id).toBe(5);
		expect(result?.type).toBe("sub");
	});

	test("handles empty lastpost field", () => {
		const result = extractForum(forumRow({ 8: "" }), forumFields);
		expect(result).not.toBeNull();
		expect(result?.last_thread_id).toBe(0);
		expect(result?.last_post_at).toBe(0);
		expect(result?.last_poster).toBe("");
	});
});

// ─── parseMemberRow ───────────────────────────────────────────────────────────

describe("parseMemberRow", () => {
	// MEMBER_COLS: uid=0, status=4, avatarstatus=6, adminid=8, regdate=12, credits=13, freeze=22

	test("parses member row with all fields", () => {
		const r = row({
			0: "100", // uid
			4: "0", // status
			6: "1", // avatarstatus
			8: "1", // adminid
			12: "1500000000", // regdate
			13: "999", // credits
			22: "0", // freeze
		});
		const result = parseMemberRow(r);
		expect(result.uid).toBe(100);
		expect(result.data).toEqual({
			status: 0,
			avatarstatus: 1,
			adminid: 1,
			regdate: 1500000000,
			credits: 999,
			freeze: 0,
		});
	});

	test("defaults to 0 for missing/empty fields", () => {
		const r = row({ 0: "50" });
		const result = parseMemberRow(r);
		expect(result.uid).toBe(50);
		expect(result.data.status).toBe(0);
		expect(result.data.avatarstatus).toBe(0);
		expect(result.data.adminid).toBe(0);
		expect(result.data.credits).toBe(0);
	});
});

// ─── parseMemberCountRow ──────────────────────────────────────────────────────

describe("parseMemberCountRow", () => {
	// MEMBER_COUNT_COLS: uid=0, threads=2, posts=3

	test("parses count data", () => {
		const r = row({ 0: "200", 2: "15", 3: "350" });
		const result = parseMemberCountRow(r);
		expect(result.uid).toBe(200);
		expect(result.data).toEqual({ threads: 15, posts: 350 });
	});

	test("defaults to 0 for missing counts", () => {
		const r = row({ 0: "1" });
		const result = parseMemberCountRow(r);
		expect(result.data.threads).toBe(0);
		expect(result.data.posts).toBe(0);
	});
});

// ─── extractUser ──────────────────────────────────────────────────────────────

describe("extractUser", () => {
	// UC_MEMBER_COLS: uid=0, username=1, password=2, salt=3, email=4, lastlogintime=8
	function ucRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "100", // uid
			1: "testuser", // username
			2: "abc123hash", // password
			3: "x1y2z3", // salt
			4: "test@example.com", // email
			8: "1700000000", // lastlogintime
			...overrides,
		});
	}

	const defaultMember: MemberData = {
		status: 0,
		avatarstatus: 1,
		adminid: 0,
		regdate: 1500000000,
		credits: 100,
		freeze: 0,
	};

	const defaultCounts: MemberCountData = {
		threads: 5,
		posts: 50,
	};

	test("extracts active user with member + count data", () => {
		const result = extractUser(ucRow(), defaultMember, defaultCounts, false);
		expect(result.id).toBe(100);
		expect(result.username).toBe("testuser");
		expect(result.email).toBe("test@example.com");
		expect(result.password_hash).toBe("abc123hash");
		expect(result.password_salt).toBe("x1y2z3");
		expect(result.status).toBe(0);
		expect(result.role).toBe(0);
		expect(result.reg_date).toBe(1500000000);
		expect(result.last_login).toBe(1700000000);
		expect(result.threads).toBe(5);
		expect(result.posts).toBe(50);
		expect(result.credits).toBe(100);
	});

	test("avatar is set when avatarstatus=1", () => {
		const result = extractUser(ucRow(), defaultMember, defaultCounts, false);
		// getAvatarValue(100, 1) should return R2 key
		expect(result.avatar).toBe("avatars/100.jpg");
	});

	test("avatar is empty when avatarstatus=0", () => {
		const noAvatar = { ...defaultMember, avatarstatus: 0 };
		const result = extractUser(ucRow(), noAvatar, defaultCounts, false);
		expect(result.avatar).toBe("");
	});

	test("archived user gets status=-2", () => {
		const result = extractUser(ucRow(), defaultMember, defaultCounts, true);
		expect(result.status).toBe(-2);
	});

	test("frozen user gets status=-1", () => {
		const frozen = { ...defaultMember, freeze: 1 };
		const result = extractUser(ucRow(), frozen, defaultCounts, false);
		expect(result.status).toBe(-1);
	});

	test("no member data: status=0, role=0, empty avatar", () => {
		const result = extractUser(ucRow(), null, null, false);
		expect(result.status).toBe(0);
		expect(result.role).toBe(0);
		expect(result.avatar).toBe("");
		expect(result.reg_date).toBe(0);
		expect(result.threads).toBe(0);
		expect(result.posts).toBe(0);
		expect(result.credits).toBe(0);
	});

	test("admin user preserves adminid as role", () => {
		const admin = { ...defaultMember, adminid: 1 };
		const result = extractUser(ucRow(), admin, defaultCounts, false);
		expect(result.role).toBe(1);
	});

	test("archived overrides member freeze", () => {
		// Even if freeze=1, archived should win
		const frozen = { ...defaultMember, freeze: 1 };
		const result = extractUser(ucRow(), frozen, defaultCounts, true);
		expect(result.status).toBe(-2);
	});
});

// ─── extractThread ────────────────────────────────────────────────────────────

describe("extractThread", () => {
	// THREAD_COLS: tid=0, fid=1, posttableid=2, authorid=4, author=5, subject=6,
	//   dateline=7, lastpost=8, lastposter=9, views=10, replies=11, displayorder=12,
	//   digest=14, closed=15, special=17, highlight=19, recommend_add=21, recommend_sub=22
	function threadRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "1000", // tid
			1: "10", // fid
			2: "0", // posttableid
			4: "100", // authorid
			5: "testuser", // author
			6: "Hello World", // subject
			7: "1700000000", // dateline
			8: "1700001000", // lastpost
			9: "replier", // lastposter
			10: "500", // views
			11: "20", // replies
			12: "0", // displayorder (normal)
			14: "0", // digest
			15: "0", // closed
			17: "0", // special
			19: "0", // highlight
			21: "10", // recommend_add
			22: "3", // recommend_sub
			...overrides,
		});
	}

	test("extracts normal thread with all fields", () => {
		const result = extractThread(threadRow());
		expect(result).not.toBeNull();
		expect(result).toEqual({
			id: 1000,
			forum_id: 10,
			author_id: 100,
			author_name: "testuser",
			subject: "Hello World",
			created_at: 1700000000,
			last_post_at: 1700001000,
			last_poster: "replier",
			replies: 20,
			views: 500,
			closed: 0,
			sticky: 0,
			digest: 0,
			special: 0,
			highlight: 0,
			recommends: 7, // 10 - 3
			post_table_id: 0,
		});
	});

	test("filters hidden threads (displayorder < 0)", () => {
		expect(extractThread(threadRow({ 12: "-1" }))).toBeNull();
		expect(extractThread(threadRow({ 12: "-5" }))).toBeNull();
	});

	test("filters merged threads (closed > 1)", () => {
		expect(extractThread(threadRow({ 15: "2" }))).toBeNull();
		expect(extractThread(threadRow({ 15: "1000" }))).toBeNull();
	});

	test("keeps closed=0 and closed=1 threads", () => {
		expect(extractThread(threadRow({ 15: "0" }))).not.toBeNull();
		expect(extractThread(threadRow({ 15: "1" }))).not.toBeNull();
	});

	test("sticky thread (displayorder > 0)", () => {
		const result = extractThread(threadRow({ 12: "3" }));
		expect(result).not.toBeNull();
		expect(result?.sticky).toBe(3);
	});

	test("digest thread", () => {
		const result = extractThread(threadRow({ 14: "1" }));
		expect(result).not.toBeNull();
		expect(result?.digest).toBe(1);
	});

	test("recommends handles negative result", () => {
		const result = extractThread(threadRow({ 21: "2", 22: "5" }));
		expect(result).not.toBeNull();
		expect(result?.recommends).toBe(-3);
	});

	test("post_table_id maps correctly", () => {
		const result = extractThread(threadRow({ 2: "3" }));
		expect(result).not.toBeNull();
		expect(result?.post_table_id).toBe(3);
	});
});

// ─── extractPost ──────────────────────────────────────────────────────────────

describe("extractPost", () => {
	// POST_COLS: pid=0, fid=1, tid=2, first=3, author=4, authorid=5,
	//   dateline=7, message=8, invisible=12, position=16, bbcodeoff=19, htmlon=22
	function postRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "5000", // pid
			1: "10", // fid
			2: "1000", // tid
			3: "1", // first
			4: "testuser", // author
			5: "100", // authorid
			7: "1700000000", // dateline
			8: "Hello [b]world[/b]", // message
			12: "0", // invisible (visible)
			16: "1", // position
			19: "0", // bbcodeoff (BBCode enabled)
			22: "0", // htmlon (HTML disabled)
			...overrides,
		});
	}

	test("extracts visible post with BBCode conversion", () => {
		const result = extractPost(postRow());
		expect(result).not.toBeNull();
		expect(result?.id).toBe(5000);
		expect(result?.thread_id).toBe(1000);
		expect(result?.forum_id).toBe(10);
		expect(result?.author_id).toBe(100);
		expect(result?.author_name).toBe("testuser");
		expect(result?.content).toContain("<strong>world</strong>");
		expect(result?.created_at).toBe(1700000000);
		expect(result?.is_first).toBe(1);
		expect(result?.position).toBe(1);
	});

	test("filters invisible posts", () => {
		expect(extractPost(postRow({ 12: "1" }))).toBeNull();
		expect(extractPost(postRow({ 12: "-1" }))).toBeNull();
		expect(extractPost(postRow({ 12: "-5" }))).toBeNull();
	});

	test("stats: total incremented on success", () => {
		const stats: PostExtractionStats = {
			total: 0,
			filtered: 0,
			encodingRepaired: 0,
			bbcodeFailures: 0,
		};
		extractPost(postRow(), stats);
		expect(stats.total).toBe(1);
		expect(stats.filtered).toBe(0);
	});

	test("stats: filtered incremented on invisible", () => {
		const stats: PostExtractionStats = {
			total: 0,
			filtered: 0,
			encodingRepaired: 0,
			bbcodeFailures: 0,
		};
		extractPost(postRow({ 12: "1" }), stats);
		expect(stats.total).toBe(0);
		expect(stats.filtered).toBe(1);
	});

	test("bbcodeoff=1 disables BBCode parsing", () => {
		const result = extractPost(postRow({ 8: "[b]bold[/b]", 19: "1" }));
		expect(result).not.toBeNull();
		// With bbcodeoff, BBCode tags should be escaped not converted
		expect(result?.content).not.toContain("<strong>");
		expect(result?.content).toContain("[b]");
	});

	test("plain text message passes through", () => {
		const result = extractPost(postRow({ 8: "Just plain text" }));
		expect(result).not.toBeNull();
		expect(result?.content).toBe("Just plain text");
	});

	test("empty message produces empty content", () => {
		const result = extractPost(postRow({ 8: "" }));
		expect(result).not.toBeNull();
		expect(result?.content).toBe("");
	});

	test("non-first post has is_first=0", () => {
		const result = extractPost(postRow({ 3: "0" }));
		expect(result).not.toBeNull();
		expect(result?.is_first).toBe(0);
	});

	test("Chinese content passes through correctly", () => {
		const result = extractPost(postRow({ 8: "你好世界 [b]测试[/b]" }));
		expect(result).not.toBeNull();
		expect(result?.content).toContain("你好世界");
		expect(result?.content).toContain("<strong>测试</strong>");
	});
});

// ─── parseAttachmentIndex ─────────────────────────────────────────────────────

describe("parseAttachmentIndex", () => {
	// ATTACH_INDEX_COLS: aid=0, tid=1, pid=2, uid=3, tableid=4, downloads=5

	test("parses attachment index row", () => {
		const r = row({ 0: "300", 1: "1000", 2: "5000", 3: "100", 4: "2", 5: "42" });
		const result = parseAttachmentIndex(r);
		expect(result).toEqual({
			aid: 300,
			tid: 1000,
			pid: 5000,
			uid: 100,
			tableid: 2,
			downloads: 42,
		});
	});

	test("downloads defaults to 0", () => {
		const r = row({ 0: "1", 1: "1", 2: "1", 3: "1", 4: "0" });
		const result = parseAttachmentIndex(r);
		expect(result.downloads).toBe(0);
	});
});

// ─── extractAttachment ────────────────────────────────────────────────────────

describe("extractAttachment", () => {
	// ATTACH_SHARD_COLS: aid=0, tid=1, pid=2, uid=3, dateline=4, filename=5,
	//   filesize=6, attachment=7, isimage=10, width=12, thumb=13

	function shardRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "300", // aid
			1: "1000", // tid
			2: "5000", // pid
			3: "100", // uid
			4: "1700000000", // dateline
			5: "photo.jpg", // filename
			6: "102400", // filesize
			7: "forum/202301/01/photo.jpg", // attachment path
			10: "1", // isimage
			12: "800", // width
			13: "1", // thumb
			...overrides,
		});
	}

	const indexMap = new Map<number, AttachmentIndexData>();
	indexMap.set(300, {
		aid: 300,
		tid: 1000,
		pid: 5000,
		uid: 100,
		tableid: 2,
		downloads: 42,
	});

	test("extracts attachment with matching index data", () => {
		const result = extractAttachment(shardRow(), indexMap);
		expect(result).not.toBeNull();
		expect(result).toEqual({
			id: 300,
			thread_id: 1000,
			post_id: 5000,
			author_id: 100,
			filename: "photo.jpg",
			file_path: "attachments/forum/202301/01/photo.jpg",
			file_size: 102400,
			is_image: 1,
			width: 800,
			has_thumb: 1,
			downloads: 42,
			created_at: 1700000000,
		});
	});

	test("returns null when no matching index entry", () => {
		const result = extractAttachment(shardRow({ 0: "999" }), indexMap);
		expect(result).toBeNull();
	});

	test("empty attachment path produces empty file_path", () => {
		const result = extractAttachment(shardRow({ 7: "" }), indexMap);
		expect(result).not.toBeNull();
		expect(result?.file_path).toBe("");
	});

	test("non-image attachment", () => {
		const result = extractAttachment(shardRow({ 10: "0", 12: "0", 13: "0" }), indexMap);
		expect(result).not.toBeNull();
		expect(result?.is_image).toBe(0);
		expect(result?.width).toBe(0);
		expect(result?.has_thumb).toBe(0);
	});

	test("downloads come from index data, not shard data", () => {
		// Even though shard row doesn't have downloads, it comes from indexMap
		const result = extractAttachment(shardRow(), indexMap);
		expect(result).not.toBeNull();
		expect(result?.downloads).toBe(42);
	});
});
