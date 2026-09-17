import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { batchGet } from "../../../src/handlers/user";
import { getPublicUsers } from "../../../src/lib/cache/user-read";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	f = readingFixture();
});
afterEach(() => f.close());
const request = (ids: string) =>
	new Request(`https://api.example.com/api/v1/users/batch?ids=${ids}`);
describe("batch user caches", () => {
	it("deduplicates and omits invalid/missing/hidden users without per-ID SQL", async () => {
		f.sqlite.exec("UPDATE users SET status=-1 WHERE id=20");
		const result = await (await batchGet(request("10,20,999,10,-1,abc"), f.env)).json();
		expect(result.data.map((row: { id: number }) => row.id)).toEqual([10]);
		expect(f.calls).toHaveLength(3);
		f.calls.length = 0;
		await batchGet(request("10,20,999"), f.env);
		expect(f.calls).toHaveLength(1);
	});
	it("never leaks credentials or public IPs", async () => {
		f.sqlite.exec(
			"UPDATE users SET reg_ip='secret',last_ip='secret',email='private@example.com' WHERE id=10",
		);
		const response = await batchGet(request("10"), f.env);
		const text = await response.text();
		expect(text).not.toMatch(/password|secret|private@example|regIp|lastIp/);
	});
	it("validates the 100-ID endpoint bound", async () => {
		expect((await batchGet(request(""), f.env)).status).toBe(400);
		expect(
			(
				await batchGet(
					request(Array.from({ length: 101 }, (_, i) => String(i + 1)).join(",")),
					f.env,
				)
			).status,
		).toBe(400);
		expect((await (await batchGet(request("abc,-1,0"), f.env)).json()).data).toEqual([]);
	});
	it("batches 206 profiles and queries only misses for each tier", async () => {
		const ids = Array.from({ length: 206 }, (_, i) => i + 1000);
		for (const id of ids) f.insert("users", { id, username: `user${id}` });
		await getPublicUsers(f.env, undefined, ids.slice(0, 100), "public");
		f.calls.length = 0;
		expect((await getPublicUsers(f.env, undefined, ids, "public")).size).toBe(206);
		expect(f.calls).toHaveLength(4);
		expect(f.calls.every((c) => c.params.every((id) => Number(id) >= 1100))).toBe(true);
		expect(Math.max(...f.calls.map((c) => c.params.length))).toBe(80);
	});
});
