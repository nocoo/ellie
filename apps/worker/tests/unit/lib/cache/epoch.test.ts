import { afterEach, describe, expect, it, vi } from "vitest";
import { bumpGen, getGen, getGens } from "../../../../src/lib/cache/epoch";
import { createMockKV, makeEnv } from "../../../helpers";

afterEach(() => vi.restoreAllMocks());

describe("resource generations", () => {
	it("100 missing-version readers share the schema initial token without seeding KV", async () => {
		const env = makeEnv();
		expect(
			new Set(await Promise.all(Array.from({ length: 100 }, () => getGen(env, "forum:tree:gen")))),
		).toEqual(new Set(["0"]));
		expect(env.KV.put).not.toHaveBeenCalled();
	});
	it("reads current tokens on each request instead of memoizing completed versions", async () => {
		const env = makeEnv({ KV: createMockKV({ k: "old" }) });
		expect(await getGen(env, "k")).toBe("old");
		await env.KV.put("k", "new");
		expect(await getGen(env, "k")).toBe("new");
	});
	it("marks version-read failure unavailable without inventing or writing a token", async () => {
		const env = makeEnv();
		vi.mocked(env.KV.get).mockRejectedValue(new Error("KV unavailable"));
		expect(await getGen(env, "k")).toBe("!unavailable");
		expect(env.KV.put).not.toHaveBeenCalled();
	});
	it("confirms unique changes even in the same millisecond", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1700000000000);
		const env = makeEnv();
		const a = await bumpGen(env, "k");
		const b = await bumpGen(env, "k");
		expect(a).not.toBe(b);
		expect(b).toMatch(/^1700000000000-/);
		expect(await getGen(env, "k")).toBe(b);
	});
	it("rejects a failed version write, preserving the existing token", async () => {
		const env = makeEnv({ KV: createMockKV({ k: "old" }) });
		vi.mocked(env.KV.put).mockRejectedValue(new Error("429"));
		await expect(bumpGen(env, "k")).rejects.toThrow("429");
		expect(await getGen(env, "k")).toBe("old");
	});
});

describe("bulk resource generations", () => {
	it("preserves tokens, missing versions and deduplication across bounded batches", async () => {
		const env = makeEnv({ KV: createMockKV({ k0: "edited" }) });
		const keys = Array.from({ length: 101 }, (_, id) => `k${id}`);
		const result = await getGens(env, [...keys, "k0"]);
		expect(result.size).toBe(101);
		expect(result.get("k0")).toBe("edited");
		expect(result.get("k100")).toBe("0");
		expect(vi.mocked(env.KV.get).mock.calls.map(([batch]) => batch.length)).toEqual([100, 1]);
		expect(env.KV.put).not.toHaveBeenCalled();
	});

	it("bypasses every version in a failed or malformed batch, and does no I/O for no keys", async () => {
		const env = makeEnv();
		expect(await getGens(env, [])).toEqual(new Map());
		expect(env.KV.get).not.toHaveBeenCalled();
		vi.mocked(env.KV.get).mockRejectedValueOnce(new Error("unavailable"));
		expect(await getGens(env, ["a", "b"])).toEqual(
			new Map([
				["a", "!unavailable"],
				["b", "!unavailable"],
			]),
		);
		vi.mocked(env.KV.get).mockResolvedValueOnce(null);
		expect(await getGens(env, ["a"])).toEqual(new Map([["a", "!unavailable"]]));
	});
});
