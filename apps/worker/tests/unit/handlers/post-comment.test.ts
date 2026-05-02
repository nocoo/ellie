import { describe, expect, it } from "vitest";
import * as postComment from "../../../src/handlers/post-comment";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";

describe("post-comment handlers", () => {
	// ─── list ───────────────────────────────────────────────────────

	describe("list", () => {
		it("should require postId param", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/post-comments");
			const response = await postComment.list(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject non-numeric postId", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/post-comments?postId=abc");
			const response = await postComment.list(request, env);
			expect(response.status).toBe(400);
		});

		it("should return 404 if post not found", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id FROM posts WHERE id": null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments?postId=99");
			const response = await postComment.list(request, env);
			expect(response.status).toBe(404);
		});

		it("should return 404 if thread is hidden (sticky < 0)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id FROM posts WHERE id": { thread_id: 1 },
					"SELECT forum_id, sticky FROM threads": { forum_id: 1, sticky: -1 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments?postId=1");
			const response = await postComment.list(request, env);
			expect(response.status).toBe(404);
		});

		it("should return 404 if forum is inactive", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id FROM posts WHERE id": { thread_id: 1 },
					"SELECT forum_id, sticky FROM threads": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums": { status: 0, visibility: "public" },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments?postId=1");
			const response = await postComment.list(request, env);
			expect(response.status).toBe(404);
		});

		it("should return 403 if forum visibility restricts access", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id FROM posts WHERE id": { thread_id: 1 },
					"SELECT forum_id, sticky FROM threads": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums": { status: 1, visibility: "members" },
				},
			});
			const env = makeEnv({ DB: db });
			// No auth header → anonymous user cannot view members-only forum
			const request = new Request("https://api.example.com/api/v1/post-comments?postId=1");
			const response = await postComment.list(request, env);
			expect(response.status).toBe(403);
		});

		it("should list comments for a public forum post", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id FROM posts WHERE id": { thread_id: 1 },
					"SELECT forum_id, sticky FROM threads": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
				},
				allResults: {
					"SELECT * FROM post_comments WHERE post_id": [
						{
							id: 1,
							thread_id: 1,
							post_id: 5,
							author_id: 10,
							author_name: "alice",
							content: "Nice post!",
							score: 0,
							reply_post_id: 0,
							created_at: 1711540800,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments?postId=5");
			const response = await postComment.list(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { id: number; content: string }[] };
			expect(body.data).toHaveLength(1);
			expect(body.data[0].content).toBe("Nice post!");
		});

		it("should support custom limit", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id FROM posts WHERE id": { thread_id: 1 },
					"SELECT forum_id, sticky FROM threads": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
				},
				allResults: {
					"SELECT * FROM post_comments WHERE post_id": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments?postId=5&limit=10");
			const response = await postComment.list(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ─── create ─────────────────────────────────────────────────────

	describe("create", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(401);
		});

		it("should reject banned users", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: -1,
						avatar_path: "",
						has_avatar: 0,
						reg_date: 1700000000,
						role: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 1, content: "test" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(403);
		});

		it("should reject invalid JSON body", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: "not json",
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject missing postId", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content: "test" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject empty content", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 1, content: "" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject content exceeding max length", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 1, content: "a".repeat(256) }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject if post not found", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 0,
					},
					"SELECT id, thread_id, forum_id FROM posts": null,
				},
				allResults: {
					"SELECT id, find, replacement, action FROM censor_words": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 99, content: "test" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(404);
		});

		it("should reject if thread is closed", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 0,
					},
					"SELECT id, thread_id, forum_id FROM posts": { id: 1, thread_id: 1, forum_id: 1 },
					"SELECT closed, sticky, forum_id FROM threads": { closed: 1, sticky: 0, forum_id: 1 },
				},
				allResults: {
					"SELECT id, find, replacement, action FROM censor_words": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 1, content: "test" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(403);
		});

		it("should create comment successfully", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 0,
					},
					"SELECT id, thread_id, forum_id FROM posts": { id: 1, thread_id: 1, forum_id: 1 },
					"SELECT closed, sticky, forum_id FROM threads": { closed: 0, sticky: 0, forum_id: 1 },
					"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
					"SELECT username FROM users": { username: "alice" },
					"SELECT * FROM post_comments WHERE id": {
						id: 42,
						thread_id: 1,
						post_id: 1,
						author_id: 10,
						author_name: "alice",
						content: "Great comment!",
						score: 0,
						reply_post_id: 0,
						created_at: 1711540800,
					},
				},
				allResults: {
					"SELECT id, find, replacement, action FROM censor_words": [],
				},
				runResults: {
					"INSERT INTO post_comments": { success: true, meta: { last_row_id: 42, changes: 1 } },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 1, content: "Great comment!" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(201);
			const body = (await response.json()) as { data: { id: number; content: string } };
			expect(body.data.id).toBe(42);
			expect(body.data.content).toBe("Great comment!");
		});

		// ─── R3-B: post-comment:create routes through checkPostingPermission ───

		it("R3-B: blocks normal user when allow_reply=false (content switch)", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE 'features.posting.%'": [
						{ key: "features.content.allow_reply", value: "false" },
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 1, content: "test" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("CONTENT_DISABLED");
		});

		it("R3-B: staff (role >= 1) bypasses allow_reply=false content switch", async () => {
			const token = await createJwtForRole(1, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 1, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						reg_date: 1700000000,
						role: 1,
					},
					"SELECT id, thread_id, forum_id FROM posts": { id: 1, thread_id: 1, forum_id: 1 },
					"SELECT closed, sticky, forum_id FROM threads": { closed: 0, sticky: 0, forum_id: 1 },
					"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
					"SELECT username FROM users": { username: "mod" },
					"SELECT * FROM post_comments WHERE id": {
						id: 50,
						thread_id: 1,
						post_id: 1,
						author_id: 10,
						author_name: "mod",
						content: "staff bypass",
						score: 0,
						reply_post_id: 0,
						created_at: 1711540800,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE 'features.posting.%'": [
						{ key: "features.content.allow_reply", value: "false" },
					],
					"SELECT id, find, replacement, action FROM censor_words": [],
				},
				runResults: {
					"INSERT INTO post_comments": { success: true, meta: { last_row_id: 50, changes: 1 } },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 1, content: "staff bypass" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(201);
		});

		it("R3-B: blocks normal user under min_registration_days posting restriction", async () => {
			const token = await createJwtForRole(0, 10);
			const nowSeconds = Math.floor(Date.now() / 1000);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users WHERE id": {
						status: 0,
						avatar_path: "/avatar.png",
						has_avatar: 1,
						// Registered 1 day ago
						reg_date: nowSeconds - 86400,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE 'features.posting.%'": [
						{ key: "features.posting.enabled", value: "true" },
						{ key: "features.posting.min_registration_days", value: "7" },
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/post-comments", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ postId: 1, content: "test" }),
			});
			const response = await postComment.create(request, env);
			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("POSTING_RESTRICTION");
		});
	});
});

describe("post-comment handlers — §5.4 email-verification gate", () => {
	it("create: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await postComment.create(
			new Request("https://example.com/api/v1/post-comments", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ postId: 1, content: "x" }),
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});
});
