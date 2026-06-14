// tests/integration/http/messaging.test.ts — L2 Worker Messaging API Tests
// Tests private messaging: list, create, get, delete, unread-count, mark-all-read

import { describe, expect, test } from "bun:test";
import { createTestJwt, workerDelete, workerFetch, workerPost } from "../setup";

describe("L2: Worker Messaging API", () => {
	// ─── List Messages ─────────────────────────────────────────────

	describe("GET /api/v1/messages", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerFetch("/api/v1/messages");
			expect(res.status).toBe(401);
		});

		test("returns message list with valid JWT", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerFetch("/api/v1/messages", {
				headers: { Authorization: `Bearer ${jwt}` },
			});
			// 200 or 404 if user doesn't exist
			expect([200, 404]).toContain(res.status);
			if (res.status === 200) {
				const data = await res.json();
				expect(data).toHaveProperty("data");
				expect(Array.isArray(data.data)).toBe(true);
			}
		});

		test("supports pagination", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerFetch("/api/v1/messages?limit=10&offset=0", {
				headers: { Authorization: `Bearer ${jwt}` },
			});
			expect([200, 404]).toContain(res.status);
		});
	});

	// ─── Unread Count ──────────────────────────────────────────────

	describe("GET /api/v1/messages/unread-count", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerFetch("/api/v1/messages/unread-count");
			expect(res.status).toBe(401);
		});

		test("returns unread count with valid JWT", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerFetch("/api/v1/messages/unread-count", {
				headers: { Authorization: `Bearer ${jwt}` },
			});
			expect([200, 404]).toContain(res.status);
			if (res.status === 200) {
				const data = await res.json();
				expect(data).toHaveProperty("data");
				expect(data.data).toHaveProperty("count");
				expect(typeof data.data.count).toBe("number");
			}
		});
	});

	// ─── Mark All Read ─────────────────────────────────────────────

	describe("POST /api/v1/messages/mark-all-read", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPost("/api/v1/messages/mark-all-read", {});
			expect(res.status).toBe(401);
		});

		test("marks all messages as read with valid JWT", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPost("/api/v1/messages/mark-all-read", {}, jwt);
			expect([200, 404]).toContain(res.status);
		});
	});

	// ─── Get Single Message ────────────────────────────────────────

	describe("GET /api/v1/messages/:id", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerFetch("/api/v1/messages/1");
			expect(res.status).toBe(401);
		});

		test("returns 404 for non-existent message", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerFetch("/api/v1/messages/999999", {
				headers: { Authorization: `Bearer ${jwt}` },
			});
			expect([403, 404]).toContain(res.status);
		});
	});

	// ─── Create Message ────────────────────────────────────────────

	describe("POST /api/v1/messages", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPost("/api/v1/messages", {
				recipientId: 2,
				subject: "Test",
				content: "Hello",
			});
			expect(res.status).toBe(401);
		});

		test("returns 400 for missing required fields", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPost("/api/v1/messages", {}, jwt);
			expect(res.status).toBe(400);
		});

		test("returns 404 for non-existent recipient", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPost(
				"/api/v1/messages",
				{
					recipientId: 999999,
					subject: "Test",
					content: "Hello",
				},
				jwt,
			);
			expect([400, 404]).toContain(res.status);
		});
	});

	// ─── Delete Message ────────────────────────────────────────────

	describe("DELETE /api/v1/messages/:id", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerDelete("/api/v1/messages/1");
			expect(res.status).toBe(401);
		});

		test("returns 404 for non-existent message", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerDelete("/api/v1/messages/999999", jwt);
			expect([403, 404]).toContain(res.status);
		});
	});
});
