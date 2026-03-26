// tests/integration/admin.test.ts — L2: Admin API integration tests
// Ref: 04-application §4.8.7

import { describe, expect, test } from "bun:test";
import { apiFetch, apiPost } from "./setup";

function adminGet(path: string, role?: number): Promise<Response> {
	const headers: Record<string, string> = {};
	if (role !== undefined) headers["X-Mock-Role"] = String(role);
	return apiFetch(path, { headers });
}

function adminPost(path: string, body: Record<string, unknown>, role?: number): Promise<Response> {
	const headers: Record<string, string> = {};
	if (role !== undefined) headers["X-Mock-Role"] = String(role);
	return apiPost(path, body, headers);
}

describe("L2: Admin role guard (403)", () => {
	test("GET /api/admin/users returns 403 without role", async () => {
		const response = await adminGet("/api/admin/users");
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/users returns 403 for Mod (3)", async () => {
		const response = await adminGet("/api/admin/users", 3);
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/users returns 403 for User (0)", async () => {
		const response = await adminGet("/api/admin/users", 0);
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/content returns 403 without role", async () => {
		const response = await adminGet("/api/admin/content");
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/forums returns 403 without role", async () => {
		const response = await adminGet("/api/admin/forums");
		expect(response.status).toBe(403);
	});

	test("POST /api/admin/users returns 403 for non-admin", async () => {
		const response = await adminPost("/api/admin/users", { action: "ban", userId: 1 }, 3);
		expect(response.status).toBe(403);
	});
});

describe("L2: GET /api/admin/users", () => {
	test("returns user list for Admin (1)", async () => {
		const response = await adminGet("/api/admin/users", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("returns user list for SuperMod (2)", async () => {
		const response = await adminGet("/api/admin/users", 2);
		expect(response.status).toBe(200);
	});
});

describe("L2: POST /api/admin/users", () => {
	test("ban action works with admin role", async () => {
		// Get a valid user ID first
		const listResponse = await adminGet("/api/admin/users", 1);
		const { data } = await listResponse.json();
		if (data.items.length === 0) return;

		const userId = data.items[0].id;
		const response = await adminPost("/api/admin/users", { action: "ban", userId }, 1);
		expect(response.status).toBe(200);
	});

	test("returns 400 for missing fields", async () => {
		const response = await adminPost("/api/admin/users", { action: "ban" }, 1);
		expect(response.status).toBe(400);
	});
});

describe("L2: GET /api/admin/content", () => {
	test("returns thread list for admin", async () => {
		const response = await adminGet("/api/admin/content", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});
});

describe("L2: GET /api/admin/forums", () => {
	test("returns forum list for admin", async () => {
		const response = await adminGet("/api/admin/forums", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
	});
});

describe("L2: POST /api/admin/forums", () => {
	test("updates forum with admin role", async () => {
		const listResponse = await adminGet("/api/admin/forums", 1);
		const { data: forums } = await listResponse.json();
		if (forums.length === 0) return;

		const forumId = forums[0].id;
		const response = await adminPost("/api/admin/forums", { forumId, name: "L2 Updated" }, 1);
		expect(response.status).toBe(200);
	});

	test("returns 400 for missing forumId", async () => {
		const response = await adminPost("/api/admin/forums", { name: "Test" }, 1);
		expect(response.status).toBe(400);
	});
});
