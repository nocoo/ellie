// tests/integration/threads.test.ts — L2: Thread API integration tests
// Ref: 04-application §4.8.3

import { describe, expect, test } from "bun:test";
import { apiFetch, apiPost } from "./setup";

describe("L2: GET /api/v1/threads", () => {
	test("returns paginated thread list", async () => {
		const response = await apiFetch("/api/v1/threads");
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(Array.isArray(json.data.items)).toBe(true);
		expect(typeof json.data.total).toBe("number");
	});

	test("supports forumId filter", async () => {
		const response = await apiFetch("/api/v1/threads?forumId=2");
		expect(response.status).toBe(200);
		const json = await response.json();
		for (const thread of json.data.items) {
			expect(thread.forumId).toBe(2);
		}
	});

	test("supports limit parameter", async () => {
		const response = await apiFetch("/api/v1/threads?limit=2");
		const json = await response.json();
		expect(json.data.items.length).toBeLessThanOrEqual(2);
	});

	test("supports title search", async () => {
		const response = await apiFetch("/api/v1/threads?search=test");
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("supports author search", async () => {
		const response = await apiFetch("/api/v1/threads?author=admin");
		expect(response.status).toBe(200);
	});
});

describe("L2: GET /api/v1/threads/:id", () => {
	test("returns thread by valid ID", async () => {
		// Get a valid thread ID first
		const listResponse = await apiFetch("/api/v1/threads?limit=1");
		const { data } = await listResponse.json();
		if (data.items.length === 0) return; // No threads

		const threadId = data.items[0].id;
		const response = await apiFetch(`/api/v1/threads/${threadId}`);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data.id).toBe(threadId);
	});

	test("returns 404 for non-existent thread", async () => {
		const response = await apiFetch("/api/v1/threads/99999");
		expect(response.status).toBe(404);
	});
});

describe("L2: POST /api/v1/threads", () => {
	test("creates thread with valid body", async () => {
		const response = await apiPost("/api/v1/threads", {
			forumId: 2,
			subject: "Integration Test Thread",
			content: "Test content from L2",
		});
		expect(response.status).toBe(201);
		const json = await response.json();
		expect(json.data.subject).toBe("Integration Test Thread");
	});

	test("returns 400 for missing fields", async () => {
		const response = await apiPost("/api/v1/threads", {
			forumId: 2,
		});
		expect(response.status).toBe(400);
	});
});
