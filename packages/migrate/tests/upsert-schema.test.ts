import { describe, expect, test } from "vitest";
import { FORUMS_UPSERT_COLUMNS, TABLE_COLUMNS, USERS_UPSERT_COLUMNS } from "../src/load/schema";

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
