import { describe, expect, test } from "vitest";
import {
	CHECKINS_UPSERT_COLUMNS,
	FORUMS_UPSERT_COLUMNS,
	TABLE_COLUMNS,
	USERS_UPSERT_COLUMNS,
} from "../src/load/schema";
import { buildFilteredUpsertSql, buildInsertSql, buildUpsertSql } from "../src/load/sql-builder";

// ─── Upsert allowlist tests ──────────────────────────────────────────────────
// These verify that the upsert allowlists are correct and consistent with
// TABLE_COLUMNS, without requiring bun:sqlite.

describe("USERS_UPSERT_COLUMNS", () => {
	test("has 35 Discuz-owned columns (37 total minus id and email)", () => {
		// TABLE_COLUMNS.users = 37 columns
		// minus id (PK, conflict column) = 36
		// minus email (app-owned, preserved on update) = 35
		expect(USERS_UPSERT_COLUMNS).toHaveLength(35);
	});

	test("all columns exist in TABLE_COLUMNS.users", () => {
		for (const col of USERS_UPSERT_COLUMNS) {
			expect(TABLE_COLUMNS.users).toContain(col);
		}
	});

	test("excludes app-owned email columns", () => {
		expect(USERS_UPSERT_COLUMNS).not.toContain("email");
		expect(USERS_UPSERT_COLUMNS).not.toContain("email_verified_at");
		expect(USERS_UPSERT_COLUMNS).not.toContain("email_normalized");
		expect(USERS_UPSERT_COLUMNS).not.toContain("email_changed_at");
	});

	test("excludes primary key (id)", () => {
		expect(USERS_UPSERT_COLUMNS).not.toContain("id");
	});

	test("includes has_avatar (source-derived)", () => {
		expect(USERS_UPSERT_COLUMNS).toContain("has_avatar");
	});

	test("includes campus (Discuz-owned from profile.field1)", () => {
		expect(USERS_UPSERT_COLUMNS).toContain("campus");
	});

	test("includes all Discuz profile columns", () => {
		const profileCols = [
			"gender",
			"birth_year",
			"birth_month",
			"birth_day",
			"reside_province",
			"reside_city",
			"graduate_school",
			"bio",
			"interest",
			"qq",
			"site",
		];
		for (const col of profileCols) {
			expect(USERS_UPSERT_COLUMNS).toContain(col);
		}
	});

	test("includes all Discuz member_count columns", () => {
		const countCols = ["threads", "posts", "digest_posts", "ol_time", "coins"];
		for (const col of countCols) {
			expect(USERS_UPSERT_COLUMNS).toContain(col);
		}
	});

	test("includes all Discuz usergroup columns", () => {
		const ugCols = ["group_title", "group_stars", "group_color"];
		for (const col of ugCols) {
			expect(USERS_UPSERT_COLUMNS).toContain(col);
		}
	});

	test("includes all Discuz status columns", () => {
		const statusCols = ["last_activity", "reg_ip", "last_ip"];
		for (const col of statusCols) {
			expect(USERS_UPSERT_COLUMNS).toContain(col);
		}
	});

	test("includes all Discuz field_forum columns", () => {
		expect(USERS_UPSERT_COLUMNS).toContain("signature");
		expect(USERS_UPSERT_COLUMNS).toContain("custom_title");
	});

	test("no duplicates", () => {
		const unique = new Set(USERS_UPSERT_COLUMNS);
		expect(unique.size).toBe(USERS_UPSERT_COLUMNS.length);
	});
});

describe("FORUMS_UPSERT_COLUMNS", () => {
	test("has 14 Discuz-owned columns", () => {
		expect(FORUMS_UPSERT_COLUMNS).toHaveLength(14);
	});

	test("all columns exist in TABLE_COLUMNS.forums", () => {
		for (const col of FORUMS_UPSERT_COLUMNS) {
			expect(TABLE_COLUMNS.forums).toContain(col);
		}
	});

	test("excludes primary key (id)", () => {
		expect(FORUMS_UPSERT_COLUMNS).not.toContain("id");
	});

	test("includes moderators (Discuz-owned)", () => {
		expect(FORUMS_UPSERT_COLUMNS).toContain("moderators");
	});

	test("includes last_thread_subject", () => {
		expect(FORUMS_UPSERT_COLUMNS).toContain("last_thread_subject");
	});

	test("no duplicates", () => {
		const unique = new Set(FORUMS_UPSERT_COLUMNS);
		expect(unique.size).toBe(FORUMS_UPSERT_COLUMNS.length);
	});
});

describe("TABLE_COLUMNS.users completeness", () => {
	test("has 37 columns (36 Discuz + email/email_* omitted from upsert)", () => {
		// TABLE_COLUMNS.users has: all Discuz columns + campus + has_avatar
		// email_verified_at/normalized/changed_at are intentionally omitted from TABLE_COLUMNS
		expect(TABLE_COLUMNS.users).toHaveLength(37);
	});

	test("includes has_avatar", () => {
		expect(TABLE_COLUMNS.users).toContain("has_avatar");
	});

	test("includes campus", () => {
		expect(TABLE_COLUMNS.users).toContain("campus");
	});
});

// ─── SQL builder tests ──────────────────────────────────────────────────────
// These verify that buildUpsertSql produces correct ON CONFLICT SQL and that
// the generated SET clause exactly follows the allowlist.

describe("buildUpsertSql", () => {
	test("users SQL uses ON CONFLICT(id) DO UPDATE SET", () => {
		const sql = buildUpsertSql("users", TABLE_COLUMNS.users, {
			conflictColumn: "id",
			updateColumns: USERS_UPSERT_COLUMNS,
		});
		expect(sql).toContain("ON CONFLICT(id) DO UPDATE SET");
	});

	test("users SET clause includes Discuz-owned columns", () => {
		const sql = buildUpsertSql("users", TABLE_COLUMNS.users, {
			conflictColumn: "id",
			updateColumns: USERS_UPSERT_COLUMNS,
		});
		expect(sql).toContain("has_avatar = excluded.has_avatar");
		expect(sql).toContain("campus = excluded.campus");
		expect(sql).toContain("coins = excluded.coins");
		expect(sql).toContain("username = excluded.username");
		expect(sql).toContain("password_hash = excluded.password_hash");
	});

	test("users SET clause excludes id and app-owned columns", () => {
		const sql = buildUpsertSql("users", TABLE_COLUMNS.users, {
			conflictColumn: "id",
			updateColumns: USERS_UPSERT_COLUMNS,
		});
		// PK must not be in SET
		expect(sql).not.toContain("id = excluded.id");
		// App-owned email columns must not be in SET
		expect(sql).not.toContain("email = excluded.email");
		expect(sql).not.toContain("email_verified_at = excluded.email_verified_at");
		expect(sql).not.toContain("email_normalized = excluded.email_normalized");
		expect(sql).not.toContain("email_changed_at = excluded.email_changed_at");
	});

	test("users SQL INSERT lists all TABLE_COLUMNS", () => {
		const sql = buildUpsertSql("users", TABLE_COLUMNS.users, {
			conflictColumn: "id",
			updateColumns: USERS_UPSERT_COLUMNS,
		});
		// INSERT should contain all columns including app-owned (for new rows)
		expect(sql).toMatch(/^INSERT INTO users \(/);
		for (const col of TABLE_COLUMNS.users) {
			expect(sql).toContain(col);
		}
	});

	test("forums SQL uses ON CONFLICT(id) DO UPDATE SET", () => {
		const sql = buildUpsertSql("forums", TABLE_COLUMNS.forums, {
			conflictColumn: "id",
			updateColumns: FORUMS_UPSERT_COLUMNS,
		});
		expect(sql).toContain("ON CONFLICT(id) DO UPDATE SET");
	});

	test("forums SET clause excludes app-owned columns", () => {
		const sql = buildUpsertSql("forums", TABLE_COLUMNS.forums, {
			conflictColumn: "id",
			updateColumns: FORUMS_UPSERT_COLUMNS,
		});
		expect(sql).not.toContain("visibility = excluded.visibility");
		expect(sql).not.toContain("moderator_ids = excluded.moderator_ids");
		expect(sql).not.toContain("last_poster_id = excluded.last_poster_id");
	});

	test("forums SET clause includes Discuz-owned columns", () => {
		const sql = buildUpsertSql("forums", TABLE_COLUMNS.forums, {
			conflictColumn: "id",
			updateColumns: FORUMS_UPSERT_COLUMNS,
		});
		expect(sql).toContain("moderators = excluded.moderators");
		expect(sql).toContain("last_thread_subject = excluded.last_thread_subject");
		expect(sql).toContain("name = excluded.name");
	});

	test("SET clause has exactly N assignments matching updateColumns length", () => {
		const sql = buildUpsertSql("users", TABLE_COLUMNS.users, {
			conflictColumn: "id",
			updateColumns: USERS_UPSERT_COLUMNS,
		});
		// Count "= excluded." occurrences — should equal updateColumns.length
		const setMatches = sql.match(/= excluded\./g);
		expect(setMatches).toHaveLength(USERS_UPSERT_COLUMNS.length);
	});

	test("throws on empty updateColumns", () => {
		expect(() =>
			buildUpsertSql("users", TABLE_COLUMNS.users, {
				conflictColumn: "id",
				updateColumns: [],
			}),
		).toThrow('updateColumns must not be empty for table "users"');
	});

	test("throws if updateColumns contains the conflict column", () => {
		expect(() =>
			buildUpsertSql("users", TABLE_COLUMNS.users, {
				conflictColumn: "id",
				updateColumns: ["id", "username"],
			}),
		).toThrow('updateColumns must not contain the conflict column "id"');
	});
});

describe("buildInsertSql", () => {
	test("produces parameterized INSERT", () => {
		const sql = buildInsertSql("posts", TABLE_COLUMNS.posts);
		expect(sql).toBe(
			"INSERT INTO posts (id,thread_id,forum_id,author_id,author_name,content,created_at,is_first,position,invisible) VALUES (?,?,?,?,?,?,?,?,?,?)",
		);
	});

	test("placeholder count matches column count", () => {
		const sql = buildInsertSql("users", TABLE_COLUMNS.users);
		const placeholderCount = (sql.match(/\?/g) ?? []).length;
		expect(placeholderCount).toBe(TABLE_COLUMNS.users.length);
	});
});

// ─── Checkins schema tests ──────────────────────────────────────────────────

describe("CHECKINS_UPSERT_COLUMNS", () => {
	test("has 8 columns (9 total minus user_id PK)", () => {
		expect(CHECKINS_UPSERT_COLUMNS).toHaveLength(8);
	});

	test("all columns exist in TABLE_COLUMNS.user_checkins", () => {
		for (const col of CHECKINS_UPSERT_COLUMNS) {
			expect(TABLE_COLUMNS.user_checkins).toContain(col);
		}
	});

	test("excludes primary key (user_id)", () => {
		expect(CHECKINS_UPSERT_COLUMNS).not.toContain("user_id");
	});

	test("includes all checkin stat columns", () => {
		const statCols = ["total_days", "month_days", "streak_days", "reward_total", "last_reward"];
		for (const col of statCols) {
			expect(CHECKINS_UPSERT_COLUMNS).toContain(col);
		}
	});

	test("includes mood and message", () => {
		expect(CHECKINS_UPSERT_COLUMNS).toContain("mood");
		expect(CHECKINS_UPSERT_COLUMNS).toContain("message");
	});

	test("includes last_checkin_at", () => {
		expect(CHECKINS_UPSERT_COLUMNS).toContain("last_checkin_at");
	});

	test("no duplicates", () => {
		const unique = new Set(CHECKINS_UPSERT_COLUMNS);
		expect(unique.size).toBe(CHECKINS_UPSERT_COLUMNS.length);
	});
});

describe("TABLE_COLUMNS.user_checkins", () => {
	test("has 9 columns", () => {
		expect(TABLE_COLUMNS.user_checkins).toHaveLength(9);
	});

	test("user_id is first column", () => {
		expect(TABLE_COLUMNS.user_checkins[0]).toBe("user_id");
	});
});

// ─── buildFilteredUpsertSql tests ───────────────────────────────────────────

describe("buildFilteredUpsertSql", () => {
	test("checkins SQL uses SELECT...WHERE EXISTS...ON CONFLICT", () => {
		const sql = buildFilteredUpsertSql(
			"user_checkins",
			TABLE_COLUMNS.user_checkins,
			{ conflictColumn: "user_id", updateColumns: CHECKINS_UPSERT_COLUMNS },
			{ referenceTable: "users", referenceColumn: "id", sourceColumn: "user_id" },
		);
		expect(sql).toContain("SELECT ?,?,?,?,?,?,?,?,?");
		expect(sql).toContain("WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)");
		expect(sql).toContain("ON CONFLICT(user_id) DO UPDATE SET");
	});

	test("checkins SET clause includes all stat columns", () => {
		const sql = buildFilteredUpsertSql(
			"user_checkins",
			TABLE_COLUMNS.user_checkins,
			{ conflictColumn: "user_id", updateColumns: CHECKINS_UPSERT_COLUMNS },
			{ referenceTable: "users", referenceColumn: "id", sourceColumn: "user_id" },
		);
		expect(sql).toContain("total_days = excluded.total_days");
		expect(sql).toContain("mood = excluded.mood");
		expect(sql).toContain("last_checkin_at = excluded.last_checkin_at");
	});

	test("checkins SET clause excludes user_id PK", () => {
		const sql = buildFilteredUpsertSql(
			"user_checkins",
			TABLE_COLUMNS.user_checkins,
			{ conflictColumn: "user_id", updateColumns: CHECKINS_UPSERT_COLUMNS },
			{ referenceTable: "users", referenceColumn: "id", sourceColumn: "user_id" },
		);
		expect(sql).not.toContain("user_id = excluded.user_id");
	});

	test("has column count + 1 placeholders (extra for EXISTS check)", () => {
		const sql = buildFilteredUpsertSql(
			"user_checkins",
			TABLE_COLUMNS.user_checkins,
			{ conflictColumn: "user_id", updateColumns: CHECKINS_UPSERT_COLUMNS },
			{ referenceTable: "users", referenceColumn: "id", sourceColumn: "user_id" },
		);
		const placeholderCount = (sql.match(/\?/g) ?? []).length;
		expect(placeholderCount).toBe(TABLE_COLUMNS.user_checkins.length + 1);
	});

	test("throws on empty updateColumns", () => {
		expect(() =>
			buildFilteredUpsertSql(
				"user_checkins",
				TABLE_COLUMNS.user_checkins,
				{ conflictColumn: "user_id", updateColumns: [] },
				{ referenceTable: "users", referenceColumn: "id", sourceColumn: "user_id" },
			),
		).toThrow('updateColumns must not be empty for table "user_checkins"');
	});

	test("throws if updateColumns contains conflict column", () => {
		expect(() =>
			buildFilteredUpsertSql(
				"user_checkins",
				TABLE_COLUMNS.user_checkins,
				{ conflictColumn: "user_id", updateColumns: ["user_id", "total_days"] },
				{ referenceTable: "users", referenceColumn: "id", sourceColumn: "user_id" },
			),
		).toThrow('updateColumns must not contain the conflict column "user_id"');
	});
});
