import { describe, expect, it } from "vitest";
import * as message from "../../../src/handlers/message";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";

describe("message handlers", () => {
	// ─── list ───────────────────────────────────────────────────────

	describe("list", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/messages");
			const response = await message.list(request, env);
			expect(response.status).toBe(401);
		});

		it("should return inbox messages (default)", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT COUNT(*)": { count: 3 },
				},
				allResults: {
					"SELECT * FROM messages": [
						{
							id: 1,
							sender_id: 20,
							sender_name: "bob",
							receiver_id: 10,
							receiver_name: "alice",
							subject: "Hello",
							content: "Test message content",
							is_read: 0,
							sender_deleted: 0,
							receiver_deleted: 0,
							created_at: 1711540800,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.list(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: unknown[];
				meta: { unreadCount: number };
			};
			expect(body.data).toHaveLength(1);
			expect(body.meta.unreadCount).toBe(3);
		});

		it("should return outbox messages", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
				allResults: {
					"SELECT * FROM messages": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages?box=outbox", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should support cursor-based pagination", async () => {
			const token = await createJwtForRole(0, 10);
			// Encode a cursor manually
			const cursor = btoa(JSON.stringify({ createdAt: 1711540800, id: 5 }));
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT COUNT(*)": { count: 0 },
				},
				allResults: {
					"SELECT * FROM messages": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request(`https://api.example.com/api/v1/messages?cursor=${cursor}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should clamp limit to MAX_LIMIT", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT COUNT(*)": { count: 0 },
				},
				allResults: {
					"SELECT * FROM messages": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages?limit=500", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.list(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ─── unreadCount ────────────────────────────────────────────────

	describe("unreadCount", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/messages/unread-count");
			const response = await message.unreadCount(request, env);
			expect(response.status).toBe(401);
		});

		it("should return unread count", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT COUNT(*)": { count: 7 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/unread-count", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.unreadCount(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { count: number } };
			expect(body.data.count).toBe(7);
		});
	});

	// ─── getById ────────────────────────────────────────────────────

	describe("getById", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/messages/1");
			const response = await message.getById(request, env);
			expect(response.status).toBe(401);
		});

		it("should reject invalid message ID", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/abc", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.getById(request, env);
			expect(response.status).toBe(400);
		});

		it("should return 404 if message not found", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT * FROM messages WHERE id": null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/99", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.getById(request, env);
			expect(response.status).toBe(404);
		});

		it("should return 404 if user is not sender or receiver", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT * FROM messages WHERE id": {
						id: 1,
						sender_id: 20,
						receiver_id: 30,
						sender_name: "bob",
						receiver_name: "carol",
						subject: "test",
						content: "hello",
						is_read: 0,
						sender_deleted: 0,
						receiver_deleted: 0,
						created_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/1", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.getById(request, env);
			expect(response.status).toBe(404);
		});

		it("should return 404 if message is deleted for receiver", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT * FROM messages WHERE id": {
						id: 1,
						sender_id: 20,
						receiver_id: 10,
						sender_name: "bob",
						receiver_name: "alice",
						subject: "test",
						content: "hello",
						is_read: 0,
						sender_deleted: 0,
						receiver_deleted: 1,
						created_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/1", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.getById(request, env);
			expect(response.status).toBe(404);
		});

		it("should return message detail for receiver and mark as read", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT * FROM messages WHERE id": {
						id: 1,
						sender_id: 20,
						receiver_id: 10,
						sender_name: "bob",
						receiver_name: "alice",
						subject: "test",
						content: "hello world",
						is_read: 0,
						sender_deleted: 0,
						receiver_deleted: 0,
						created_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/1", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.getById(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { content: string; isRead: boolean } };
			expect(body.data.content).toBe("hello world");
			expect(body.data.isRead).toBe(true);
		});

		it("should return message detail for sender without marking read", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT * FROM messages WHERE id": {
						id: 1,
						sender_id: 10,
						receiver_id: 20,
						sender_name: "alice",
						receiver_name: "bob",
						subject: "test",
						content: "hello",
						is_read: 0,
						sender_deleted: 0,
						receiver_deleted: 0,
						created_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/1", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.getById(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ─── create ─────────────────────────────────────────────────────

	describe("create", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/messages", {
				method: "POST",
			});
			const response = await message.create(request, env);
			expect(response.status).toBe(401);
		});

		it("should reject invalid JSON body", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "",
						has_avatar: 0,
						reg_date: 1000000,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: "not json",
			});
			const response = await message.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject missing receiverId", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "",
						has_avatar: 0,
						reg_date: 1000000,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content: "hello" }),
			});
			const response = await message.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject empty content", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "",
						has_avatar: 0,
						reg_date: 1000000,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ receiverId: 20, content: "" }),
			});
			const response = await message.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject sending message to self", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "",
						has_avatar: 0,
						reg_date: 1000000,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ receiverId: 10, content: "hello", subject: "test" }),
			});
			const response = await message.create(request, env);
			expect(response.status).toBe(400);
			const body = (await response.json()) as {
				error: { code: string; details?: { message: string } };
			};
			expect(body.error.code).toBe("INVALID_REQUEST");
			expect(body.error.details?.message).toContain("yourself");
		});

		it("should reject if receiver not found", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "",
						has_avatar: 0,
						reg_date: 1000000,
						role: 0,
					},
					"SELECT id, username, status FROM users": null,
				},
				allResults: {
					"SELECT key, value FROM settings": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ receiverId: 999, content: "hello", subject: "test" }),
			});
			const response = await message.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should create message successfully", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "",
						has_avatar: 0,
						reg_date: 1000000,
						role: 0,
					},
					"SELECT id, username, status FROM users": {
						id: 20,
						username: "bob",
						status: 0,
					},
					"SELECT username FROM users": { username: "alice" },
				},
				allResults: {
					"SELECT key, value FROM settings": [],
					"SELECT id, find, replacement, action FROM censor_words": [],
				},
				runResults: {
					"INSERT INTO messages": { success: true, meta: { last_row_id: 42, changes: 1 } },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ receiverId: 20, content: "Hello Bob!", subject: "Greetings" }),
			});
			const response = await message.create(request, env);
			expect(response.status).toBe(201);
			const body = (await response.json()) as { data: { id: number; receiverName: string } };
			expect(body.data.id).toBe(42);
			expect(body.data.receiverName).toBe("bob");
		});

		it("should reject subject exceeding max length", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "",
						has_avatar: 0,
						reg_date: 1000000,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					receiverId: 20,
					content: "hello",
					subject: "a".repeat(101),
				}),
			});
			const response = await message.create(request, env);
			expect(response.status).toBe(400);
		});
	});

	// ─── markAllRead ────────────────────────────────────────────────

	describe("markAllRead", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/messages/mark-all-read", {
				method: "POST",
			});
			const response = await message.markAllRead(request, env);
			expect(response.status).toBe(401);
		});

		it("should mark all messages as read", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/mark-all-read", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.markAllRead(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { success: boolean } };
			expect(body.data.success).toBe(true);
		});
	});

	// ─── remove ─────────────────────────────────────────────────────

	describe("remove", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/messages/1", {
				method: "DELETE",
			});
			const response = await message.remove(request, env);
			expect(response.status).toBe(401);
		});

		it("should reject invalid message ID", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/abc", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.remove(request, env);
			expect(response.status).toBe(400);
		});

		it("should return 404 if message not found", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT sender_id, receiver_id": null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/99", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.remove(request, env);
			expect(response.status).toBe(404);
		});

		it("should return 404 if user is not sender or receiver", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT sender_id, receiver_id": {
						sender_id: 20,
						receiver_id: 30,
						sender_deleted: 0,
						receiver_deleted: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.remove(request, env);
			expect(response.status).toBe(404);
		});

		it("should soft-delete message for sender", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT sender_id, receiver_id": {
						sender_id: 10,
						receiver_id: 20,
						sender_deleted: 0,
						receiver_deleted: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.remove(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { deleted: boolean; id: number } };
			expect(body.data.deleted).toBe(true);
		});

		it("should soft-delete message for receiver", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT sender_id, receiver_id": {
						sender_id: 20,
						receiver_id: 10,
						sender_deleted: 0,
						receiver_deleted: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/messages/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await message.remove(request, env);
			expect(response.status).toBe(200);
		});
	});
});

describe("message handlers — §5.4 email-verification gate", () => {
	it("create: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await message.create(
			new Request("https://example.com/api/v1/messages", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ recipientId: 2, content: "x" }),
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});

	it("markAllRead: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await message.markAllRead(
			new Request("https://example.com/api/v1/messages/read-all", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});

	it("remove: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await message.remove(
			new Request("https://example.com/api/v1/messages/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});

	it("list: unverified user is allowed through gate (allow-list — read)", async () => {
		// list stays on withAuthVerified per allow-list. An unverified user MUST
		// NOT receive the §5.4 EmailNotVerifiedPayload here.
		const { env } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await message.list(
			new Request("https://example.com/api/v1/messages", {
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
		);
		const text = await response.clone().text();
		expect(text).not.toContain("EMAIL_NOT_VERIFIED");
	});
});
