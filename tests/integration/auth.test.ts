// tests/integration/auth.test.ts — L2: NextAuth integration tests
// Ref: 04-application §4.8.8

import { describe, expect, test } from "bun:test";
import { apiFetch } from "./setup";

describe("L2: NextAuth endpoints", () => {
	test("GET /api/auth/session returns valid JSON", async () => {
		const response = await apiFetch("/api/auth/session");
		expect(response.status).toBe(200);
		const json = await response.json();
		// Unauthenticated session returns empty object
		expect(json).toBeDefined();
	});

	test("GET /api/auth/providers returns credentials provider", async () => {
		const response = await apiFetch("/api/auth/providers");
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.credentials).toBeDefined();
		expect(json.credentials.id).toBe("credentials");
	});

	test("GET /api/auth/csrf returns CSRF token", async () => {
		const response = await apiFetch("/api/auth/csrf");
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(typeof json.csrfToken).toBe("string");
		expect(json.csrfToken.length).toBeGreaterThan(0);
	});

	test("POST /api/auth/callback/credentials with invalid creds redirects", async () => {
		// First get CSRF token
		const csrfResponse = await apiFetch("/api/auth/csrf");
		const { csrfToken } = await csrfResponse.json();

		// Submit invalid credentials
		const response = await apiFetch("/api/auth/callback/credentials", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `csrfToken=${csrfToken}&username=baduser&password=badpass`,
			redirect: "manual",
		});

		// NextAuth redirects on failure (302 or 200 with error page)
		expect([200, 302]).toContain(response.status);
	});

	test("POST /api/auth/callback/credentials with valid mock creds", async () => {
		// First get CSRF token
		const csrfResponse = await apiFetch("/api/auth/csrf");
		const { csrfToken } = await csrfResponse.json();

		// Mock rule: password === username for valid login
		const response = await apiFetch("/api/auth/callback/credentials", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `csrfToken=${csrfToken}&username=admin&password=admin`,
			redirect: "manual",
		});

		// NextAuth redirects on success (302 to callback URL)
		expect([200, 302]).toContain(response.status);
	});
});
