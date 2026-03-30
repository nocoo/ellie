import { describe, expect, it, mock } from "bun:test";
import { recalcForumMetadata, recalcThreadMetadata } from "../../../src/lib/recalcMetadata";
import { createMockDb, makeEnv } from "../../helpers";

describe("recalcMetadata", () => {
	describe("recalcForumMetadata", () => {
		it("should update forum with latest thread info", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, subject, last_post_at, last_poster FROM threads": {
						id: 42,
						subject: "Latest thread",
						last_post_at: 1700000000,
						last_poster: "alice",
					},
				},
			});
			const env = makeEnv({ DB: db });

			await recalcForumMetadata(env, 1);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET last_thread_id"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toEqual([42, 1700000000, "alice", "Latest thread", 1]);
		});

		it("should reset forum metadata when no threads remain", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, subject, last_post_at, last_poster FROM threads": null,
				},
			});
			const env = makeEnv({ DB: db });

			await recalcForumMetadata(env, 5);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET last_thread_id"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toEqual([0, 0, "", "", 5]);
		});
	});

	describe("recalcThreadMetadata", () => {
		it("should update thread with latest post info", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT created_at, author_name FROM posts": {
						created_at: 1700000000,
						author_name: "bob",
					},
				},
			});
			const env = makeEnv({ DB: db });

			await recalcThreadMetadata(env, 10);

			const updateCall = calls.find(
				(c) => c.sql.includes("UPDATE threads SET last_post_at") && c.params.includes(10),
			);
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toEqual([1700000000, "bob", 10]);
		});

		it("should fall back to thread creation info when no posts remain", async () => {
			// First call: SELECT from posts — returns null
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
				if (sql.includes("FROM threads")) {
					calls.push({ sql, params: [] });
					return {
						bind: (...params: unknown[]) => {
							calls[calls.length - 1].params = params;
							return {
								first: () =>
									Promise.resolve({
										created_at: 1600000000,
										author_name: "original_author",
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
			expect(updateCall?.params).toEqual([1600000000, "original_author", 20]);
		});
	});
});
