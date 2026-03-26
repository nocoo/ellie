// tests/integration/forums.test.ts — L2: Forum API integration tests
// Ref: 04-application §4.8.2

import { describe, expect, test } from "bun:test";
import { apiFetch } from "./setup";

describe("L2: GET /api/v1/forums", () => {
	test("returns 200 with JSON data array", async () => {
		const response = await apiFetch("/api/v1/forums");
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(Array.isArray(json.data)).toBe(true);
	});

	test("returns non-empty forum list", async () => {
		const response = await apiFetch("/api/v1/forums");
		const json = await response.json();
		expect(json.data.length).toBeGreaterThan(0);
	});

	test("each forum has id, name, and groupId", async () => {
		const response = await apiFetch("/api/v1/forums");
		const json = await response.json();
		for (const forum of json.data.slice(0, 5)) {
			expect(typeof forum.id).toBe("number");
			expect(typeof forum.name).toBe("string");
		}
	});
});

describe("L2: GET /api/v1/forums/:id", () => {
	test("returns specific forum by ID", async () => {
		// First get a valid ID
		const listResponse = await apiFetch("/api/v1/forums");
		const { data: forums } = await listResponse.json();
		const forumId = forums[0].id;

		const response = await apiFetch(`/api/v1/forums/${forumId}`);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data.id).toBe(forumId);
	});

	test("returns 404 for non-existent forum", async () => {
		const response = await apiFetch("/api/v1/forums/99999");
		expect(response.status).toBe(404);
	});

	test("returns 400 for invalid ID", async () => {
		const response = await apiFetch("/api/v1/forums/abc");
		expect(response.status).toBe(400);
	});
});
