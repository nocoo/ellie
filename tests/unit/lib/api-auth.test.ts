import { describe, expect, test } from "bun:test";
import { getAuthUserId, getAuthUserRole } from "@/lib/api-auth";

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

describe("getAuthUserRole", () => {
	test("returns null without role header", async () => {
		const request = new Request("http://localhost/api/admin/users", {
			method: "POST",
		});
		const role = await getAuthUserRole(request);
		expect(role).toBeNull();
	});

	test("returns role from X-Mock-Role header", async () => {
		const request = new Request("http://localhost/api/admin/users", {
			method: "POST",
			headers: { "X-Mock-Role": "1" },
		});
		const role = await getAuthUserRole(request);
		expect(role).toBe(1);
	});

	test("returns null for empty X-Mock-Role header", async () => {
		const request = new Request("http://localhost/api/admin/users", {
			method: "POST",
			headers: { "X-Mock-Role": "" },
		});
		const role = await getAuthUserRole(request);
		expect(role).toBeNull();
	});

	test("returns role 0 from header", async () => {
		const request = new Request("http://localhost/api/admin/users", {
			method: "POST",
			headers: { "X-Mock-Role": "0" },
		});
		const role = await getAuthUserRole(request);
		expect(role).toBe(0);
	});

	test("returns null for non-numeric role header", async () => {
		const request = new Request("http://localhost/api/admin/users", {
			method: "POST",
			headers: { "X-Mock-Role": "abc" },
		});
		const role = await getAuthUserRole(request);
		expect(role).toBeNull();
	});
});
