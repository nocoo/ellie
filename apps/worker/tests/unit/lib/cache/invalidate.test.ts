import { describe, expect, it, vi } from "vitest";
import {
	affectsForumDigest,
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpForumTreeGen,
	bumpPostListGen,
	bumpThreadListGen,
	bumpThreadListGenAll,
	bumpThreadMetaGen,
	deleteUserMini,
	deleteUserPublicVariants,
	FORUM_DIGEST_AFFECTING_COLUMNS,
	invalidateForumReorderV2,
	invalidateForumStructureV2,
	invalidateForumSummaryV2,
	invalidateForumUpdateV2,
	invalidateForumVolatileV2,
	invalidateThreadListForForums,
	invalidateUserCaches,
} from "../../../../src/lib/cache/invalidate";
import { makeEnv } from "../../../helpers";

function inMemoryKV(initial: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initial));
	const kv = {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	} as unknown as KVNamespace;
	return { kv, store };
}

describe("cache/invalidate — single-key delete helpers", () => {
	it("deleteUserMini deletes user:mini:v2:<id>", async () => {
		const { kv, store } = inMemoryKV({ "user:mini:v2:42": "x" });
		const env = makeEnv({ KV: kv });
		await deleteUserMini(env, 42);
		expect(store.has("user:mini:v2:42")).toBe(false);
		expect(kv.delete).toHaveBeenCalledWith("user:mini:v2:42");
	});

	it("deleteUserMini swallows KV failures", async () => {
		const env = makeEnv({
			KV: {
				get: vi.fn(),
				put: vi.fn(),
				delete: vi.fn(async () => {
					throw new Error("kv down");
				}),
			} as unknown as KVNamespace,
		});
		await expect(deleteUserMini(env, 1)).resolves.toBeUndefined();
	});

	it("deleteUserPublicVariants deletes BOTH viewer-bucket variants", async () => {
		const { kv, store } = inMemoryKV({
			"user:public:v2:7:public": "a",
			"user:public:v2:7:staff": "b",
		});
		const env = makeEnv({ KV: kv });

		await deleteUserPublicVariants(env, 7);
		expect(store.has("user:public:v2:7:public")).toBe(false);
		expect(store.has("user:public:v2:7:staff")).toBe(false);
		expect(kv.delete).toHaveBeenCalledWith("user:public:v2:7:public");
		expect(kv.delete).toHaveBeenCalledWith("user:public:v2:7:staff");
	});

	it("deleteUserPublicVariants is safe when neither variant exists", async () => {
		const { kv } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		await expect(deleteUserPublicVariants(env, 99)).resolves.toBeUndefined();
	});

	it("invalidateUserCaches calls mini + both public variants", async () => {
		const { kv } = inMemoryKV({
			"user:mini:v2:5": "x",
			"user:public:v2:5:public": "y",
			"user:public:v2:5:staff": "z",
		});
		const env = makeEnv({ KV: kv });

		await invalidateUserCaches(env, 5);
		expect(kv.delete).toHaveBeenCalledWith("user:mini:v2:5");
		expect(kv.delete).toHaveBeenCalledWith("user:public:v2:5:public");
		expect(kv.delete).toHaveBeenCalledWith("user:public:v2:5:staff");
	});
});

describe("cache/invalidate — gen bump helpers", () => {
	it("bumpForumTreeGen writes forum:tree:gen", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		const tok = await bumpForumTreeGen(env);
		expect(store.get("forum:tree:gen")).toBe(tok);
	});

	it("bumpForumSummaryGen writes forum:summary:gen", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		const tok = await bumpForumSummaryGen(env);
		expect(store.get("forum:summary:gen")).toBe(tok);
	});

	it("bumpThreadListGen scopes per forumId", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		const tok = await bumpThreadListGen(env, 9);
		expect(store.get("thread:list:gen:9")).toBe(tok);
	});

	it("bumpThreadListGenAll writes thread:list:gen:all (global)", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		const tok = await bumpThreadListGenAll(env);
		expect(store.get("thread:list:gen:all")).toBe(tok);
		// Must NOT touch any per-forum gen.
		expect(store.has("thread:list:gen:1")).toBe(false);
		expect(store.has("thread:list:gen:42")).toBe(false);
	});

	it("bumpThreadMetaGen scopes per threadId", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		const tok = await bumpThreadMetaGen(env, 12);
		expect(store.get("thread:meta:gen:12")).toBe(tok);
	});

	it("bumpPostListGen scopes per threadId", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		const tok = await bumpPostListGen(env, 12);
		expect(store.get("post:list:gen:12")).toBe(tok);
	});

	it("bumpDigestGen writes digest:gen", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		const tok = await bumpDigestGen(env);
		expect(store.get("digest:gen")).toBe(tok);
	});
});

describe("cache/invalidate — composite helpers", () => {
	it("invalidateForumVolatileV2 bumps summary + per-forum thread list", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		await invalidateForumVolatileV2(env, 4);

		expect(store.get("forum:summary:gen")?.length).toBeGreaterThan(0);
		expect(store.get("thread:list:gen:4")?.length).toBeGreaterThan(0);
	});

	it("invalidateThreadListForForums bumps each per-forum gen exactly once (dedupes)", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		await invalidateThreadListForForums(env, [3, 7, 3, 11, 7]);
		expect(store.get("thread:list:gen:3")?.length).toBeGreaterThan(0);
		expect(store.get("thread:list:gen:7")?.length).toBeGreaterThan(0);
		expect(store.get("thread:list:gen:11")?.length).toBeGreaterThan(0);
		// Did not touch the global gen.
		expect(store.has("thread:list:gen:all")).toBe(false);
	});

	it("invalidateThreadListForForums is a no-op for empty input", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		await invalidateThreadListForForums(env, []);
		expect(store.size).toBe(0);
		expect(kv.put).not.toHaveBeenCalled();
	});

	it("invalidateForumSummaryV2 bumps ONLY forum:summary:gen", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		await invalidateForumSummaryV2(env);

		expect(store.get("forum:summary:gen")?.length).toBeGreaterThan(0);
		expect(store.has("forum:tree:gen")).toBe(false);
		expect(store.has("digest:gen")).toBe(false);
	});

	it("invalidateForumStructureV2 bumps tree + summary + digest", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		await invalidateForumStructureV2(env);

		expect(store.get("forum:tree:gen")?.length).toBeGreaterThan(0);
		expect(store.get("forum:summary:gen")?.length).toBeGreaterThan(0);
		expect(store.get("digest:gen")?.length).toBeGreaterThan(0);
	});

	it("invalidateForumReorderV2 bumps tree + summary but NOT digest", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });
		await invalidateForumReorderV2(env);

		expect(store.get("forum:tree:gen")?.length).toBeGreaterThan(0);
		expect(store.get("forum:summary:gen")?.length).toBeGreaterThan(0);
		expect(store.has("digest:gen")).toBe(false);
	});

	it("invalidateForumUpdateV2 bumps digest only when affectsDigest=true", async () => {
		const { kv: kv1, store: s1 } = inMemoryKV();
		const env1 = makeEnv({ KV: kv1 });
		await invalidateForumUpdateV2(env1, { affectsDigest: true });
		expect(s1.get("forum:tree:gen")?.length).toBeGreaterThan(0);
		expect(s1.get("forum:summary:gen")?.length).toBeGreaterThan(0);
		expect(s1.get("digest:gen")?.length).toBeGreaterThan(0);

		const { kv: kv2, store: s2 } = inMemoryKV();
		const env2 = makeEnv({ KV: kv2 });
		await invalidateForumUpdateV2(env2, { affectsDigest: false });
		expect(s2.get("forum:tree:gen")?.length).toBeGreaterThan(0);
		expect(s2.get("forum:summary:gen")?.length).toBeGreaterThan(0);
		expect(s2.has("digest:gen")).toBe(false);
	});
});

describe("affectsForumDigest — single source of truth for digest-affecting columns", () => {
	it("FORUM_DIGEST_AFFECTING_COLUMNS lists exactly the snake-case digest-affecting columns", () => {
		// Lock in the contract — adding/removing a column here is a
		// deliberate digest-semantics change that must be reviewed.
		expect([...FORUM_DIGEST_AFFECTING_COLUMNS]).toEqual([
			"name",
			"status",
			"visibility",
			"parent_id",
			"type",
		]);
	});

	it.each(FORUM_DIGEST_AFFECTING_COLUMNS)("returns true when %s is updated", (col) => {
		expect(affectsForumDigest({ [col]: "x" })).toBe(true);
	});

	it("returns false for non-digest-affecting columns (description, icon, display_order, moderators…)", () => {
		expect(affectsForumDigest({ description: "x" })).toBe(false);
		expect(affectsForumDigest({ icon: "x" })).toBe(false);
		expect(affectsForumDigest({ display_order: 7 })).toBe(false);
		expect(affectsForumDigest({ moderators: "alice" })).toBe(false);
		expect(affectsForumDigest({ moderator_ids: "1,2" })).toBe(false);
	});

	it("returns false for an empty payload", () => {
		expect(affectsForumDigest({})).toBe(false);
	});

	it("does NOT trigger on the camelCase API field name (parentId is wrong; column is parent_id)", () => {
		// Guards against the regression where the handler reads the API
		// camelCase key instead of the DB snake_case column.
		expect(affectsForumDigest({ parentId: 5 })).toBe(false);
		expect(affectsForumDigest({ parent_id: 5 })).toBe(true);
	});
});
