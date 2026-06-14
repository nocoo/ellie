import { describe, expect, test } from "vitest";
import { createMockKV, createMockR2 } from "../../../src/test-support/mocks";

describe("createMockKV", () => {
	test("get returns null for missing key", async () => {
		const kv = createMockKV();
		expect(await kv.get("missing")).toBeNull();
	});

	test("get returns string value when stored", async () => {
		const kv = createMockKV({ foo: "bar" });
		expect(await kv.get("foo")).toBe("bar");
	});

	test("get with type=json parses JSON", async () => {
		const kv = createMockKV({ data: JSON.stringify({ n: 7 }) });
		expect(await kv.get<{ n: number }>("data", "json")).toEqual({ n: 7 });
	});

	test("get with type=json returns null on invalid JSON", async () => {
		const kv = createMockKV({ data: "not-json" });
		expect(await kv.get("data", "json")).toBeNull();
	});

	test("put stores values readable by get", async () => {
		const kv = createMockKV();
		await kv.put("k", "v");
		expect(await kv.get("k")).toBe("v");
	});

	test("delete removes the key", async () => {
		const kv = createMockKV({ foo: "bar" });
		await kv.delete("foo");
		expect(await kv.get("foo")).toBeNull();
	});

	test("getWithMetadata returns value + null metadata", async () => {
		const kv = createMockKV({ foo: "bar" });
		const result = await kv.getWithMetadata("foo");
		expect(result.value).toBe("bar");
		expect(result.metadata).toBeNull();
	});

	test("list returns sorted keys filtered by prefix", async () => {
		const kv = createMockKV({
			"online:1": "a",
			"online:3": "c",
			"online:2": "b",
			"other:9": "x",
		});
		const r = await kv.list({ prefix: "online:" });
		expect(r.keys.map((k) => k.name)).toEqual(["online:1", "online:2", "online:3"]);
		expect(r.list_complete).toBe(true);
	});

	test("list paginates via limit + cursor", async () => {
		const kv = createMockKV({ a: "1", b: "2", c: "3", d: "4" });
		const page1 = await kv.list({ limit: 2 });
		expect(page1.keys.map((k) => k.name)).toEqual(["a", "b"]);
		expect(page1.list_complete).toBe(false);
		expect(page1.cursor).toBe("b");

		const page2 = await kv.list({ limit: 2, cursor: page1.cursor });
		expect(page2.keys.map((k) => k.name)).toEqual(["c", "d"]);
		expect(page2.list_complete).toBe(true);
	});

	test("list defaults to empty prefix and large limit", async () => {
		const kv = createMockKV({ x: "1" });
		const r = await kv.list();
		expect(r.keys.length).toBe(1);
		expect(r.list_complete).toBe(true);
	});
});

describe("createMockR2", () => {
	test("put + get round-trips an ArrayBuffer", async () => {
		const r2 = createMockR2();
		const body = new TextEncoder().encode("hello").buffer;
		const written = await r2.put("k", body, {
			httpMetadata: { contentType: "text/plain" },
		});
		expect(written?.key).toBe("k");
		expect(written?.size).toBe(5);

		const obj = await r2.get("k");
		expect(obj).not.toBeNull();
		const buf = await obj?.arrayBuffer();
		expect(buf).toBeDefined();
		expect(new TextDecoder().decode(buf as ArrayBuffer)).toBe("hello");
		expect(obj?.httpMetadata?.contentType).toBe("text/plain");
	});

	test("put accepts a string body and stores it as utf8", async () => {
		const r2 = createMockR2();
		await r2.put("k", "abc");
		const obj = await r2.get("k");
		expect(obj).not.toBeNull();
		const buf = await obj?.arrayBuffer();
		expect(buf).toBeDefined();
		expect(new TextDecoder().decode(buf as ArrayBuffer)).toBe("abc");
	});

	test("get returns null for missing key", async () => {
		const r2 = createMockR2();
		expect(await r2.get("nope")).toBeNull();
	});

	test("delete removes the object", async () => {
		const r2 = createMockR2();
		await r2.put("k", "v");
		await r2.delete("k");
		expect(await r2.get("k")).toBeNull();
	});

	test("put throws when configured with a putError", async () => {
		const r2 = createMockR2({ putError: new Error("boom") });
		await expect(r2.put("k", "v")).rejects.toThrow("boom");
	});

	test("_putCalls records put invocations", async () => {
		const r2 = createMockR2();
		await r2.put("a", "1");
		await r2.put("b", "2");
		expect(r2._putCalls.length).toBe(2);
		expect(r2._putCalls[0].key).toBe("a");
		expect(r2._putCalls[1].key).toBe("b");
	});

	test("get returns a body ReadableStream", async () => {
		const r2 = createMockR2();
		await r2.put("k", "stream-me");
		const obj = await r2.get("k");
		expect(obj?.body).toBeDefined();
		// drain the stream and confirm contents
		const reader = (obj?.body as ReadableStream<Uint8Array>).getReader();
		const chunks: Uint8Array[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) chunks.push(value);
		}
		const merged = chunks.reduce((acc, cur) => {
			const out = new Uint8Array(acc.length + cur.length);
			out.set(acc);
			out.set(cur, acc.length);
			return out;
		}, new Uint8Array(0));
		expect(new TextDecoder().decode(merged)).toBe("stream-me");
	});
});
