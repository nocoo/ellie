// Hardening tests for the v2 forum cache loader (lib/cache/forum-read).
// Verifies:
//   - P1: visible-last-thread tie-break is stable (last_post_at DESC, id DESC)
//         so the cached snapshot does not flip between requests.
//   - P2: loadUserMaps batches the IN-list to stay under SQLite's 999-var
//         cap when modIds + avatarIds together exceed BATCH_SIZE.

import { describe, expect, it, vi } from "vitest";
import { loadForumSnapshot } from "../../../../src/lib/cache/forum-read";
import type { Env } from "../../../../src/lib/env";

interface Capture {
	visibleSql: string[];
	userInBatchSizes: number[];
}

function makeEnv(opts: {
	forums: Array<Record<string, unknown>>;
	visibleRows: Array<Record<string, unknown>>;
	users: Array<{ id: number; username: string; avatar?: string; avatar_path?: string }>;
	capture: Capture;
}): Env {
	const userById = new Map(opts.users.map((u) => [u.id, u]));
	const db = {
		prepare: vi.fn((sql: string) => {
			if (sql.includes("FROM forums") && !sql.includes("FROM threads")) {
				return {
					all: vi.fn(async () => ({ results: opts.forums })),
				};
			}
			if (sql.includes("FROM threads") && !sql.includes("MAX(last_post_at)")) {
				// today-thread count
				return {
					bind: vi.fn(() => ({
						all: vi.fn(async () => ({ results: [] })),
					})),
				};
			}
			if (sql.includes("MAX(last_post_at)")) {
				opts.capture.visibleSql.push(sql);
				return {
					bind: vi.fn(() => ({
						all: vi.fn(async () => ({ results: opts.visibleRows })),
					})),
				};
			}
			if (sql.includes("FROM users WHERE id IN")) {
				return {
					bind: vi.fn((...ids: number[]) => {
						opts.capture.userInBatchSizes.push(ids.length);
						const filtered = ids
							.map((id) => userById.get(id))
							.filter((u): u is NonNullable<typeof u> => Boolean(u))
							.map((u) => ({
								id: u.id,
								username: u.username,
								avatar: u.avatar ?? null,
								avatar_path: u.avatar_path ?? null,
							}));
						return { all: vi.fn(async () => ({ results: filtered })) };
					}),
				};
			}
			// fallback
			return {
				bind: vi.fn(() => ({
					all: vi.fn(async () => ({ results: [] })),
				})),
			};
		}),
	} as unknown as D1Database;

	return {
		API_KEY: "k",
		ADMIN_API_KEY: "a",
		DB: db,
		ENVIRONMENT: "test",
		JWT_SECRET: "s",
		KV: {} as KVNamespace,
	} as unknown as Env;
}

describe("loadForumSnapshot — visible-last-thread tie-break (P1)", () => {
	it("emits ORDER BY last_post_at DESC, id DESC so same-second ties resolve stably", async () => {
		const capture: Capture = { visibleSql: [], userInBatchSizes: [] };
		const env = makeEnv({
			forums: [
				{
					id: 1,
					parent_id: 0,
					name: "F",
					description: "",
					icon: "",
					display_order: 1,
					threads: 0,
					posts: 0,
					type: "forum",
					status: 1,
					visibility: "public",
					moderators: "",
					moderator_ids: "",
				},
			],
			// Two visible threads at the same second — INNER JOIN returns both.
			// Snapshot loader keeps the first row per forum_id, and our P1
			// ORDER BY guarantees that "first" is the higher id.
			visibleRows: [
				{
					forum_id: 1,
					thread_id: 200,
					subject: "newer-tied-id-200",
					last_post_at: 1700000000,
					last_poster_id: 10,
					last_poster: "alice",
				},
				{
					forum_id: 1,
					thread_id: 100,
					subject: "older-tied-id-100",
					last_post_at: 1700000000,
					last_poster_id: 11,
					last_poster: "bob",
				},
			],
			users: [
				{ id: 10, username: "alice", avatar: "a.png", avatar_path: "ap" },
				{ id: 11, username: "bob", avatar: "b.png", avatar_path: "bp" },
			],
			capture,
		});

		const snapshot = await loadForumSnapshot(env);

		// SQL contract: tie-break clause must be present.
		expect(capture.visibleSql.length).toBe(1);
		expect(capture.visibleSql[0]).toMatch(/ORDER BY t\.last_post_at DESC,\s*t\.id DESC/);

		// Behavior contract: with the tie-break in SQL, the higher id wins.
		expect(snapshot[0].lastThreadId).toBe(200);
		expect(snapshot[0].lastPosterId).toBe(10);
	});
});

describe("loadUserMaps — SQLite var-cap batching (P2)", () => {
	it("chunks the IN-list to BATCH_SIZE=100 when ids exceed the cap", async () => {
		const capture: Capture = { visibleSql: [], userInBatchSizes: [] };

		// Build 250 unique moderator ids — none of these will resolve to a
		// real user but that's fine; we only assert on batch sizes.
		const modIds = Array.from({ length: 250 }, (_, i) => i + 1);
		const moderatorIdsStr = modIds.join(",");

		const env = makeEnv({
			forums: [
				{
					id: 1,
					parent_id: 0,
					name: "F",
					description: "",
					icon: "",
					display_order: 1,
					threads: 0,
					posts: 0,
					type: "forum",
					status: 1,
					visibility: "public",
					moderators: "",
					moderator_ids: moderatorIdsStr,
				},
			],
			visibleRows: [],
			users: [],
			capture,
		});

		await loadForumSnapshot(env);

		// 250 ids → 3 batches of [100, 100, 50].
		expect(capture.userInBatchSizes).toEqual([100, 100, 50]);
		// Sanity: each batch stays comfortably below SQLite's 999-var cap.
		for (const n of capture.userInBatchSizes) expect(n).toBeLessThanOrEqual(100);
	});
});
