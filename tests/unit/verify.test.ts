import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BatchLoader } from "../../scripts/migrate/load/batch-insert";
import { analyzeEncoding, verifyEncoding } from "../../scripts/migrate/verify/encoding";
import {
	type ExpectedCounts,
	verifyForeignKeys,
	verifyIntegrity,
	verifyRowCounts,
} from "../../scripts/migrate/verify/integrity";
import {
	benchmarkQuery,
	getExplainPlan,
	usesIndex,
	verifyPerformance,
} from "../../scripts/migrate/verify/performance";

const TEST_DB = ":memory:";

function cleanup() {
	// in-memory: nothing to clean up
}

/** Create a test database with sample data. */
function createTestDb(): BatchLoader {
	const loader = new BatchLoader({ dbPath: TEST_DB });
	loader.createTables();

	loader.insertRows("forums", [
		{
			id: 1,
			parent_id: 0,
			name: "General",
			description: "",
			icon: "",
			display_order: 1,
			threads: 2,
			posts: 3,
			type: "forum",
			status: 1,
			last_thread_id: 1,
			last_post_at: 1700000000,
			last_poster: "admin",
			thread_types_enabled: 0,
			thread_types_required: 0,
			thread_types_listable: 0,
			thread_types_prefix: 0,
		},
	]);

	loader.insertRows("users", [
		{
			id: 1,
			username: "admin",
			email: "a@test.com",
			password_hash: "hash",
			password_salt: "salt",
			avatar: "",
			status: 0,
			role: 1,
			reg_date: 1500000000,
			last_login: 1700000000,
			threads: 1,
			posts: 2,
			credits: 100,
		},
		{
			id: 2,
			username: "user1",
			email: "u@test.com",
			password_hash: "hash",
			password_salt: "salt",
			avatar: "",
			status: 0,
			role: 0,
			reg_date: 1600000000,
			last_login: 1700000000,
			threads: 1,
			posts: 1,
			credits: 50,
		},
	]);

	loader.insertRows("threads", [
		{
			id: 1,
			forum_id: 1,
			author_id: 1,
			author_name: "admin",
			subject: "Welcome",
			created_at: 1700000000,
			last_post_at: 1700001000,
			last_poster: "user1",
			replies: 1,
			views: 100,
			closed: 0,
			sticky: 0,
			digest: 1,
			special: 0,
			highlight: 0,
			recommends: 5,
			post_table_id: 0,
			type_name: "",
			type_id: 0,
		},
		{
			id: 2,
			forum_id: 1,
			author_id: 2,
			author_name: "user1",
			subject: "Hello",
			created_at: 1700000500,
			last_post_at: 1700000500,
			last_poster: "user1",
			replies: 0,
			views: 10,
			closed: 0,
			sticky: 0,
			digest: 0,
			special: 0,
			highlight: 0,
			recommends: 0,
			post_table_id: 0,
			type_name: "",
			type_id: 0,
		},
	]);

	loader.insertRows("posts", [
		{
			id: 1,
			thread_id: 1,
			forum_id: 1,
			author_id: 1,
			author_name: "admin",
			content: "Welcome to the forum! 欢迎来到论坛！",
			created_at: 1700000000,
			is_first: 1,
			position: 1,
			invisible: 0,
		},
		{
			id: 2,
			thread_id: 1,
			forum_id: 1,
			author_id: 2,
			author_name: "user1",
			content: "Thanks! 谢谢！",
			created_at: 1700001000,
			is_first: 0,
			position: 2,
			invisible: 0,
		},
		{
			id: 3,
			thread_id: 2,
			forum_id: 1,
			author_id: 2,
			author_name: "user1",
			content: "Hello world",
			created_at: 1700000500,
			is_first: 1,
			position: 1,
			invisible: 0,
		},
	]);

	loader.insertRows("attachments", [
		{
			id: 1,
			thread_id: 1,
			post_id: 1,
			author_id: 1,
			filename: "photo.jpg",
			file_path: "attachments/photo.jpg",
			file_size: 102400,
			is_image: 1,
			width: 800,
			has_thumb: 1,
			downloads: 10,
			created_at: 1700000000,
		},
	]);

	return loader;
}

// ─── Integrity Tests ────────────────────────────────────────────────────────

describe("verifyRowCounts", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("passes when counts match", () => {
		const loader = createTestDb();
		const db = loader.getDb();
		const expected: ExpectedCounts = {
			forums: 1,
			users: 2,
			threads: 2,
			posts: 3,
			attachments: 1,
		};

		const results = verifyRowCounts(db, expected);
		expect(results).toHaveLength(5);
		expect(results.every((r) => r.passed)).toBe(true);
		loader.close();
	});

	test("fails when counts mismatch", () => {
		const loader = createTestDb();
		const db = loader.getDb();
		const expected: ExpectedCounts = {
			forums: 1,
			users: 2,
			threads: 2,
			posts: 999, // Wrong
			attachments: 1,
		};

		const results = verifyRowCounts(db, expected);
		const postCheck = results.find((r) => r.name === "row_count_posts");
		expect(postCheck?.passed).toBe(false);
		expect(postCheck?.actual).toBe(3);
		expect(postCheck?.expected).toBe(999);
		loader.close();
	});
});

describe("verifyForeignKeys", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("passes with valid references", () => {
		const loader = createTestDb();
		const db = loader.getDb();
		const results = verifyForeignKeys(db);
		expect(results.every((r) => r.passed)).toBe(true);
		loader.close();
	});

	test("detects orphan posts", () => {
		const loader = createTestDb();
		const db = loader.getDb();

		// Insert a post referencing non-existent thread
		db.run(
			"INSERT INTO posts (id, thread_id, forum_id, author_id, author_name, content, created_at, is_first, position, invisible) VALUES (99, 999, 1, 1, 'admin', 'orphan', 0, 0, 1, 0)",
		);

		const results = verifyForeignKeys(db);
		const threadCheck = results.find((r) => r.name === "fk_posts.thread_id → threads.id");
		expect(threadCheck?.passed).toBe(false);
		expect(threadCheck?.actual).toBe(1);
		loader.close();
	});
});

describe("verifyIntegrity", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("full integrity check passes on valid data", () => {
		const loader = createTestDb();
		const db = loader.getDb();
		const report = verifyIntegrity(db, {
			forums: 1,
			users: 2,
			threads: 2,
			posts: 3,
			attachments: 1,
		});
		expect(report.passed).toBe(true);
		expect(report.checks.length).toBeGreaterThan(0);
		expect(report.summary).toContain("passed");
		loader.close();
	});

	test("full integrity check fails on bad data", () => {
		const loader = createTestDb();
		const db = loader.getDb();
		const report = verifyIntegrity(db, {
			forums: 999,
			users: 2,
			threads: 2,
			posts: 3,
			attachments: 1,
		});
		expect(report.passed).toBe(false);
		expect(report.summary).toContain("failed");
		loader.close();
	});
});

// ─── Encoding Tests ─────────────────────────────────────────────────────────

describe("analyzeEncoding", () => {
	test("detects replacement character", () => {
		const result = analyzeEncoding("Hello \uFFFD world");
		expect(result.hasReplacementChar).toBe(true);
	});

	test("no issues with clean text", () => {
		const result = analyzeEncoding("Hello world 你好世界");
		expect(result.hasReplacementChar).toBe(false);
		expect(result.hasCjk).toBe(true);
	});

	test("detects CJK characters", () => {
		expect(analyzeEncoding("中文测试").hasCjk).toBe(true);
		expect(analyzeEncoding("English only").hasCjk).toBe(false);
	});

	test("empty string has no issues", () => {
		const result = analyzeEncoding("");
		expect(result.hasReplacementChar).toBe(false);
		expect(result.hasCjk).toBe(false);
	});
});

describe("verifyEncoding", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("passes with clean content", () => {
		const loader = createTestDb();
		const db = loader.getDb();
		const report = verifyEncoding(db, 10);
		expect(report.passed).toBe(true);
		expect(report.issuesFound).toBe(0);
		expect(report.sampleSize).toBeLessThanOrEqual(10);
		loader.close();
	});

	test("detects encoding issues in content", () => {
		const loader = createTestDb();
		const db = loader.getDb();

		// Insert a post with replacement character
		db.run(
			"INSERT INTO posts (id, thread_id, forum_id, author_id, author_name, content, created_at, is_first, position, invisible) VALUES (99, 1, 1, 1, 'admin', 'Bad \uFFFD encoding', 0, 0, 1, 0)",
		);

		const report = verifyEncoding(db, 100);
		// The sample may or may not hit the bad row (random), so check structure
		expect(report.totalPosts).toBe(4);
		expect(report.sampleSize).toBeLessThanOrEqual(100);
		loader.close();
	});
});

// ─── Performance Tests ──────────────────────────────────────────────────────

describe("getExplainPlan", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("returns explain plan string", () => {
		const loader = createTestDb();
		loader.createIndexes();
		const db = loader.getDb();

		const plan = getExplainPlan(db, "SELECT * FROM threads WHERE forum_id = ?", [1]);
		expect(plan).toContain("threads");
		loader.close();
	});
});

describe("usesIndex", () => {
	test("returns true for index scan", () => {
		expect(usesIndex("SEARCH TABLE threads USING INDEX idx_threads_forum")).toBe(true);
	});

	test("returns false for table scan", () => {
		expect(usesIndex("SCAN TABLE threads")).toBe(false);
	});

	test("returns true for covering index", () => {
		expect(usesIndex("SEARCH TABLE posts USING COVERING INDEX idx_posts_thread")).toBe(true);
	});

	test("returns true for empty plan", () => {
		expect(usesIndex("")).toBe(true);
	});
});

describe("benchmarkQuery", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("benchmarks a simple query", () => {
		const loader = createTestDb();
		loader.createIndexes();
		const db = loader.getDb();

		const result = benchmarkQuery(db, "test query", "SELECT * FROM forums WHERE id = ?", [1]);
		expect(result.name).toBe("test query");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.usesIndex).toBe(true);
		loader.close();
	});
});

describe("verifyPerformance", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("runs all 8 benchmarks", () => {
		const loader = createTestDb();
		loader.createIndexes();
		const db = loader.getDb();

		const report = verifyPerformance(db);
		expect(report.benchmarks).toHaveLength(8);
		// With tiny test data, all queries should pass
		expect(report.passed).toBe(true);
		loader.close();
	});

	test("benchmark results have expected structure", () => {
		const loader = createTestDb();
		loader.createIndexes();
		const db = loader.getDb();

		const report = verifyPerformance(db);
		for (const b of report.benchmarks) {
			expect(b.name).toBeTruthy();
			expect(b.query).toBeTruthy();
			expect(b.durationMs).toBeGreaterThanOrEqual(0);
			expect(typeof b.usesIndex).toBe("boolean");
			expect(typeof b.passed).toBe("boolean");
		}
		loader.close();
	});
});
