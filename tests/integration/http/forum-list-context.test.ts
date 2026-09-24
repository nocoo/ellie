import { describe, expect, test } from "bun:test";
import { getApiKeyA, getApiKeyB, getWorkerUrl, workerFetch, workerPost } from "../setup";

function request(forumId: number, overrides: Record<string, unknown> = {}) {
	return {
		forumId,
		page: 1,
		limit: 20,
		typeId: null,
		cachedBucket: null,
		cachedRevision: null,
		includeDisplay: true,
		includeStats: false,
		includeCount: true,
		...overrides,
	};
}

describe("L2: POST /api/v1/forums/context", () => {
	test("returns a no-store forum list context and a warm revision without display", async () => {
		const list = await workerFetch("/api/v1/forums?view=structure");
		expect(list.status).toBe(200);
		const forums = (await list.json()).data as { id: number; type: string }[];
		const forum = forums.find((row) => row.type !== "group") ?? forums[0];
		expect(forum).toBeTruthy();
		const cold = await workerPost("/api/v1/forums/context", request(forum.id));
		expect(cold.status).toBe(200);
		expect(cold.headers.get("cache-control")).toContain("no-store");
		const body = await cold.json();
		expect(body.meta.requestId).toEqual(expect.any(String));
		expect(body.data.bucket).toBe("anon");
		expect(body.data.user).toBeNull();
		expect(body.data.revision).toMatch(/^[a-f0-9]{64}$/);
		expect(body.data.page).toBe(1);
		expect(body.data.limit).toBe(20);
		expect(body.data.display.forums.some((row: { id: number }) => row.id === forum.id)).toBe(true);
		expect(body.data.display.threads.length).toBeLessThanOrEqual(20);
		expect(body.data.display.recommended.length).toBeLessThanOrEqual(6);
		expect(typeof body.data.hasNext).toBe("boolean");
		expect(body.data.count).toEqual(expect.any(Number));

		const hot = await workerPost(
			"/api/v1/forums/context",
			request(forum.id, {
				cachedBucket: body.data.bucket,
				cachedRevision: body.data.revision,
				includeDisplay: false,
				includeCount: false,
				typeId: body.data.typeId,
			}),
		);
		expect(hot.status).toBe(200);
		const warm = await hot.json();
		expect(warm.data.revision).toBe(body.data.revision);
		expect(warm.data.display).toBeUndefined();
		expect(warm.data.count).toBeUndefined();
		expect(warm.data.hasNext).toBe(body.data.hasNext);
	});

	test("rejects malformed input, a bad token, Key B, and a missing forum", async () => {
		const sample = request(1);
		expect((await workerPost("/api/v1/forums/context", { ...sample, extra: true })).status).toBe(
			400,
		);
		expect((await workerPost("/api/v1/forums/context", sample, "invalid-token")).status).toBe(401);
		expect((await workerPost("/api/v1/forums/context", request(999999999))).status).toBe(404);
		const denied = await fetch(`${getWorkerUrl()}/api/v1/forums/context`, {
			method: "POST",
			headers: {
				"X-API-Key": getApiKeyB(),
				"Content-Type": "application/json",
			},
			body: JSON.stringify(sample),
		});
		expect(denied.status).toBe(401);
		const queried = await fetch(`${getWorkerUrl()}/api/v1/forums/context?page=2`, {
			method: "POST",
			headers: {
				"X-API-Key": getApiKeyA(),
				"Content-Type": "application/json",
			},
			body: JSON.stringify(sample),
		});
		expect(queried.status).toBe(400);
	});
});
