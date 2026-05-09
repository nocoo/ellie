import { describe, expect, test, vi } from "vitest";
import { detectFormat, resolveSourceFiles } from "../src/extract/source-resolver";

// Mock existsSync to control which files "exist"
vi.mock("node:fs", () => ({
	existsSync: vi.fn((path: string) => mockExistingFiles.has(path)),
}));

let mockExistingFiles = new Set<string>();

function setExistingFiles(...paths: string[]): void {
	mockExistingFiles = new Set(paths);
}

// ─── detectFormat ─────────────────────────────────────────────────────────────

describe("detectFormat", () => {
	test("returns 'split' when forums.sql.gz and members.sql.gz exist", () => {
		setExistingFiles("src/forums.sql.gz", "src/members.sql.gz");
		expect(detectFormat("src")).toBe("split");
	});

	test("returns 'legacy' when only forums.sql.gz exists", () => {
		setExistingFiles("src/forums.sql.gz");
		expect(detectFormat("src")).toBe("legacy");
	});

	test("returns 'legacy' when only members.sql.gz exists", () => {
		setExistingFiles("src/members.sql.gz");
		expect(detectFormat("src")).toBe("legacy");
	});

	test("returns 'legacy' when neither file exists", () => {
		setExistingFiles();
		expect(detectFormat("src")).toBe("legacy");
	});
});

// ─── resolveSourceFiles (split format) ────────────────────────────────────────

describe("resolveSourceFiles — split format", () => {
	const DIR = "/data/split";

	test("returns split format when indicators exist", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.format).toBe("split");
	});

	test("resolves all required split-format paths", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		const result = resolveSourceFiles(DIR);

		expect(result.forums).toBe(`${DIR}/forums.sql.gz`);
		expect(result.attachments).toBe(`${DIR}/attachments.sql.gz`);
		expect(result.members).toBe(`${DIR}/members.sql.gz`);
		expect(result.ucMembers).toBe(`${DIR}/ucenter_members.sql.gz`);
		expect(result.memberCount).toBe(`${DIR}/member_count.sql.gz`);
		expect(result.usergroup).toBe(`${DIR}/usergroup.sql.gz`);
		expect(result.memberFieldForum).toBe(`${DIR}/member_field_forum.sql.gz`);
		expect(result.memberProfile).toBe(`${DIR}/member_profile.sql.gz`);
		expect(result.memberStatus).toBe(`${DIR}/member_status.sql.gz`);
	});

	test("threads and threadShards point to same file", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threads).toBe(`${DIR}/threads.sql.gz`);
		expect(result.threadShards).toBe(result.threads);
	});

	test("posts and postShards point to same file", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.posts).toBe(`${DIR}/posts.sql.gz`);
		expect(result.postShards).toBe(result.posts);
	});

	test("checkins resolves when checkins.sql.gz exists", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`, `${DIR}/checkins.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.checkins).toBe(`${DIR}/checkins.sql.gz`);
	});

	test("checkins is null when checkins.sql.gz is missing", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.checkins).toBeNull();
	});

	test("postcomments resolves when postcomment.sql.gz exists", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`, `${DIR}/postcomment.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.postcomments).toBe(`${DIR}/postcomment.sql.gz`);
	});

	test("postcomments is null when postcomment.sql.gz is missing", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.postcomments).toBeNull();
	});

	test("threadtype resolves from usergroup.sql.gz when it exists", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`, `${DIR}/usergroup.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threadtype).toBe(`${DIR}/usergroup.sql.gz`);
	});

	test("threadtype is null when usergroup.sql.gz is missing", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threadtype).toBeNull();
	});
});

// ─── resolveSourceFiles (legacy format) ───────────────────────────────────────

describe("resolveSourceFiles — legacy format", () => {
	const DIR = "/data/legacy";

	test("returns legacy format when split indicators are absent", () => {
		setExistingFiles();
		const result = resolveSourceFiles(DIR);
		expect(result.format).toBe("legacy");
	});

	test("forums, attachments, members all point to main_small.sql.gz", () => {
		setExistingFiles();
		const result = resolveSourceFiles(DIR);
		const main = `${DIR}/main_small.sql.gz`;
		expect(result.forums).toBe(main);
		expect(result.attachments).toBe(main);
		expect(result.members).toBe(main);
	});

	test("count, usergroup, fieldForum, profile, status point to user_extra.sql.gz", () => {
		setExistingFiles();
		const result = resolveSourceFiles(DIR);
		const extra = `${DIR}/user_extra.sql.gz`;
		expect(result.memberCount).toBe(extra);
		expect(result.usergroup).toBe(extra);
		expect(result.memberFieldForum).toBe(extra);
		expect(result.memberProfile).toBe(extra);
		expect(result.memberStatus).toBe(extra);
		expect(result.threadtype).toBe(extra);
	});

	test("ucMembers prefers ucenter.sql.gz over ucenter_members.sql.gz", () => {
		setExistingFiles(`${DIR}/ucenter.sql.gz`, `${DIR}/ucenter_members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.ucMembers).toBe(`${DIR}/ucenter.sql.gz`);
	});

	test("ucMembers falls back to ucenter_members.sql.gz", () => {
		setExistingFiles(`${DIR}/ucenter_members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.ucMembers).toBe(`${DIR}/ucenter_members.sql.gz`);
	});

	test("ucMembers returns preferred path when neither exists", () => {
		setExistingFiles();
		const result = resolveSourceFiles(DIR);
		expect(result.ucMembers).toBe(`${DIR}/ucenter.sql.gz`);
	});

	test("threads prefers thread.sql.gz over threads.sql.gz", () => {
		setExistingFiles(`${DIR}/thread.sql.gz`, `${DIR}/threads.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threads).toBe(`${DIR}/thread.sql.gz`);
	});

	test("threads falls back to threads.sql.gz", () => {
		setExistingFiles(`${DIR}/threads.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threads).toBe(`${DIR}/threads.sql.gz`);
	});

	test("threadShards prefers thread_shards.sql.gz", () => {
		setExistingFiles(`${DIR}/thread_shards.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threadShards).toBe(`${DIR}/thread_shards.sql.gz`);
	});

	test("posts prefers post_main.sql.gz", () => {
		setExistingFiles(`${DIR}/post_main.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.posts).toBe(`${DIR}/post_main.sql.gz`);
	});

	test("postShards prefers post_shards.sql.gz", () => {
		setExistingFiles(`${DIR}/post_shards.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.postShards).toBe(`${DIR}/post_shards.sql.gz`);
	});

	test("checkins is always null in legacy format", () => {
		setExistingFiles();
		const result = resolveSourceFiles(DIR);
		expect(result.checkins).toBeNull();
	});

	test("postcomments resolves when postcomment.sql.gz exists", () => {
		setExistingFiles(`${DIR}/postcomment.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.postcomments).toBe(`${DIR}/postcomment.sql.gz`);
	});

	test("postcomments is null when missing", () => {
		setExistingFiles();
		const result = resolveSourceFiles(DIR);
		expect(result.postcomments).toBeNull();
	});
});
