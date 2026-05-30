import { describe, expect, it, vi } from "vitest";
import { bumpGen, getGen } from "../../../../src/lib/cache/epoch";
import { makeEnv } from "../../../helpers";

function inMemoryKV() {
	const store = new Map<string, string>();
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

describe("cache/epoch — getGen", () => {
	it("returns existing token when KV has one", async () => {
		const { kv, store } = inMemoryKV();
		store.set("forum:tree:gen", "preset-token");
		const env = makeEnv({ KV: kv });

		const v = await getGen(env, "forum:tree:gen");
		expect(v).toBe("preset-token");
	});

	it("seeds and returns a token when KV is empty", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });

		const v = await getGen(env, "forum:tree:gen");
		expect(v).not.toBe("");
		expect(store.get("forum:tree:gen")).toBe(v);
		expect(kv.put).toHaveBeenCalled();
	});

	it("does NOT memoize across module: subsequent reads see latest KV value", async () => {
		// Simulates a different request that bumped the gen between two
		// getGen calls. A module-level memo would return the stale token.
		const { kv, store } = inMemoryKV();
		store.set("k", "v1");
		const env = makeEnv({ KV: kv });

		expect(await getGen(env, "k")).toBe("v1");
		store.set("k", "v2");
		expect(await getGen(env, "k")).toBe("v2");
	});

	it("survives KV.get failure by seeding a fresh token", async () => {
		const env = makeEnv({
			KV: {
				get: vi.fn(async () => {
					throw new Error("kv down");
				}),
				put: vi.fn(async () => {}),
				delete: vi.fn(async () => {}),
			} as unknown as KVNamespace,
		});

		const v = await getGen(env, "k");
		expect(v.length).toBeGreaterThan(0);
	});

	it("swallows KV.put failure when seeding and returns token anyway", async () => {
		const env = makeEnv({
			KV: {
				get: vi.fn(async () => null), // Empty — triggers seed path
				put: vi.fn(async () => {
					throw new Error("kv write down");
				}),
				delete: vi.fn(async () => {}),
			} as unknown as KVNamespace,
		});

		// Should return a valid token even though put failed
		const v = await getGen(env, "k");
		expect(v).toMatch(/^\d+-/);
	});
});

describe("cache/epoch — bumpGen", () => {
	it("writes a fresh token to KV and returns it", async () => {
		const { kv, store } = inMemoryKV();
		const env = makeEnv({ KV: kv });

		const v = await bumpGen(env, "k");
		expect(store.get("k")).toBe(v);
		expect(kv.put).toHaveBeenCalled();
		expect((kv.put as ReturnType<typeof vi.fn>).mock.calls[0]?.slice(0, 2)).toEqual(["k", v]);
	});

	it("produces unique tokens even within the same millisecond", async () => {
		const { kv } = inMemoryKV();
		const env = makeEnv({ KV: kv });

		// Freeze Date.now so bumps would collide if only Date.now were used.
		vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
		try {
			const a = await bumpGen(env, "k");
			const b = await bumpGen(env, "k");
			expect(a).not.toBe(b);
			expect(a.startsWith("1700000000000-")).toBe(true);
			expect(b.startsWith("1700000000000-")).toBe(true);
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("swallows KV.put failures without throwing", async () => {
		const env = makeEnv({
			KV: {
				get: vi.fn(),
				put: vi.fn(async () => {
					throw new Error("kv down");
				}),
				delete: vi.fn(),
			} as unknown as KVNamespace,
		});

		await expect(bumpGen(env, "k")).resolves.toMatch(/^\d+-/);
	});
});
