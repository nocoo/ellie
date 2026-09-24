import { describe, expect, test } from "bun:test";
import { workerPost } from "../setup";

describe("L2: POST /api/v1/home/context", () => {
	test("returns a no-store home context envelope", async () => {
		const res = await workerPost("/api/v1/home/context", {
			cachedBucket: null,
			includeDisplay: true,
			includeStats: false,
			summaryTopicIds: [],
			digestTopicIds: [],
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toContain("no-store");
		const body = await res.json();
		expect(body.meta.timestamp).toEqual(expect.any(Number));
		expect(body.meta.requestId).toEqual(expect.any(String));
		expect(body.data.bucket).toBe("anon");
		expect(body.data.user).toBeNull();
		expect(Array.isArray(body.data.allowedForumIds)).toBe(true);
		expect(Array.isArray(body.data.summaryGates)).toBe(true);
		expect(Array.isArray(body.data.digestGates)).toBe(true);
		expect(Array.isArray(body.data.display.forums)).toBe(true);
		expect(body.data.display.digest.length).toBeLessThanOrEqual(5);
	});
	test("rejects malformed candidates and invalid bearer tokens over real HTTP", async () => {
		const request = {
			cachedBucket: "anon",
			includeDisplay: false,
			includeStats: false,
			summaryTopicIds: [],
			digestTopicIds: [],
		};
		const invalid = await workerPost("/api/v1/home/context", {
			...request,
			summaryTopicIds: [1, 1],
		});
		expect(invalid.status).toBe(400);
		const unauthorized = await workerPost("/api/v1/home/context", request, "invalid-token");
		expect(unauthorized.status).toBe(401);
		const hot = await workerPost("/api/v1/home/context", request);
		expect(hot.status).toBe(200);
		const body = await hot.json();
		expect(body.data.display).toBeUndefined();
		expect(body.data.stats).toBeUndefined();
	});
});
