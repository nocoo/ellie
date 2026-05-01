import { describe, expect, test } from "vitest";
import {
	type AttachmentIndexData,
	type MemberCountData,
	type MemberData,
	type MemberFieldForumData,
	type PostExtractionStats,
	type ProfileData,
	type StatusData,
	type UsergroupData,
	extractAttachment,
	extractForum,
	extractPost,
	extractPostComment,
	extractThread,
	extractUser,
	parseAttachmentIndex,
	parseLastPost,
	parseMemberCountRow,
	parseMemberFieldForumRow,
	parseMemberRow,
	parseProfileRow,
	parseStatusRow,
	parseThreadTypeRow,
	parseUsergroupRow,
} from "../src/extract/extractors";
import type { ParsedRow } from "../src/extract/parser";

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
			lastThreadSubject: "Some subject",
		});
	});

	test("returns zeros for null input", () => {
		expect(parseLastPost(null)).toEqual({
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
			lastThreadSubject: "",
		});
	});

	test("returns zeros for empty string", () => {
		expect(parseLastPost("")).toEqual({
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
			lastThreadSubject: "",
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
	// FORUM_COLS: fid=0, fup=1, type=2, name=3, status=4, displayorder=5, threads=7, posts=8, lastpost=13
	const forumFields = new Map<number, { description: string; icon: string; moderators: string }>();
	forumFields.set(10, {
		description: "Test forum desc",
		icon: "icon.png",
		moderators: "mod1,mod2",
	});

	function forumRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "10", // fid
			1: "0", // fup
			2: "forum", // type
			3: "General Discussion", // name
			4: "1", // status (active)
			5: "1", // displayorder
			7: "100", // threads
			8: "500", // posts
			13: "42\tLast thread\t1700000000\tadmin", // lastpost
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
			moderators: "mod1,mod2",
			last_thread_id: 42,
			last_post_at: 1700000000,
			last_poster: "admin",
			last_thread_subject: "Last thread",
		});
	});

	test("preserves all status values (0=closed, 1=normal, 3=group)", () => {
		const closed = extractForum(forumRow({ 4: "0" }), forumFields);
		expect(closed).not.toBeNull();
		expect(closed?.status).toBe(0);

		const normal = extractForum(forumRow({ 4: "1" }), forumFields);
		expect(normal).not.toBeNull();
		expect(normal?.status).toBe(1);

		const group = extractForum(forumRow({ 4: "3" }), forumFields);
		expect(group).not.toBeNull();
		expect(group?.status).toBe(3);
	});

	test("filters out corrupt rows with fid=0", () => {
		expect(extractForum(forumRow({ 0: "0" }), forumFields)).toBeNull();
	});

	test("uses empty strings when forumFields has no entry", () => {
		const result = extractForum(forumRow({ 0: "999" }), forumFields);
		expect(result).not.toBeNull();
		expect(result?.description).toBe("");
		expect(result?.icon).toBe("");
		expect(result?.moderators).toBe("");
	});

	test("handles sub-forum type and parent_id", () => {
		const result = extractForum(forumRow({ 1: "5", 2: "sub" }), forumFields);
		expect(result).not.toBeNull();
		expect(result?.parent_id).toBe(5);
		expect(result?.type).toBe("sub");
	});

	test("handles empty lastpost field", () => {
		const result = extractForum(forumRow({ 13: "" }), forumFields);
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
			9: "9", // groupid
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
			groupid: 9,
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
	// MEMBER_COUNT_COLS: uid=0, posts=10, threads=11, digestposts=12, oltime=19

	test("parses count data", () => {
		const r = row({ 0: "200", 10: "350", 11: "15", 12: "3", 19: "1000" });
		const result = parseMemberCountRow(r);
		expect(result.uid).toBe(200);
		expect(result.data).toEqual({ threads: 15, posts: 350, digestposts: 3, oltime: 1000 });
	});

	test("defaults to 0 for missing counts", () => {
		const r = row({ 0: "1" });
		const result = parseMemberCountRow(r);
		expect(result.data.threads).toBe(0);
		expect(result.data.posts).toBe(0);
		expect(result.data.digestposts).toBe(0);
		expect(result.data.oltime).toBe(0);
	});
});

// ─── extractUser ──────────────────────────────────────────────────────────────

describe("extractUser", () => {
	// UC_MEMBER_COLS: uid=0, username=1, password=2, email=3, lastlogintime=9, salt=10
	function ucRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "100", // uid
			1: "testuser", // username
			2: "abc123hash", // password
			3: "test@example.com", // email
			9: "1700000000", // lastlogintime
			10: "x1y2z3", // salt
			...overrides,
		});
	}

	const defaultMember: MemberData = {
		status: 0,
		avatarstatus: 1,
		adminid: 0,
		groupid: 0,
		regdate: 1500000000,
		credits: 100,
		freeze: 0,
	};

	const defaultCounts: MemberCountData = {
		threads: 5,
		posts: 50,
		digestposts: 0,
		oltime: 0,
	};

	test("extracts active user with member + count data", () => {
		const result = extractUser(ucRow(), defaultMember, defaultCounts, false);
		expect(result.id).toBe(100);
		expect(result.username).toBe("testuser");
		expect(result.email).toBe("");
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

	test("drops legacy email so users must verify a new address", () => {
		const result = extractUser(
			ucRow({ 3: "legacy-user@example.com" }),
			defaultMember,
			defaultCounts,
			false,
		);
		expect(result.email).toBe("");
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
	// THREAD_COLS: tid=0, fid=1, posttableid=2, author=7, authorid=8, subject=9,
	//   dateline=10, lastpost=11, lastposter=12, views=13, replies=14, displayorder=15,
	//   highlight=16, digest=17, special=19, closed=22, recommend_add=25, recommend_sub=26
	function threadRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "1000", // tid
			1: "10", // fid
			2: "0", // posttableid
			7: "testuser", // author
			8: "100", // authorid
			9: "Hello World", // subject
			10: "1700000000", // dateline
			11: "1700001000", // lastpost
			12: "replier", // lastposter
			13: "500", // views
			14: "20", // replies
			15: "0", // displayorder (normal)
			16: "0", // highlight
			17: "0", // digest
			19: "0", // special
			22: "0", // closed
			25: "10", // recommend_add
			26: "3", // recommend_sub
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
			type_name: "",
		});
	});

	test("keeps hidden threads (displayorder < 0) with correct sticky value", () => {
		const hidden1 = extractThread(threadRow({ 15: "-1" }));
		expect(hidden1).not.toBeNull();
		expect(hidden1?.sticky).toBe(-1);

		const hidden5 = extractThread(threadRow({ 15: "-5" }));
		expect(hidden5).not.toBeNull();
		expect(hidden5?.sticky).toBe(-5);
	});

	test("keeps merged threads (closed > 1) with correct closed value", () => {
		const merged2 = extractThread(threadRow({ 22: "2" }));
		expect(merged2).not.toBeNull();
		expect(merged2?.closed).toBe(2);

		const merged1000 = extractThread(threadRow({ 22: "1000" }));
		expect(merged1000).not.toBeNull();
		expect(merged1000?.closed).toBe(1000);
	});

	test("keeps closed=0 and closed=1 threads", () => {
		expect(extractThread(threadRow({ 22: "0" }))).not.toBeNull();
		expect(extractThread(threadRow({ 22: "1" }))).not.toBeNull();
	});

	test("sticky thread (displayorder > 0)", () => {
		const result = extractThread(threadRow({ 15: "3" }));
		expect(result).not.toBeNull();
		expect(result?.sticky).toBe(3);
	});

	test("digest thread", () => {
		const result = extractThread(threadRow({ 17: "1" }));
		expect(result).not.toBeNull();
		expect(result?.digest).toBe(1);
	});

	test("recommends handles negative result", () => {
		const result = extractThread(threadRow({ 25: "2", 26: "5" }));
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
	//   dateline=7, message=8, invisible=11, htmlon=14, bbcodeoff=15, position=25
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
			11: "0", // invisible (visible)
			14: "0", // htmlon (HTML disabled)
			15: "0", // bbcodeoff (BBCode enabled)
			25: "1", // position
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

	test("keeps invisible posts with invisible value passed through", () => {
		const invisible1 = extractPost(postRow({ 11: "1" }));
		expect(invisible1).not.toBeNull();
		expect(invisible1?.invisible).toBe(1);

		const invisibleNeg1 = extractPost(postRow({ 11: "-1" }));
		expect(invisibleNeg1).not.toBeNull();
		expect(invisibleNeg1?.invisible).toBe(-1);

		const invisibleNeg5 = extractPost(postRow({ 11: "-5" }));
		expect(invisibleNeg5).not.toBeNull();
		expect(invisibleNeg5?.invisible).toBe(-5);
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

	test("bbcodeoff=1 disables BBCode parsing", () => {
		const result = extractPost(postRow({ 8: "[b]bold[/b]", 15: "1" }));
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

	test("onEncodingFailure callback fires on repaired encoding", () => {
		// Create a message with GBK mojibake pattern (common: 鎴 = UTF-8 bytes of 我 read as GBK then back)
		// Use a known mojibake pattern that validateEncoding will detect and repair
		const mojibake = Buffer.from([0xc3, 0xa6, 0xc2, 0x88, 0xc2, 0x91]).toString("utf-8");
		const failures: Array<{ pid: number; issue: string }> = [];
		const stats: PostExtractionStats = {
			total: 0,
			filtered: 0,
			encodingRepaired: 0,
			bbcodeFailures: 0,
			onEncodingFailure: (pid, issue) => failures.push({ pid, issue }),
		};
		extractPost(postRow({ 0: "42", 8: mojibake }), stats);
		if (stats.encodingRepaired > 0) {
			// If encoding was actually repaired, callback should have fired
			expect(failures.length).toBe(1);
			expect(failures[0].pid).toBe(42);
		}
		// Either way, the counter and callback should be consistent
		expect(failures.length).toBe(stats.encodingRepaired);
	});

	test("onBbcodeFailure and onEncodingFailure callbacks are optional", () => {
		// Should not throw when callbacks are not provided
		const stats: PostExtractionStats = {
			total: 0,
			filtered: 0,
			encodingRepaired: 0,
			bbcodeFailures: 0,
		};
		const result = extractPost(postRow(), stats);
		expect(result).not.toBeNull();
	});
});

// ─── parseAttachmentIndex ─────────────────────────────────────────────────────

describe("parseAttachmentIndex", () => {
	// ATTACH_INDEX_COLS: aid=0, tid=1, pid=2, downloads=3, uid=4, tableid=5

	test("parses attachment index row", () => {
		const r = row({ 0: "300", 1: "1000", 2: "5000", 3: "42", 4: "100", 5: "2" });
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
		const r = row({ 0: "1", 1: "1", 2: "1", 4: "1", 5: "0" });
		const result = parseAttachmentIndex(r);
		expect(result.downloads).toBe(0);
	});
});

// ─── extractAttachment ────────────────────────────────────────────────────────

describe("extractAttachment", () => {
	// ATTACH_SHARD_COLS: aid=0, tid=1, pid=2, uid=3, dateline=4, filename=5,
	//   filesize=6, attachment=7, isimage=12, width=13, thumb=14

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
			12: "1", // isimage
			13: "800", // width
			14: "1", // thumb
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
		const result = extractAttachment(shardRow({ 12: "0", 13: "0", 14: "0" }), indexMap);
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

// ─── parseMemberFieldForumRow ────────────────────────────────────────────────

describe("parseMemberFieldForumRow", () => {
	test("parses field forum data", () => {
		const r = row({ 0: "100", 3: "Custom Title", 5: "<b>sig</b>" });
		const result = parseMemberFieldForumRow(r);
		expect(result.uid).toBe(100);
		expect(result.data).toEqual({
			customstatus: "Custom Title",
			sightml: "<b>sig</b>",
		});
	});

	test("defaults to empty strings for missing fields", () => {
		const r = row({ 0: "50" });
		const result = parseMemberFieldForumRow(r);
		expect(result.uid).toBe(50);
		expect(result.data.customstatus).toBe("");
		expect(result.data.sightml).toBe("");
	});
});

// ─── parseProfileRow ─────────────────────────────────────────────────────────

describe("parseProfileRow", () => {
	test("parses profile with all fields", () => {
		const r = row({
			0: "100",
			2: "1", // gender
			3: "1990", // birthyear
			4: "6", // birthmonth
			5: "15", // birthday
			17: "北京", // resideprovince
			18: "海淀", // residecity
			22: "清华大学", // graduateschool
			35: "12345", // qq
			39: "https://example.com", // site
			40: "Hello world", // bio
			41: "Coding", // interest
			42: "Main Campus", // field1 (campus)
		});
		const result = parseProfileRow(r);
		expect(result.uid).toBe(100);
		expect(result.data).toEqual({
			gender: 1,
			birthyear: 1990,
			birthmonth: 6,
			birthday: 15,
			resideprovince: "北京",
			residecity: "海淀",
			graduateschool: "清华大学",
			bio: "Hello world",
			interest: "Coding",
			qq: "12345",
			site: "https://example.com",
			campus: "Main Campus",
		});
	});

	test("defaults to empty/zero for missing fields", () => {
		const r = row({ 0: "50" });
		const result = parseProfileRow(r);
		expect(result.data.gender).toBe(0);
		expect(result.data.resideprovince).toBe("");
		expect(result.data.campus).toBe("");
	});
});

// ─── parseStatusRow ──────────────────────────────────────────────────────────

describe("parseStatusRow", () => {
	test("parses status data", () => {
		const r = row({ 0: "100", 1: "192.168.1.1", 2: "10.0.0.1", 5: "1700000000" });
		const result = parseStatusRow(r);
		expect(result.uid).toBe(100);
		expect(result.data).toEqual({
			regip: "192.168.1.1",
			lastip: "10.0.0.1",
			lastactivity: 1700000000,
		});
	});

	test("defaults to empty/zero for missing fields", () => {
		const r = row({ 0: "50" });
		const result = parseStatusRow(r);
		expect(result.data.regip).toBe("");
		expect(result.data.lastip).toBe("");
		expect(result.data.lastactivity).toBe(0);
	});
});

// ─── parseUsergroupRow ───────────────────────────────────────────────────────

describe("parseUsergroupRow", () => {
	test("parses usergroup data", () => {
		const r = row({ 0: "5", 4: "管理员", 7: "3", 8: "#ff0000" });
		const result = parseUsergroupRow(r);
		expect(result.groupid).toBe(5);
		expect(result.data).toEqual({
			grouptitle: "管理员",
			stars: 3,
			color: "#ff0000",
		});
	});

	test("defaults for missing fields", () => {
		const r = row({ 0: "1" });
		const result = parseUsergroupRow(r);
		expect(result.data.grouptitle).toBe("");
		expect(result.data.stars).toBe(0);
		expect(result.data.color).toBe("");
	});
});

// ─── parseThreadTypeRow ──────────────────────────────────────────────────────

describe("parseThreadTypeRow", () => {
	test("parses thread type", () => {
		const r = row({ 0: "3", 3: "讨论" });
		const result = parseThreadTypeRow(r);
		expect(result).toEqual({ typeid: 3, name: "讨论" });
	});

	test("defaults name to empty string", () => {
		const r = row({ 0: "1" });
		const result = parseThreadTypeRow(r);
		expect(result.name).toBe("");
	});
});

// ─── extractThread with threadTypeMap ────────────────────────────────────────

describe("extractThread with threadTypeMap", () => {
	function threadRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "1000",
			1: "10",
			2: "0",
			3: "5", // typeid
			7: "testuser",
			8: "100",
			9: "Hello World",
			10: "1700000000",
			11: "1700001000",
			12: "replier",
			13: "500",
			14: "20",
			15: "0",
			16: "0",
			17: "0",
			19: "0",
			22: "0",
			25: "10",
			26: "3",
			...overrides,
		});
	}

	const typeMap = new Map<number, string>();
	typeMap.set(5, "讨论");

	test("resolves typeid to type_name", () => {
		const result = extractThread(threadRow(), typeMap);
		expect(result?.type_name).toBe("讨论");
	});

	test("returns empty string for unknown typeid", () => {
		const result = extractThread(threadRow({ 3: "99" }), typeMap);
		expect(result?.type_name).toBe("");
	});

	test("returns empty string when typeid is 0", () => {
		const result = extractThread(threadRow({ 3: "0" }), typeMap);
		expect(result?.type_name).toBe("");
	});
});

// ─── extractUser with extras ─────────────────────────────────────────────────

describe("extractUser with extras", () => {
	function ucRow(overrides: Record<number, string> = {}): ParsedRow {
		return row({
			0: "100",
			1: "testuser",
			2: "abc123hash",
			3: "test@example.com",
			9: "1700000000",
			10: "x1y2z3",
			...overrides,
		});
	}

	const member: MemberData = {
		status: 0,
		avatarstatus: 1,
		adminid: 0,
		groupid: 5,
		regdate: 1500000000,
		credits: 100,
		freeze: 0,
	};

	const counts: MemberCountData = {
		threads: 5,
		posts: 50,
		digestposts: 3,
		oltime: 1000,
	};

	const fieldForum: MemberFieldForumData = {
		customstatus: "Custom Title",
		sightml: "<b>My Sig</b>",
	};

	const profile: ProfileData = {
		gender: 1,
		birthyear: 1990,
		birthmonth: 6,
		birthday: 15,
		resideprovince: "北京",
		residecity: "海淀",
		graduateschool: "清华",
		bio: "Hello",
		interest: "Coding",
		qq: "12345",
		site: "https://example.com",
		campus: "Main",
	};

	const status: StatusData = {
		lastactivity: 1700000000,
		regip: "192.168.1.1",
		lastip: "10.0.0.1",
	};

	const usergroup: UsergroupData = {
		grouptitle: "管理员",
		stars: 3,
		color: "#ff0000",
	};

	test("includes extras when provided", () => {
		const result = extractUser(ucRow(), member, counts, false, {
			fieldForum,
			profile,
			status,
			usergroup,
		});
		expect(result.signature).toBe("<b>My Sig</b>");
		expect(result.custom_title).toBe("Custom Title");
		expect(result.group_title).toBe("管理员");
		expect(result.group_stars).toBe(3);
		expect(result.group_color).toBe("#ff0000");
		expect(result.digest_posts).toBe(3);
		expect(result.ol_time).toBe(1000);
		expect(result.gender).toBe(1);
		expect(result.birth_year).toBe(1990);
		expect(result.reside_province).toBe("北京");
		expect(result.campus).toBe("Main");
		expect(result.last_activity).toBe(1700000000);
		expect(result.reg_ip).toBe("192.168.1.1");
		expect(result.last_ip).toBe("10.0.0.1");
	});

	test("defaults extras fields when not provided", () => {
		const result = extractUser(ucRow(), member, counts, false);
		expect(result.signature).toBe("");
		expect(result.custom_title).toBe("");
		expect(result.group_title).toBe("");
		expect(result.group_stars).toBe(0);
		expect(result.group_color).toBe("");
		expect(result.gender).toBe(0);
		expect(result.last_activity).toBe(0);
		expect(result.reg_ip).toBe("");
	});
});

// ─── extractPostComment ──────────────────────────────────────────────────────

describe("extractPostComment", () => {
	test("extracts post comment with all fields", () => {
		const r = row({
			0: "500", // id
			1: "1000", // tid
			2: "5000", // pid
			3: "commenter", // author
			4: "200", // authorid
			5: "1700000000", // dateline
			6: "Great post!", // comment
			7: "5", // score
			8: "192.168.1.1", // useip
			10: "5001", // rpid
		});
		const result = extractPostComment(r);
		expect(result).not.toBeNull();
		expect(result).toEqual({
			id: 500,
			thread_id: 1000,
			post_id: 5000,
			author_id: 200,
			author_name: "commenter",
			content: "Great post!",
			score: 5,
			reply_post_id: 5001,
			ip: "192.168.1.1",
			created_at: 1700000000,
		});
	});

	test("returns null for corrupt row (id=0)", () => {
		const r = row({ 0: "0" });
		expect(extractPostComment(r)).toBeNull();
	});

	test("defaults optional fields", () => {
		const r = row({ 0: "1", 1: "1", 2: "1" });
		const result = extractPostComment(r);
		expect(result).not.toBeNull();
		expect(result?.score).toBe(0);
		expect(result?.reply_post_id).toBe(0);
		expect(result?.ip).toBe("");
	});
});
