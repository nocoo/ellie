import { describe, expect, it } from "bun:test";
import { createMockDb, makeEnv } from "../../helpers";
import {
	getUserForPermission,
	getForumForPermission,
	getThreadForPermission,
	getPostForPermission,
} from "../../../src/lib/permissionHelpers";

describe("permissionHelpers", () => {
	// ─── getUserForPermission ──────────────────────────────

	describe("getUserForPermission", () => {
		it("returns user data when found", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, username, role, status FROM users": {
						id: 1,
						username: "alice",
						role: 0,
						status: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const result = await getUserForPermission(env, 1);
			expect(result).toEqual({ id: 1, username: "alice", role: 0, status: 0 });
		});

		it("returns null when user not found", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const result = await getUserForPermission(env, 999);
			expect(result).toBeNull();
		});
	});

	// ─── getForumForPermission ─────────────────────────────

	describe("getForumForPermission", () => {
		it("returns forum data when found", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, moderators, moderator_ids FROM forums": {
						id: 5,
						moderators: "alice,bob",
						moderator_ids: "1,2",
					},
				},
			});
			const env = makeEnv({ DB: db });
			const result = await getForumForPermission(env, 5);
			expect(result).toEqual({ id: 5, moderators: "alice,bob" });
		});

		it("returns null when forum not found", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const result = await getForumForPermission(env, 999);
			expect(result).toBeNull();
		});
	});

	// ─── getThreadForPermission ────────────────────────────

	describe("getThreadForPermission", () => {
		it("returns thread data when found", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, forum_id, author_id FROM threads": {
						id: 10,
						forum_id: 3,
						author_id: 7,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const result = await getThreadForPermission(env, 10);
			expect(result).toEqual({ id: 10, forumId: 3, authorId: 7 });
		});

		it("returns null when thread not found", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const result = await getThreadForPermission(env, 999);
			expect(result).toBeNull();
		});
	});

	// ─── getPostForPermission ──────────────────────────────

	describe("getPostForPermission", () => {
		it("returns post data when found (is_first=1)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, author_id, forum_id, thread_id, is_first FROM posts": {
						id: 20,
						author_id: 5,
						forum_id: 2,
						thread_id: 10,
						is_first: 1,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const result = await getPostForPermission(env, 20);
			expect(result).toEqual({
				id: 20,
				authorId: 5,
				forumId: 2,
				threadId: 10,
				isFirst: true,
			});
		});

		it("returns post data with isFirst=false when is_first=0", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, author_id, forum_id, thread_id, is_first FROM posts": {
						id: 21,
						author_id: 5,
						forum_id: 2,
						thread_id: 10,
						is_first: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const result = await getPostForPermission(env, 21);
			expect(result).toEqual({
				id: 21,
				authorId: 5,
				forumId: 2,
				threadId: 10,
				isFirst: false,
			});
		});

		it("returns null when post not found", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const result = await getPostForPermission(env, 999);
			expect(result).toBeNull();
		});
	});
});
