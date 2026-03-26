// tests/integration/users.test.ts — L2: User profile API integration tests
// Ref: 04-application §4.8.5

import { describe, expect, test } from "bun:test";
import { apiFetch } from "./setup";

describe("L2: GET /api/v1/users", () => {
	test("returns paginated user list", async () => {
		const response = await apiFetch("/api/v1/users");
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(Array.isArray(json.data.items)).toBe(true);
		expect(typeof json.data.total).toBe("number");
	});

	test("supports search parameter", async () => {
		const response = await apiFetch("/api/v1/users?search=admin");
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("supports limit parameter", async () => {
		const response = await apiFetch("/api/v1/users?limit=1");
		const json = await response.json();
		expect(json.data.items.length).toBeLessThanOrEqual(1);
	});
});

describe("L2: GET /api/v1/users/:id", () => {
	test("returns user by valid ID", async () => {
		// Get a valid user ID first
		const listResponse = await apiFetch("/api/v1/users?limit=1");
		const { data } = await listResponse.json();
		if (data.items.length === 0) return;

		const userId = data.items[0].id;
		const response = await apiFetch(`/api/v1/users/${userId}`);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data.id).toBe(userId);
	});

	test("returns 404 for non-existent user", async () => {
		const response = await apiFetch("/api/v1/users/99999");
		expect(response.status).toBe(404);
	});

	test("returns 400 for invalid ID", async () => {
		const response = await apiFetch("/api/v1/users/abc");
		expect(response.status).toBe(400);
	});
});
