// userTombstone.test.ts — D4-a unit coverage for the pure tombstone helper.
//
// We pin field-by-field so the next D4 step (D4-b/D4-c) can refactor the
// callsite without silently changing what gets cleared.

import { describe, expect, it, vi } from "vitest";
import {
	TOMBSTONE_STATUS,
	buildTombstoneFields,
	buildTombstoneStatement,
	tombstoneUsername,
} from "../../../src/lib/userTombstone";

describe("userTombstone", () => {
	describe("tombstoneUsername", () => {
		it("formats the marker as [已删除#<id>]", () => {
			expect(tombstoneUsername(42)).toBe("[已删除#42]");
		});

		it("is unique per id", () => {
			expect(tombstoneUsername(1)).not.toBe(tombstoneUsername(2));
		});
	});

	describe("buildTombstoneFields", () => {
		const fields = buildTombstoneFields(7, 99, 1_700_000_000);

		it("sets status sentinel to TOMBSTONE_STATUS (-99)", () => {
			expect(TOMBSTONE_STATUS).toBe(-99);
			expect(fields.status).toBe(-99);
		});

		it("zeros role so staff semantics are dropped", () => {
			expect(fields.role).toBe(0);
		});

		it("records purged_at = nowSec and purged_by = actorId", () => {
			expect(fields.purged_at).toBe(1_700_000_000);
			expect(fields.purged_by).toBe(99);
		});

		it("sets username marker keyed by user id", () => {
			expect(fields.username).toBe("[已删除#7]");
		});

		it("clears every TEXT PII column to empty string (NOT NULL safe)", () => {
			const textCleared = [
				"email",
				"password_hash",
				"password_salt",
				"avatar",
				"avatar_path",
				"signature",
				"group_title",
				"group_color",
				"custom_title",
				"reside_province",
				"reside_city",
				"graduate_school",
				"bio",
				"interest",
				"qq",
				"site",
				"campus",
				"email_normalized",
				"reg_ip",
				"last_ip",
			];
			for (const col of textCleared) {
				expect(fields[col]).toBe("");
			}
		});

		it("zeros every INTEGER counter / profile column (NOT NULL safe)", () => {
			const intZeroed = [
				"threads",
				"posts",
				"credits",
				"digest_posts",
				"group_stars",
				"ol_time",
				"gender",
				"birth_year",
				"birth_month",
				"birth_day",
				"last_activity",
				"has_avatar",
				"email_verified_at",
				"email_changed_at",
			];
			for (const col of intZeroed) {
				expect(fields[col]).toBe(0);
			}
		});

		it("does NOT touch id / reg_date / last_login (audit anchors)", () => {
			expect(fields.id).toBeUndefined();
			expect(fields.reg_date).toBeUndefined();
			expect(fields.last_login).toBeUndefined();
		});

		it("never produces null values (every users column is NOT NULL)", () => {
			for (const v of Object.values(fields)) {
				expect(v).not.toBeNull();
			}
		});
	});

	describe("buildTombstoneStatement", () => {
		it("issues a single UPDATE users SET ... WHERE id = ? statement", () => {
			const calls: { sql: string; params: unknown[] }[] = [];
			const env = {
				DB: {
					prepare: vi.fn((sql: string) => ({
						bind: vi.fn((...params: unknown[]) => {
							calls.push({ sql, params });
							return { _stmt: true } as unknown as D1PreparedStatement;
						}),
					})),
				},
			} as unknown as Parameters<typeof buildTombstoneStatement>[0];

			const stmt = buildTombstoneStatement(env, 7, 99, 1_700_000_000);

			expect(calls).toHaveLength(1);
			expect(calls[0].sql).toMatch(/^UPDATE users SET .* WHERE id = \?$/);
			expect(calls[0].sql).toContain("status = ?");
			expect(calls[0].sql).toContain("purged_at = ?");
			expect(calls[0].sql).toContain("purged_by = ?");
			// Last bound param must be the WHERE id.
			expect(calls[0].params[calls[0].params.length - 1]).toBe(7);
			expect(stmt).toBeDefined();
		});
	});
});
