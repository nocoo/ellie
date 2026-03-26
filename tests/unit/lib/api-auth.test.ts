import { describe, expect, test } from "bun:test";
import { getAuthUserId } from "@/lib/api-auth";

describe("getAuthUserId", () => {
	test("returns null without auth header", async () => {
		const request = new Request("http://localhost/api/v1/threads", {
			method: "POST",
		});
		const userId = await getAuthUserId(request);
		expect(userId).toBeNull();
	});

	test("returns user ID from X-Mock-Uid header", async () => {
		const request = new Request("http://localhost/api/v1/threads", {
			method: "POST",
			headers: { "X-Mock-Uid": "42" },
		});
		const userId = await getAuthUserId(request);
		expect(userId).toBe(42);
	});

	test("returns null for empty X-Mock-Uid header", async () => {
		const request = new Request("http://localhost/api/v1/threads", {
			method: "POST",
			headers: { "X-Mock-Uid": "" },
		});
		const userId = await getAuthUserId(request);
		expect(userId).toBeNull();
	});

	test("returns numeric ID from string header", async () => {
		const request = new Request("http://localhost/api/v1/threads", {
			method: "POST",
			headers: { "X-Mock-Uid": "1" },
		});
		const userId = await getAuthUserId(request);
		expect(userId).toBe(1);
	});
});
