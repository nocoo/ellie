import { describe, expect, test, vi } from "vitest";
import {
	detectFormat,
	resolveSourceFiles,
	validateRequiredFiles,
} from "../src/extract/source-resolver";

// Mock existsSync to control which files "exist"
vi.mock("node:fs", () => ({
	existsSync: vi.fn((path: string) => mockExistingFiles.has(path)),
}));

let mockExistingFiles = new Set<string>();

function setExistingFiles(...paths: string[]): void {
	mockExistingFiles = new Set(paths);
}

/** All required split-format files for a given directory. */
function allSplitFiles(dir: string): string[] {
	return [
		`${dir}/forums.sql.gz`,
		`${dir}/attachments.sql.gz`,
		`${dir}/members.sql.gz`,
		`${dir}/ucenter_members.sql.gz`,
		`${dir}/member_count.sql.gz`,
		`${dir}/usergroup.sql.gz`,
		`${dir}/member_field_forum.sql.gz`,
		`${dir}/member_profile.sql.gz`,
		`${dir}/member_status.sql.gz`,
		`${dir}/threads.sql.gz`,
		`${dir}/posts.sql.gz`,
	];
}

/** All required legacy-format files for a given directory. */
function allLegacyFiles(dir: string): string[] {
	return [`${dir}/main_small.sql.gz`, `${dir}/user_extra.sql.gz`];
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

// ─── validateRequiredFiles ────────────────────────────────────────────────────

describe("validateRequiredFiles", () => {
	const DIR = "/data/validate";

	test("passes when all split required files exist", () => {
		setExistingFiles(...allSplitFiles(DIR));
		expect(() => validateRequiredFiles(DIR, "split")).not.toThrow();
	});

	test("throws when split is missing ucenter_members.sql.gz", () => {
		const files = allSplitFiles(DIR).filter((f) => !f.includes("ucenter_members"));
		setExistingFiles(...files);
		expect(() => validateRequiredFiles(DIR, "split")).toThrow("ucenter_members.sql.gz");
	});

	test("throws when split is missing posts.sql.gz", () => {
		const files = allSplitFiles(DIR).filter((f) => !f.includes("posts.sql.gz"));
		setExistingFiles(...files);
		expect(() => validateRequiredFiles(DIR, "split")).toThrow("posts.sql.gz");
	});

	test("throws when split is missing attachments.sql.gz", () => {
		const files = allSplitFiles(DIR).filter((f) => !f.includes("attachments.sql.gz"));
		setExistingFiles(...files);
		expect(() => validateRequiredFiles(DIR, "split")).toThrow("attachments.sql.gz");
	});

	test("lists all missing files in error message", () => {
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		expect(() => validateRequiredFiles(DIR, "split")).toThrow(
			/Missing required split-format files.*ucenter_members\.sql\.gz.*posts\.sql\.gz/,
		);
	});

	test("includes directory in error message", () => {
		setExistingFiles();
		expect(() => validateRequiredFiles(DIR, "split")).toThrow(DIR);
	});

	test("passes when all legacy required files exist", () => {
		setExistingFiles(...allLegacyFiles(DIR));
		expect(() => validateRequiredFiles(DIR, "legacy")).not.toThrow();
	});

	test("throws when legacy is missing main_small.sql.gz", () => {
		setExistingFiles(`${DIR}/user_extra.sql.gz`);
		expect(() => validateRequiredFiles(DIR, "legacy")).toThrow("main_small.sql.gz");
	});

	test("throws when legacy is missing user_extra.sql.gz", () => {
		setExistingFiles(`${DIR}/main_small.sql.gz`);
		expect(() => validateRequiredFiles(DIR, "legacy")).toThrow("user_extra.sql.gz");
	});
});

// ─── resolveSourceFiles (split format) ────────────────────────────────────────

describe("resolveSourceFiles — split format", () => {
	const DIR = "/data/split";

	test("returns split format when all required files exist", () => {
		setExistingFiles(...allSplitFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.format).toBe("split");
	});

	test("throws when split required files are incomplete", () => {
		// Only format indicators but not all required
		setExistingFiles(`${DIR}/forums.sql.gz`, `${DIR}/members.sql.gz`);
		expect(() => resolveSourceFiles(DIR)).toThrow("Missing required split-format files");
	});

	test("resolves all required split-format paths", () => {
		setExistingFiles(...allSplitFiles(DIR));
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
		setExistingFiles(...allSplitFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.threads).toBe(`${DIR}/threads.sql.gz`);
		expect(result.threadShards).toBe(result.threads);
	});

	test("posts and postShards point to same file", () => {
		setExistingFiles(...allSplitFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.posts).toBe(`${DIR}/posts.sql.gz`);
		expect(result.postShards).toBe(result.posts);
	});

	test("checkins resolves when checkins.sql.gz exists", () => {
		setExistingFiles(...allSplitFiles(DIR), `${DIR}/checkins.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.checkins).toBe(`${DIR}/checkins.sql.gz`);
	});

	test("checkins is null when checkins.sql.gz is missing", () => {
		setExistingFiles(...allSplitFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.checkins).toBeNull();
	});

	test("postcomments resolves when postcomment.sql.gz exists", () => {
		setExistingFiles(...allSplitFiles(DIR), `${DIR}/postcomment.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.postcomments).toBe(`${DIR}/postcomment.sql.gz`);
	});

	test("postcomments is null when postcomment.sql.gz is missing", () => {
		setExistingFiles(...allSplitFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.postcomments).toBeNull();
	});

	test("threadtype resolves from threadtype.sql.gz when it exists", () => {
		setExistingFiles(...allSplitFiles(DIR), `${DIR}/threadtype.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threadtype).toBe(`${DIR}/threadtype.sql.gz`);
	});

	test("threadtype is null when threadtype.sql.gz is missing", () => {
		setExistingFiles(...allSplitFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.threadtype).toBeNull();
	});

	test("threadtype does NOT point to usergroup.sql.gz", () => {
		// usergroup.sql.gz exists but does NOT contain pre_forum_threadtype
		setExistingFiles(...allSplitFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.threadtype).not.toBe(`${DIR}/usergroup.sql.gz`);
	});
});

// ─── resolveSourceFiles (legacy format) ───────────────────────────────────────

describe("resolveSourceFiles — legacy format", () => {
	const DIR = "/data/legacy";

	test("returns legacy format when split indicators are absent", () => {
		setExistingFiles(...allLegacyFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.format).toBe("legacy");
	});

	test("throws when legacy required files are missing", () => {
		setExistingFiles();
		expect(() => resolveSourceFiles(DIR)).toThrow("Missing required legacy-format files");
	});

	test("forums, attachments, members all point to main_small.sql.gz", () => {
		setExistingFiles(...allLegacyFiles(DIR));
		const result = resolveSourceFiles(DIR);
		const main = `${DIR}/main_small.sql.gz`;
		expect(result.forums).toBe(main);
		expect(result.attachments).toBe(main);
		expect(result.members).toBe(main);
	});

	test("count, usergroup, fieldForum, profile, status point to user_extra.sql.gz", () => {
		setExistingFiles(...allLegacyFiles(DIR));
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
		setExistingFiles(
			...allLegacyFiles(DIR),
			`${DIR}/ucenter.sql.gz`,
			`${DIR}/ucenter_members.sql.gz`,
		);
		const result = resolveSourceFiles(DIR);
		expect(result.ucMembers).toBe(`${DIR}/ucenter.sql.gz`);
	});

	test("ucMembers falls back to ucenter_members.sql.gz", () => {
		setExistingFiles(...allLegacyFiles(DIR), `${DIR}/ucenter_members.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.ucMembers).toBe(`${DIR}/ucenter_members.sql.gz`);
	});

	test("ucMembers returns preferred path when neither exists", () => {
		setExistingFiles(...allLegacyFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.ucMembers).toBe(`${DIR}/ucenter.sql.gz`);
	});

	test("threads prefers thread.sql.gz over threads.sql.gz", () => {
		setExistingFiles(...allLegacyFiles(DIR), `${DIR}/thread.sql.gz`, `${DIR}/threads.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threads).toBe(`${DIR}/thread.sql.gz`);
	});

	test("threads falls back to threads.sql.gz", () => {
		setExistingFiles(...allLegacyFiles(DIR), `${DIR}/threads.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threads).toBe(`${DIR}/threads.sql.gz`);
	});

	test("threadShards prefers thread_shards.sql.gz", () => {
		setExistingFiles(...allLegacyFiles(DIR), `${DIR}/thread_shards.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.threadShards).toBe(`${DIR}/thread_shards.sql.gz`);
	});

	test("posts prefers post_main.sql.gz", () => {
		setExistingFiles(...allLegacyFiles(DIR), `${DIR}/post_main.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.posts).toBe(`${DIR}/post_main.sql.gz`);
	});

	test("postShards prefers post_shards.sql.gz", () => {
		setExistingFiles(...allLegacyFiles(DIR), `${DIR}/post_shards.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.postShards).toBe(`${DIR}/post_shards.sql.gz`);
	});

	test("checkins is always null in legacy format", () => {
		setExistingFiles(...allLegacyFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.checkins).toBeNull();
	});

	test("postcomments resolves when postcomment.sql.gz exists", () => {
		setExistingFiles(...allLegacyFiles(DIR), `${DIR}/postcomment.sql.gz`);
		const result = resolveSourceFiles(DIR);
		expect(result.postcomments).toBe(`${DIR}/postcomment.sql.gz`);
	});

	test("postcomments is null when missing", () => {
		setExistingFiles(...allLegacyFiles(DIR));
		const result = resolveSourceFiles(DIR);
		expect(result.postcomments).toBeNull();
	});
});
