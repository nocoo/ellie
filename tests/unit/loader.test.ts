import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BatchLoader } from "../../scripts/migrate/load/batch-insert";
import {
	INDEX_DDL,
	TABLE_COLUMNS,
	TABLE_DDL,
	TABLE_ORDER,
} from "../../scripts/migrate/load/schema";

const TEST_DB = ":memory:";

function cleanup() {
	// in-memory: nothing to clean up
}

describe("schema", () => {
	test("TABLE_DDL has 6 tables", () => {
		expect(TABLE_DDL).toHaveLength(6);
	});

	test("INDEX_DDL has 12 indexes", () => {
		expect(INDEX_DDL).toHaveLength(12);
	});

	test("TABLE_ORDER matches TABLE_COLUMNS keys", () => {
		for (const table of TABLE_ORDER) {
			expect(TABLE_COLUMNS[table]).toBeDefined();
			expect(TABLE_COLUMNS[table].length).toBeGreaterThan(0);
		}
	});

	test("forums columns match DDL", () => {
		expect(TABLE_COLUMNS.forums).toContain("id");
		expect(TABLE_COLUMNS.forums).toContain("name");
		expect(TABLE_COLUMNS.forums).toContain("last_poster");
	});

	test("posts columns include content and position", () => {
		expect(TABLE_COLUMNS.posts).toContain("content");
		expect(TABLE_COLUMNS.posts).toContain("position");
		expect(TABLE_COLUMNS.posts).toContain("is_first");
	});
});

describe("BatchLoader", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("createTables creates all 6 tables", () => {
		const loader = new BatchLoader({ dbPath: TEST_DB });
		loader.createTables();

		const db = loader.getDb();
		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all() as { name: string }[];

		const tableNames = tables.map((t) => t.name);
		expect(tableNames).toContain("forums");
		expect(tableNames).toContain("users");
		expect(tableNames).toContain("threads");
		expect(tableNames).toContain("posts");
		expect(tableNames).toContain("attachments");
		expect(tableNames).toContain("forum_thread_types");

		loader.close();
	});

	test("createIndexes creates all 12 indexes", () => {
		const loader = new BatchLoader({ dbPath: TEST_DB });
		loader.createTables();
		loader.createIndexes();

		const db = loader.getDb();
		const indexes = db
			.query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
			.all() as { name: string }[];

		expect(indexes).toHaveLength(12);
		loader.close();
	});

	test("insertRows inserts forum data", () => {
		const loader = new BatchLoader({ dbPath: TEST_DB });
		loader.createTables();

		const count = loader.insertRows("forums", [
			{
				id: 1,
				parent_id: 0,
				name: "Test Forum",
				description: "A test forum",
				icon: "",
				display_order: 1,
				threads: 10,
				posts: 100,
				type: "forum",
				status: 1,
				last_thread_id: 5,
				last_post_at: 1700000000,
				last_poster: "admin",
				type_name: "",
				thread_types_enabled: 0,
				thread_types_required: 0,
				thread_types_listable: 0,
				thread_types_prefix: 0,
			},
			{
				id: 2,
				parent_id: 1,
				name: "Sub Forum",
				description: "",
				icon: "",
				display_order: 2,
				threads: 5,
				posts: 50,
				type: "sub",
				status: 1,
				last_thread_id: 3,
				last_post_at: 1700000100,
				last_poster: "user1",
				type_name: "",
				thread_types_enabled: 0,
				thread_types_required: 0,
				thread_types_listable: 0,
				thread_types_prefix: 0,
			},
		]);

		expect(count).toBe(2);

		const db = loader.getDb();
		const rows = db.query("SELECT * FROM forums ORDER BY id").all() as {
			id: number;
			name: string;
		}[];
		expect(rows).toHaveLength(2);
		expect(rows[0].name).toBe("Test Forum");
		expect(rows[1].name).toBe("Sub Forum");

		loader.close();
	});

	test("insertRows handles large batch correctly", () => {
		const loader = new BatchLoader({ dbPath: TEST_DB, batchSize: 10 });
		loader.createTables();

		const rows = Array.from({ length: 25 }, (_, i) => ({
			id: i + 1,
			username: `user${i + 1}`,
			email: `user${i + 1}@test.com`,
			password_hash: "hash",
			password_salt: "salt",
			avatar: "",
			status: 0,
			role: 0,
			reg_date: 1000000000,
			last_login: 1000000000,
			threads: 0,
			posts: 0,
			credits: 0,
		}));

		const count = loader.insertRows("users", rows);
		expect(count).toBe(25);

		const db = loader.getDb();
		const dbCount = db.query("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
		expect(dbCount.cnt).toBe(25);

		loader.close();
	});

	test("progress callback fires at interval", () => {
		const progress: number[] = [];
		const loader = new BatchLoader({
			dbPath: TEST_DB,
			batchSize: 100,
			onProgress: (_table, count) => progress.push(count),
			progressInterval: 5,
		});
		loader.createTables();

		const rows = Array.from({ length: 12 }, (_, i) => ({
			id: i + 1,
			username: `user${i + 1}`,
			email: "",
			password_hash: "",
			password_salt: "",
			avatar: "",
			status: 0,
			role: 0,
			reg_date: 0,
			last_login: 0,
			threads: 0,
			posts: 0,
			credits: 0,
		}));

		loader.insertRows("users", rows);
		expect(progress).toEqual([5, 10]);

		loader.close();
	});
});

describe("StreamInserter", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	test("buffers and flushes rows", () => {
		const loader = new BatchLoader({ dbPath: TEST_DB, batchSize: 3 });
		loader.createTables();

		const inserter = loader.createStreamInserter("forums");

		// Add 5 rows — should auto-flush at 3, then flush remaining 2
		for (let i = 1; i <= 5; i++) {
			inserter.add({
				id: i,
				parent_id: 0,
				name: `Forum ${i}`,
				description: "",
				icon: "",
				display_order: i,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 1,
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				thread_types_enabled: 0,
				thread_types_required: 0,
				thread_types_listable: 0,
				thread_types_prefix: 0,
			});
		}

		const total = inserter.flush();
		expect(total).toBe(5);
		expect(inserter.count).toBe(5);

		const db = loader.getDb();
		const dbCount = db.query("SELECT COUNT(*) as cnt FROM forums").get() as { cnt: number };
		expect(dbCount.cnt).toBe(5);

		loader.close();
	});

	test("flush on empty buffer is safe", () => {
		const loader = new BatchLoader({ dbPath: TEST_DB });
		loader.createTables();

		const inserter = loader.createStreamInserter("users");
		const total = inserter.flush();
		expect(total).toBe(0);

		loader.close();
	});

	test("stream inserter progress callback", () => {
		const progress: number[] = [];
		const loader = new BatchLoader({
			dbPath: TEST_DB,
			batchSize: 5,
			onProgress: (_table, count) => progress.push(count),
			progressInterval: 3,
		});
		loader.createTables();

		const inserter = loader.createStreamInserter("users");
		for (let i = 1; i <= 7; i++) {
			inserter.add({
				id: i,
				username: `u${i}`,
				email: "",
				password_hash: "",
				password_salt: "",
				avatar: "",
				status: 0,
				role: 0,
				reg_date: 0,
				last_login: 0,
				threads: 0,
				posts: 0,
				credits: 0,
			});
		}
		inserter.flush();

		expect(progress).toEqual([3, 6]);
		loader.close();
	});

	test("NULL values are handled correctly", () => {
		const loader = new BatchLoader({ dbPath: TEST_DB });
		loader.createTables();

		// Insert a post with null-like defaults (all optional fields as null)
		loader.insertRows("forums", [
			{
				id: 1,
				parent_id: 0,
				name: "F",
				description: "",
				icon: "",
				display_order: 0,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 1,
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				thread_types_enabled: 0,
				thread_types_required: 0,
				thread_types_listable: 0,
				thread_types_prefix: 0,
			},
		]);
		loader.insertRows("users", [
			{
				id: 1,
				username: "test",
				email: "",
				password_hash: "",
				password_salt: "",
				avatar: "",
				status: 0,
				role: 0,
				reg_date: 0,
				last_login: 0,
				threads: 0,
				posts: 0,
				credits: 0,
			},
		]);
		loader.insertRows("threads", [
			{
				id: 1,
				forum_id: 1,
				author_id: 1,
				author_name: "test",
				subject: "Test",
				created_at: 0,
				last_post_at: 0,
				last_poster: "",
				replies: 0,
				views: 0,
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
				author_name: "test",
				content: "Hello",
				created_at: 0,
				is_first: 1,
				position: 1,
				invisible: 0,
			},
		]);

		const db = loader.getDb();
		const post = db.query("SELECT * FROM posts WHERE id = 1").get() as { content: string };
		expect(post.content).toBe("Hello");

		loader.close();
	});
});
