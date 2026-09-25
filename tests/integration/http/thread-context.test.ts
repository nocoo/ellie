import { describe, expect, test } from "bun:test";
import { createTestJwt, getApiKeyA, getApiKeyB, getWorkerUrl, workerPost } from "../setup";

function request(threadId: number, extra: Record<string, unknown> = {}) {
	return {
		threadId,
		limit: 20,
		cursor: null,
		last: false,
		cachedRevision: null,
		includeDisplay: true,
		includeStats: false,
		...extra,
	};
}

describe("L2: POST /api/v1/threads/context", () => {
	test("returns fresh authority and a reusable public display without changing view counts", async () => {
		const threadId = 1;
		const cold = await workerPost("/api/v1/threads/context", request(threadId));
		expect(cold.status).toBe(200);
		expect(cold.headers.get("cache-control")).toContain("no-store");
		const body = await cold.json();
		expect(body.meta.timestamp).toEqual(expect.any(Number));
		expect(body.meta.requestId).toEqual(expect.any(String));
		expect(body.data.thread.id).toBe(threadId);
		expect(body.data.user).toBeNull();
		expect(body.data.cacheable).toBe(true);
		expect(body.data.revision).toMatch(/^[a-f0-9]{64}$/);
		expect(body.data.display.posts.length).toBeLessThanOrEqual(20);
		expect(Array.isArray(body.data.display.attachments)).toBe(true);
		const hot = await workerPost(
			"/api/v1/threads/context",
			request(threadId, { cachedRevision: body.data.revision, includeDisplay: false }),
		);
		expect(hot.status).toBe(200);
		const warm = await hot.json();
		expect(warm.data.revision).toBe(body.data.revision);
		expect(warm.data.display).toBeUndefined();
		expect(warm.data.thread.views).toBe(body.data.thread.views);
		const last = await workerPost("/api/v1/threads/context", request(threadId, { last: true }));
		expect(last.status).toBe(200);
		expect((await last.json()).data.nextCursor).toBeNull();
	});

	test("never permits a staff reader to reuse a shared display", async () => {
		const threadId = 1;
		const jwt = await createTestJwt(1, 1);
		const cold = await workerPost("/api/v1/threads/context", request(threadId), jwt);
		expect(cold.status).toBe(200);
		const body = await cold.json();
		expect(body.data.cacheable).toBe(false);
		const hot = await workerPost(
			"/api/v1/threads/context",
			request(threadId, { cachedRevision: body.data.revision, includeDisplay: false }),
			jwt,
		);
		expect(hot.status).toBe(200);
		expect((await hot.json()).data.display).toBeDefined();
	});

	test("rejects invalid authority and malformed selections before returning content", async () => {
		expect((await workerPost("/api/v1/threads/context", request(999999999))).status).toBe(404);
		expect((await workerPost("/api/v1/threads/context", request(1), "invalid-token")).status).toBe(
			401,
		);
		expect(
			(await workerPost("/api/v1/threads/context", request(1, { unknown: true }))).status,
		).toBe(400);
		expect((await workerPost("/api/v1/threads/context", request(1, { limit: 101 }))).status).toBe(
			400,
		);
		expect(
			(await workerPost("/api/v1/threads/context", request(1, { cursor: "bad" }))).status,
		).toBe(400);
		const denied = await fetch(`${getWorkerUrl()}/api/v1/threads/context`, {
			method: "POST",
			headers: { "X-API-Key": getApiKeyB(), "Content-Type": "application/json" },
			body: JSON.stringify(request(1)),
		});
		expect(denied.status).toBe(401);
		const query = await fetch(`${getWorkerUrl()}/api/v1/threads/context?page=1`, {
			method: "POST",
			headers: { "X-API-Key": getApiKeyA(), "Content-Type": "application/json" },
			body: JSON.stringify(request(1)),
		});
		expect(query.status).toBe(400);
	});
});
