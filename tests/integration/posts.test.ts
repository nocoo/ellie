// tests/integration/posts.test.ts — L2: Post API integration tests
// Ref: 04-application §4.8.4

import { describe, expect, test } from "bun:test";
import { apiDelete, apiFetch, apiPost } from "./setup";

describe("L2: GET /api/v1/posts", () => {
	test("returns paginated post list with threadId", async () => {
		// Get a valid thread ID first
		const listResponse = await apiFetch("/api/v1/threads?limit=1");
		const { data: threads } = await listResponse.json();
		if (threads.items.length === 0) return;

		const threadId = threads.items[0].id;
		const response = await apiFetch(`/api/v1/posts?threadId=${threadId}`);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
		expect(typeof json.data.total).toBe("number");
	});

	test("supports limit parameter", async () => {
		const listResponse = await apiFetch("/api/v1/threads?limit=1");
		const { data: threads } = await listResponse.json();
		if (threads.items.length === 0) return;

		const threadId = threads.items[0].id;
		const response = await apiFetch(`/api/v1/posts?threadId=${threadId}&limit=1`);
		const json = await response.json();
		expect(json.data.items.length).toBeLessThanOrEqual(1);
	});
});

describe("L2: POST /api/v1/posts", () => {
	test("creates post with valid body", async () => {
		const listResponse = await apiFetch("/api/v1/threads?limit=1");
		const { data: threads } = await listResponse.json();
		if (threads.items.length === 0) return;

		const threadId = threads.items[0].id;
		const response = await apiPost("/api/v1/posts", {
			threadId,
			content: "Integration test reply",
		});
		expect(response.status).toBe(201);
		const json = await response.json();
		expect(json.data.content).toBe("Integration test reply");
	});

	test("returns 400 for missing fields", async () => {
		const response = await apiPost("/api/v1/posts", {
			content: "Missing threadId",
		});
		expect(response.status).toBe(400);
	});
});

describe("L2: DELETE /api/v1/posts/:id", () => {
	test("returns 400 for invalid ID", async () => {
		const response = await apiDelete("/api/v1/posts/abc");
		expect(response.status).toBe(400);
	});
});
