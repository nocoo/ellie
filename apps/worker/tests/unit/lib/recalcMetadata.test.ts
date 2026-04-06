import { describe, expect, it, mock } from "bun:test";
import { recalcForumMetadata, recalcThreadMetadata } from "../../../src/lib/recalcMetadata";
import { createMockDb, makeEnv } from "../../helpers";

describe("recalcMetadata", () => {
	describe("recalcForumMetadata", () => {
		it("should update forum with latest visible thread info", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					// Match query that includes visibility filter
					"SELECT id, subject, last_post_at, last_poster, last_poster_id": {
						id: 42,
						subject: "Latest thread",
						last_post_at: 1700000000,
						last_poster: "alice",
						last_poster_id: 10,
					},
				},
			});
			const env = makeEnv({ DB: db });

			await recalcForumMetadata(env, 1);

			// Verify the SELECT query includes visibility filter
			const selectCall = calls.find(
				(c) => c.sql.includes("SELECT id, subject") && c.sql.includes("FROM threads"),
			);
			expect(selectCall?.sql).toContain("sticky >= 0");

			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET last_thread_id"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toEqual([42, 1700000000, "alice", 10, "Latest thread", 1]);
		});

		it("should reset forum metadata when no visible threads remain", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, subject, last_post_at, last_poster, last_poster_id": null,
				},
			});
			const env = makeEnv({ DB: db });

			await recalcForumMetadata(env, 5);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET last_thread_id"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toEqual([0, 0, "", 0, "", 5]);
		});

		it("should only consider visible threads (sticky >= 0)", async () => {
			const { db, calls } = createMockDb({});
			const env = makeEnv({ DB: db });

			await recalcForumMetadata(env, 1);

			// The SQL should filter out hidden threads (sticky < 0)
			const selectCall = calls.find(
				(c) => c.sql.includes("FROM threads") && c.sql.includes("WHERE"),
			);
			expect(selectCall?.sql).toContain("sticky >= 0");
		});
	});

	describe("recalcThreadMetadata", () => {
		it("should update thread with latest visible post info", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					// Match the SELECT query - uses a substring that will match
					"SELECT created_at, author_name, author_id": {
						created_at: 1700000000,
						author_name: "bob",
						author_id: 20,
					},
				},
			});
			const env = makeEnv({ DB: db });

			await recalcThreadMetadata(env, 10);

			// Verify the SELECT query includes visibility filter
			const selectCall = calls.find(
				(c) => c.sql.includes("SELECT created_at") && c.sql.includes("FROM posts"),
			);
			expect(selectCall?.sql).toContain("invisible = 0");

			const updateCall = calls.find(
				(c) => c.sql.includes("UPDATE threads SET last_post_at") && c.params.includes(10),
			);
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toEqual([1700000000, "bob", 20, 10]);
		});

		it("should fall back to thread creation info when no visible posts remain", async () => {
			// First call: SELECT from posts — returns null (no visible posts)
			// Second call: SELECT from threads — returns thread info
			let postCallDone = false;
			const { db, calls } = createMockDb({});

			// Override prepare to handle the two-call sequence
			const originalPrepare = db.prepare;
			(db as unknown as Record<string, unknown>).prepare = mock((sql: string) => {
				if (sql.includes("FROM posts") && !postCallDone) {
					postCallDone = true;
					calls.push({ sql, params: [] });
					return {
						bind: (...params: unknown[]) => {
							calls[calls.length - 1].params = params;
							return {
								first: () => Promise.resolve(null),
							};
						},
					};
				}
				if (sql.includes("FROM threads") && sql.includes("SELECT created_at")) {
					calls.push({ sql, params: [] });
					return {
						bind: (...params: unknown[]) => {
							calls[calls.length - 1].params = params;
							return {
								first: () =>
									Promise.resolve({
										created_at: 1600000000,
										author_name: "original_author",
										author_id: 30,
									}),
							};
						},
					};
				}
				if (sql.includes("UPDATE threads")) {
					calls.push({ sql, params: [] });
					return {
						bind: (...params: unknown[]) => {
							calls[calls.length - 1].params = params;
							return {
								run: () => Promise.resolve({ success: true }),
							};
						},
					};
				}
				return (originalPrepare as (sql: string) => unknown)(sql);
			});

			const env = makeEnv({ DB: db });

			await recalcThreadMetadata(env, 20);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET last_post_at"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toEqual([1600000000, "original_author", 30, 20]);
		});

		it("should only consider visible posts (invisible = 0)", async () => {
			const { db, calls } = createMockDb({});
			const env = makeEnv({ DB: db });

			await recalcThreadMetadata(env, 10);

			// The SQL should filter out hidden posts (invisible != 0)
			const selectCall = calls.find(
				(c) => c.sql.includes("FROM posts") && c.sql.includes("WHERE"),
			);
			expect(selectCall?.sql).toContain("invisible = 0");
		});
	});
});
