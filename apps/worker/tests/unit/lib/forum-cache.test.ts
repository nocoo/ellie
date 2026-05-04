import { describe, expect, it, vi } from "vitest";
import {
	type ForumTreeEntry,
	getForumTree,
	invalidateForumTree,
} from "../../../src/lib/forum-cache";
import { createMockCtx, makeEnv } from "../../helpers";

// ─── KV mock that supports "json" type parameter ────────────────────

function createJsonKV(initialData: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initialData));
	return {
		get: vi.fn(async (key: string, type?: string) => {
			const raw = store.get(key) ?? null;
			if (raw === null) return null;
			if (type === "json") return JSON.parse(raw);
			return raw;
		}),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	} as unknown as KVNamespace;
}

// ─── D1 mock for forum tree queries ─────────────────────────────────

function createMockD1(
	forumRows: Record<string, unknown>[],
	modNameRows: { id: number; username: string }[] = [],
) {
	return {
		prepare: vi.fn((sql: string) => ({
			bind: vi.fn(() => ({
				all: vi.fn(async () => {
					if (sql.includes("FROM users WHERE id IN")) {
						return { results: modNameRows };
					}
					return { results: forumRows };
				}),
			})),
			all: vi.fn(async () => {
				// Parameterless .all() for the forum tree query
				return { results: forumRows };
			}),
		})),
	} as unknown as D1Database;
}

// ─── Test forum row factories ───────────────────────────────────────

function makeTreeRow(overrides?: Record<string, unknown>) {
	return {
		id: 1,
		parent_id: 0,
		name: "Root Forum",
		description: "Description",
		icon: "icon.png",
		display_order: 1,
		status: 1,
		visibility: "public",
		type: "group",
		moderators: "",
		moderator_ids: "",
		...overrides,
	};
}

describe("forum-cache", () => {
	describe("getForumTree", () => {
		it("falls through to D1 when KV cache is disabled", async () => {
			const kv = createJsonKV();
			const rows = [makeTreeRow(), makeTreeRow({ id: 2, parent_id: 1, name: "Child" })];
			const db = createMockD1(rows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "false" });
			const ctx = createMockCtx();

			const result = await getForumTree(env, ctx);

			expect(result).toHaveLength(2);
			expect(result[0]?.id).toBe(1);
			expect(result[1]?.id).toBe(2);
			// KV should NOT be read
			expect(kv.get).not.toHaveBeenCalled();
			// KV should NOT be written
			expect(kv.put).not.toHaveBeenCalled();
			// D1 SHOULD be queried
			expect(db.prepare).toHaveBeenCalled();
		});

		it("returns cached data from KV when enabled and hit", async () => {
			const cachedTree: ForumTreeEntry[] = [
				{
					id: 1,
					parentId: 0,
					name: "Cached Forum",
					description: "",
					icon: "",
					displayOrder: 1,
					status: 1,
					visibility: "public",
					type: "group",
					moderators: "",
					moderatorIds: "",
					moderatorList: [],
				},
			];
			const kv = createJsonKV({
				"forums:tree:v1": JSON.stringify({ forums: cachedTree, cachedAt: Date.now() }),
			});
			const db = createMockD1([]); // Should NOT be called
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumTree(env, ctx);

			expect(result).toHaveLength(1);
			expect(result[0]?.name).toBe("Cached Forum");
			// D1 should NOT be queried
			expect(db.prepare).not.toHaveBeenCalled();
		});

		it("falls through to D1 when cached payload has invalid shape", async () => {
			// Corrupt payload: forums is not an array
			const kv = createJsonKV({
				"forums:tree:v1": JSON.stringify({ forums: "not-an-array", cachedAt: Date.now() }),
			});
			const rows = [makeTreeRow()];
			const db = createMockD1(rows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumTree(env, ctx);

			// Should fall through to D1 because validation fails
			expect(result).toHaveLength(1);
			expect(result[0]?.name).toBe("Root Forum");
			expect(db.prepare).toHaveBeenCalled();
		});

		it("falls through to D1 when cached entry is missing required fields", async () => {
			// Payload has forums array but entries lack required fields
			const kv = createJsonKV({
				"forums:tree:v1": JSON.stringify({
					forums: [{ noId: true, noName: true }],
					cachedAt: Date.now(),
				}),
			});
			const rows = [makeTreeRow()];
			const db = createMockD1(rows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumTree(env, ctx);

			expect(result).toHaveLength(1);
			expect(result[0]?.name).toBe("Root Forum");
			expect(db.prepare).toHaveBeenCalled();
		});

		it("falls through to D1 when stale KV payload lacks moderators field", async () => {
			// Simulates a pre-moderators-field cached entry (old schema)
			const kv = createJsonKV({
				"forums:tree:v1": JSON.stringify({
					forums: [
						{
							id: 1,
							parentId: 0,
							name: "Stale Forum",
							description: "",
							icon: "",
							displayOrder: 1,
							status: 1,
							visibility: "public",
							type: "group",
							// moderators field is MISSING — old schema
							moderatorIds: "",
							moderatorList: [],
						},
					],
					cachedAt: Date.now(),
				}),
			});
			const rows = [makeTreeRow()];
			const db = createMockD1(rows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumTree(env, ctx);

			// Should reject stale payload and fall through to D1
			expect(result).toHaveLength(1);
			expect(result[0]?.name).toBe("Root Forum");
			expect(db.prepare).toHaveBeenCalled();
		});

		it("falls through to D1 on KV miss and stores result", async () => {
			const kv = createJsonKV(); // empty — KV miss
			const rows = [makeTreeRow({ moderator_ids: "" })];
			const db = createMockD1(rows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumTree(env, ctx);

			expect(result).toHaveLength(1);
			expect(result[0]?.id).toBe(1);
			expect(result[0]?.name).toBe("Root Forum");
			// Should store in KV via waitUntil
			expect(ctx.waitUntil).toHaveBeenCalled();
		});

		it("falls through to D1 on KV read error", async () => {
			const kv = {
				get: vi.fn(async () => {
					throw new Error("KV read failure");
				}),
				put: vi.fn(async () => {}),
				delete: vi.fn(async () => {}),
			} as unknown as KVNamespace;
			const rows = [makeTreeRow()];
			const db = createMockD1(rows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumTree(env, ctx);

			// Should still return data from D1
			expect(result).toHaveLength(1);
			expect(db.prepare).toHaveBeenCalled();
		});

		it("maps D1 rows to ForumTreeEntry correctly", async () => {
			const kv = createJsonKV();
			const rows = [
				makeTreeRow({
					id: 5,
					parent_id: 2,
					name: "子版块",
					description: "A sub-forum",
					icon: "sub.png",
					display_order: 3,
					status: 1,
					visibility: "members",
					type: "sub",
					moderator_ids: "",
				}),
			];
			const db = createMockD1(rows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "false" });

			const result = await getForumTree(env);

			expect(result[0]).toEqual({
				id: 5,
				parentId: 2,
				name: "子版块",
				description: "A sub-forum",
				icon: "sub.png",
				displayOrder: 3,
				status: 1,
				visibility: "members",
				type: "sub",
				moderators: "",
				moderatorIds: "",
				moderatorList: [],
			});
		});

		it("fetches and resolves moderator names", async () => {
			const kv = createJsonKV();
			const rows = [makeTreeRow({ moderator_ids: "10,20" })];
			const modNames = [
				{ id: 10, username: "mod_alice" },
				{ id: 20, username: "mod_bob" },
			];
			const db = createMockD1(rows, modNames);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "false" });

			const result = await getForumTree(env);

			expect(result[0]?.moderatorList).toEqual([
				{ id: 10, name: "mod_alice" },
				{ id: 20, name: "mod_bob" },
			]);
		});

		it("awaits KV.put directly when no ctx (admin context)", async () => {
			const kv = createJsonKV();
			const rows = [makeTreeRow()];
			const db = createMockD1(rows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });

			// Call without ctx — simulating admin handler context
			const result = await getForumTree(env);

			expect(result).toHaveLength(1);
			// KV.put should have been called (awaited directly, not via waitUntil)
			expect(kv.put).toHaveBeenCalledWith(
				"forums:tree:v1",
				expect.any(String),
				expect.objectContaining({ expirationTtl: 600 }),
			);
		});
	});

	describe("invalidateForumTree", () => {
		it("deletes the tree key from KV", async () => {
			const kv = createJsonKV({ "forums:tree:v1": "some data" });
			const env = makeEnv({ KV: kv });

			await invalidateForumTree(env);

			expect(kv.delete).toHaveBeenCalledWith("forums:tree:v1");
		});

		it("does not throw on KV.delete failure", async () => {
			const kv = {
				get: vi.fn(),
				put: vi.fn(),
				delete: vi.fn(async () => {
					throw new Error("KV delete failure");
				}),
			} as unknown as KVNamespace;
			const env = makeEnv({ KV: kv });

			// Should not throw
			await expect(invalidateForumTree(env)).resolves.toBeUndefined();
		});
	});
});
