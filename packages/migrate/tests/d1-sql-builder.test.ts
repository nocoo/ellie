import { describe, expect, test } from "vitest";
import {
	buildInsertOrIgnoreStatement,
	buildUpsertStatement,
	chunkFileName,
	escapeSQL,
	formatInsertOrIgnoreChunk,
	formatUpsertChunk,
} from "../src/load/d1-sql-builder";
import {
	CHECKINS_UPSERT_COLUMNS,
	FORUMS_UPSERT_COLUMNS,
	TABLE_COLUMNS,
	USERS_UPSERT_COLUMNS,
} from "../src/load/schema";

// ─── escapeSQL ─────────────────────────────────────────────────────────────

describe("escapeSQL", () => {
	test("null → NULL", () => {
		expect(escapeSQL(null)).toBe("NULL");
	});

	test("number passes through as string", () => {
		expect(escapeSQL(42)).toBe("42");
		expect(escapeSQL(0)).toBe("0");
		expect(escapeSQL(-3)).toBe("-3");
	});

	test("string is single-quoted", () => {
		expect(escapeSQL("hello")).toBe("'hello'");
	});

	test("single quotes in string are doubled", () => {
		expect(escapeSQL("it's")).toBe("'it''s'");
		expect(escapeSQL("a''b")).toBe("'a''''b'");
	});

	test("empty string is quoted", () => {
		expect(escapeSQL("")).toBe("''");
	});

	test("string with special SQL characters is safely quoted", () => {
		expect(escapeSQL("DROP TABLE users; --")).toBe("'DROP TABLE users; --'");
	});
});

// ─── buildUpsertStatement ──────────────────────────────────────────────────

describe("buildUpsertStatement", () => {
	test("forums upsert uses ON CONFLICT(id) DO UPDATE SET", () => {
		const row: Record<string, string | number | null> = {
			id: 1,
			parent_id: 0,
			name: "General",
			description: "test",
			icon: "",
			display_order: 1,
			threads: 10,
			posts: 100,
			type: "forum",
			status: 1,
			moderators: "",
			last_thread_id: 5,
			last_post_at: 1000,
			last_poster: "admin",
			last_thread_subject: "Hello",
		};
		const sql = buildUpsertStatement(
			"forums",
			TABLE_COLUMNS.forums,
			"id",
			FORUMS_UPSERT_COLUMNS,
			row,
		);
		expect(sql).toContain("INSERT INTO forums (");
		expect(sql).toContain("ON CONFLICT(id) DO UPDATE SET");
		expect(sql).toContain("name = excluded.name");
	});

	test("users upsert does NOT update app-owned columns", () => {
		const row: Record<string, string | number | null> = {};
		for (const col of TABLE_COLUMNS.users) {
			row[col] = col === "id" ? 1 : col === "username" ? "test" : "";
		}
		const sql = buildUpsertStatement("users", TABLE_COLUMNS.users, "id", USERS_UPSERT_COLUMNS, row);
		// App-owned columns must NOT be in the SET clause
		expect(sql).not.toContain("email = excluded.email,");
		// The word "email" only appears in: email_verified_at, email_normalized, email_changed_at
		// but those are not in TABLE_COLUMNS.users (intentionally omitted)
		// PK must not be updated
		expect(sql).not.toContain("id = excluded.id");
		// Discuz-owned columns MUST be updated
		expect(sql).toContain("username = excluded.username");
		expect(sql).toContain("has_avatar = excluded.has_avatar");
		expect(sql).toContain("coins = excluded.coins");
		expect(sql).toContain("campus = excluded.campus");
	});

	test("checkins upsert uses ON CONFLICT(user_id)", () => {
		const row: Record<string, string | number | null> = {};
		for (const col of TABLE_COLUMNS.user_checkins) {
			row[col] = col === "user_id" ? 42 : 0;
		}
		const sql = buildUpsertStatement(
			"user_checkins",
			TABLE_COLUMNS.user_checkins,
			"user_id",
			CHECKINS_UPSERT_COLUMNS,
			row,
		);
		expect(sql).toContain("ON CONFLICT(user_id) DO UPDATE SET");
		expect(sql).not.toContain("user_id = excluded.user_id");
		expect(sql).toContain("total_days = excluded.total_days");
		expect(sql).toContain("last_checkin_at = excluded.last_checkin_at");
	});

	test("SET clause has exactly N assignments matching updateColumns length", () => {
		const row: Record<string, string | number | null> = {};
		for (const col of TABLE_COLUMNS.users) {
			row[col] = 0;
		}
		const sql = buildUpsertStatement("users", TABLE_COLUMNS.users, "id", USERS_UPSERT_COLUMNS, row);
		const setMatches = sql.match(/= excluded\./g);
		expect(setMatches).toHaveLength(USERS_UPSERT_COLUMNS.length);
	});

	test("values are properly escaped", () => {
		const row: Record<string, string | number | null> = {
			id: 1,
			parent_id: 0,
			name: "It's a test",
			description: null,
			icon: "",
			display_order: 1,
			threads: 0,
			posts: 0,
			type: "forum",
			status: 1,
			moderators: "",
			last_thread_id: 0,
			last_post_at: 0,
			last_poster: "",
			last_thread_subject: "",
		};
		const sql = buildUpsertStatement(
			"forums",
			TABLE_COLUMNS.forums,
			"id",
			FORUMS_UPSERT_COLUMNS,
			row,
		);
		expect(sql).toContain("'It''s a test'");
		expect(sql).toContain("NULL");
	});
});

// ─── buildInsertOrIgnoreStatement ──────────────────────────────────────────

describe("buildInsertOrIgnoreStatement", () => {
	test("produces INSERT OR IGNORE INTO", () => {
		const row: Record<string, string | number | null> = {
			id: 999,
			thread_id: 1,
			forum_id: 2,
			author_id: 3,
			author_name: "test",
			content: "hello",
			created_at: 1000,
			is_first: 1,
			position: 1,
			invisible: 0,
		};
		const sql = buildInsertOrIgnoreStatement("posts", TABLE_COLUMNS.posts, row);
		expect(sql).toMatch(/^INSERT OR IGNORE INTO posts \(/);
		expect(sql).toContain("VALUES (999,");
		expect(sql.endsWith(");")).toBe(true);
	});

	test("does NOT contain ON CONFLICT", () => {
		const row: Record<string, string | number | null> = {};
		for (const col of TABLE_COLUMNS.threads) {
			row[col] = col === "id" ? 100 : 0;
		}
		row.subject = "test thread";
		const sql = buildInsertOrIgnoreStatement("threads", TABLE_COLUMNS.threads, row);
		expect(sql).not.toContain("ON CONFLICT");
		expect(sql).not.toContain("DO UPDATE");
	});
});

// ─── formatUpsertChunk ─────────────────────────────────────────────────────

describe("formatUpsertChunk", () => {
	test("returns content with byte size", () => {
		const rows = [
			{
				id: 1,
				parent_id: 0,
				name: "A",
				description: "",
				icon: "",
				display_order: 0,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 1,
				moderators: "",
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				last_thread_subject: "",
			},
			{
				id: 2,
				parent_id: 0,
				name: "B",
				description: "",
				icon: "",
				display_order: 1,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 1,
				moderators: "",
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				last_thread_subject: "",
			},
		];
		const { content, bytes } = formatUpsertChunk(
			"forums",
			TABLE_COLUMNS.forums,
			"id",
			FORUMS_UPSERT_COLUMNS,
			rows,
		);
		expect(content).toContain("INSERT INTO forums");
		expect(content).toContain("ON CONFLICT(id) DO UPDATE SET");
		// Two statements separated by double newline
		const statementCount = (content.match(/INSERT INTO forums/g) ?? []).length;
		expect(statementCount).toBe(2);
		expect(bytes).toBe(Buffer.byteLength(content, "utf-8"));
		expect(bytes).toBeGreaterThan(0);
	});

	test("upsert chunks are separated by double newlines", () => {
		const rows = [
			{
				id: 1,
				parent_id: 0,
				name: "A",
				description: "",
				icon: "",
				display_order: 0,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 1,
				moderators: "",
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				last_thread_subject: "",
			},
			{
				id: 2,
				parent_id: 0,
				name: "B",
				description: "",
				icon: "",
				display_order: 1,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 1,
				moderators: "",
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				last_thread_subject: "",
			},
		];
		const { content } = formatUpsertChunk(
			"forums",
			TABLE_COLUMNS.forums,
			"id",
			FORUMS_UPSERT_COLUMNS,
			rows,
		);
		expect(content).toContain(";\n\nINSERT INTO");
	});
});

// ─── formatInsertOrIgnoreChunk ─────────────────────────────────────────────

describe("formatInsertOrIgnoreChunk", () => {
	test("returns content with byte size", () => {
		const rows = [
			{
				id: 100,
				forum_id: 1,
				author_id: 2,
				author_name: "x",
				subject: "s",
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
			},
		];
		const { content, bytes } = formatInsertOrIgnoreChunk("threads", TABLE_COLUMNS.threads, rows);
		expect(content).toContain("INSERT OR IGNORE INTO threads");
		expect(bytes).toBe(Buffer.byteLength(content, "utf-8"));
	});

	test("insert or ignore chunks are separated by single newlines", () => {
		const rows = [
			{
				id: 100,
				forum_id: 1,
				author_id: 2,
				author_name: "x",
				subject: "s",
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
			},
			{
				id: 101,
				forum_id: 1,
				author_id: 3,
				author_name: "y",
				subject: "t",
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
			},
		];
		const { content } = formatInsertOrIgnoreChunk("threads", TABLE_COLUMNS.threads, rows);
		// Single newline between statements (not double)
		expect(content).toContain(";\nINSERT OR IGNORE");
		expect(content).not.toContain(";\n\nINSERT OR IGNORE");
	});
});

// ─── chunkFileName ─────────────────────────────────────────────────────────

describe("chunkFileName", () => {
	test("pads chunk number to 3 digits", () => {
		expect(chunkFileName("users", 1)).toBe("users-001.sql");
		expect(chunkFileName("posts", 42)).toBe("posts-042.sql");
		expect(chunkFileName("threads", 198)).toBe("threads-198.sql");
	});
});

// ─── Column ownership safety ──────────────────────────────────────────────

describe("column ownership in generated SQL", () => {
	test("users upsert never updates email (app-owned)", () => {
		const row: Record<string, string | number | null> = {};
		for (const col of TABLE_COLUMNS.users) {
			row[col] =
				col === "id" ? 1 : col === "username" ? "test" : col === "email" ? "test@test.com" : "";
		}
		const sql = buildUpsertStatement("users", TABLE_COLUMNS.users, "id", USERS_UPSERT_COLUMNS, row);
		// "email" should appear in INSERT column list but NOT in UPDATE SET
		const setClause = sql.split("DO UPDATE SET")[1];
		expect(setClause).toBeDefined();
		// email_verified_at etc are not in TABLE_COLUMNS.users, but "email" itself
		// should NOT appear as "email = excluded.email" in the SET clause
		expect(setClause).not.toMatch(/\bemail = excluded\.email\b/);
	});

	test("forums upsert never updates id (PK)", () => {
		const row: Record<string, string | number | null> = {};
		for (const col of TABLE_COLUMNS.forums) {
			row[col] = 0;
		}
		row.name = "test";
		const sql = buildUpsertStatement(
			"forums",
			TABLE_COLUMNS.forums,
			"id",
			FORUMS_UPSERT_COLUMNS,
			row,
		);
		const setClause = sql.split("DO UPDATE SET")[1];
		expect(setClause).not.toContain("id = excluded.id");
	});

	test("checkins upsert never updates user_id (PK)", () => {
		const row: Record<string, string | number | null> = {};
		for (const col of TABLE_COLUMNS.user_checkins) {
			row[col] = 0;
		}
		const sql = buildUpsertStatement(
			"user_checkins",
			TABLE_COLUMNS.user_checkins,
			"user_id",
			CHECKINS_UPSERT_COLUMNS,
			row,
		);
		const setClause = sql.split("DO UPDATE SET")[1];
		expect(setClause).not.toContain("user_id = excluded.user_id");
	});

	test("forums upsert updates exactly FORUMS_UPSERT_COLUMNS", () => {
		const row: Record<string, string | number | null> = {};
		for (const col of TABLE_COLUMNS.forums) {
			row[col] = 0;
		}
		row.name = "test";
		const sql = buildUpsertStatement(
			"forums",
			TABLE_COLUMNS.forums,
			"id",
			FORUMS_UPSERT_COLUMNS,
			row,
		);
		const setMatches = sql.match(/= excluded\./g);
		expect(setMatches).toHaveLength(FORUMS_UPSERT_COLUMNS.length);
	});
});
