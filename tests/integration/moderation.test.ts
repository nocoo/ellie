// tests/integration/moderation.test.ts — L2: Moderation API integration tests
// Ref: 04-application §4.8.6

import { describe, expect, test } from "bun:test";
import { apiFetch, apiPost } from "./setup";

function modPost(body: Record<string, unknown>, role?: number): Promise<Response> {
	const headers: Record<string, string> = {};
	if (role !== undefined) headers["X-Mock-Role"] = String(role);
	return apiPost("/api/v1/moderation", body, headers);
}

describe("L2: POST /api/v1/moderation", () => {
	test("returns 403 without role header", async () => {
		const response = await modPost({ action: "sticky", threadId: 1 });
		expect(response.status).toBe(403);
	});

	test("returns 403 for regular user (role 0)", async () => {
		const response = await modPost({ action: "sticky", threadId: 1 }, 0);
		expect(response.status).toBe(403);
	});

	test("allows mod role (3) to perform actions", async () => {
		// Get a valid thread ID
		const listResponse = await apiFetch("/api/v1/threads?limit=1");
		const { data } = await listResponse.json();
		if (data.items.length === 0) return;

		const threadId = data.items[0].id;
		const response = await modPost({ action: "sticky", threadId }, 3);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.success).toBe(true);
	});

	test("allows admin role (1) to perform actions", async () => {
		const listResponse = await apiFetch("/api/v1/threads?limit=1");
		const { data } = await listResponse.json();
		if (data.items.length === 0) return;

		const threadId = data.items[0].id;
		const response = await modPost({ action: "digest", threadId }, 1);
		expect(response.status).toBe(200);
	});

	test("returns 400 for missing action", async () => {
		const listResponse = await apiFetch("/api/v1/threads?limit=1");
		const { data } = await listResponse.json();
		if (data.items.length === 0) return;

		const response = await modPost({ threadId: data.items[0].id }, 1);
		expect(response.status).toBe(400);
	});

	test("returns 400 for unknown action", async () => {
		const listResponse = await apiFetch("/api/v1/threads?limit=1");
		const { data } = await listResponse.json();
		if (data.items.length === 0) return;

		const response = await modPost({ action: "unknown", threadId: data.items[0].id }, 1);
		expect(response.status).toBe(400);
	});

	test("returns 404 for non-existent thread", async () => {
		const response = await modPost({ action: "sticky", threadId: 99999 }, 1);
		expect(response.status).toBe(404);
	});
});
