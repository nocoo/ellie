import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/internal/memory-cache/route";
import { getMemoryRuntime } from "@/lib/memory-runtime";

const url = "http://localhost/api/internal/memory-cache";
const key = "local-memory-test-key";
function request(body: unknown): Request {
	return new Request(url, {
		method: "POST",
		headers: { "X-Ellie-Memory-Key": key, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.stubEnv("MEMORY_CACHE_ADMIN_KEY", key);
	getMemoryRuntime().clear();
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("Web memory management boundary", () => {
	it("requires its own configured secret for all reads and writes", async () => {
		vi.stubEnv("MEMORY_CACHE_ADMIN_KEY", "");
		expect((await GET(new Request(url))).status).toBe(503);
		vi.stubEnv("MEMORY_CACHE_ADMIN_KEY", key);
		for (const headers of [{}, { "X-Ellie-Memory-Key": "wrong" }, { "X-API-Key": key }]) {
			const response = await GET(new Request(url, { headers }));
			expect(response.status).toBe(401);
			expect(response.headers.get("cache-control")).toBe("no-store");
		}
		expect((await POST(new Request(url, { method: "POST" }))).status).toBe(401);
	});

	it("returns the actual singleton and validates overview filters", async () => {
		await getMemoryRuntime().read("forum-summary", "anon:1", async () => 3);
		const response = await GET(
			new Request(`${url}?family=forum-summary&page=1&limit=1`, {
				headers: { "X-Ellie-Memory-Key": key },
			}),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = await response.json();
		expect(body.data.instance.id).toBe(getMemoryRuntime().id);
		expect(body.data.entries).toHaveLength(1);
		expect(JSON.stringify(body)).not.toContain(key);
		expect(
			(await GET(new Request(`${url}?family=unknown`, { headers: { "X-Ellie-Memory-Key": key } })))
				.status,
		).toBe(400);
	});

	it("fences old instances before mutation and clears only selected display entries", async () => {
		const runtime = getMemoryRuntime();
		await runtime.read("forum-summary", "1", async () => 1);
		await runtime.read("forum-summary", "2", async () => 2);
		const stale = await POST(request({ instanceId: "old-instance", action: "clear" }));
		expect(stale.status).toBe(409);
		expect(runtime.snapshot({ page: 1, limit: 50 }).entries).toHaveLength(2);
		for (const selectors of [
			{ family: "forum-summary", key: "1" },
			{ family: "forum-summary" },
			{},
		]) {
			const response = await POST(
				request({ instanceId: runtime.id, action: "clear", ...selectors }),
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ data: { ok: true } });
		}
		expect(runtime.snapshot({ page: 1, limit: 50 }).entries).toHaveLength(0);
	});

	it("rejects unknown mutations, oversized and malformed streamed bodies", async () => {
		for (const body of [
			{ action: "edit" },
			{ instanceId: getMemoryRuntime().id, action: "flush", family: "home-display" },
			{ padding: "x".repeat(4096) },
		]) {
			expect((await POST(request(body))).status).toBe(400);
		}
		expect(
			(
				await POST(
					new Request(url, { method: "POST", headers: { "X-Ellie-Memory-Key": key }, body: "{" }),
				)
			).status,
		).toBe(400);
	});

	it("requires writer configuration for flush and permits a configured empty flush", async () => {
		vi.stubEnv("WEB_STATISTICS_WRITE_KEY", "");
		const body = { instanceId: getMemoryRuntime().id, action: "flush" };
		expect((await POST(request(body))).status).toBe(503);
		vi.stubEnv("WEB_STATISTICS_WRITE_KEY", "local-writer");
		vi.stubEnv("WORKER_API_URL", "http://127.0.0.1:8787");
		expect((await POST(request(body))).status).toBe(200);
	});
});
