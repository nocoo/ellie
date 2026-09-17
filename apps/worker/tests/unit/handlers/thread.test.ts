import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create, getById, list } from "../../../src/handlers/thread";
import type { Env } from "../../../src/lib/env";
import * as threadViews from "../../../src/lib/thread-views";
import {
	createJwtForRole,
	createMockDb,
	createMockKV,
	makeD1ForumRow,
	makeD1ThreadRow,
	TEST_JWT_SECRET,
} from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

describe("thread handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
		USE_KV_USER_CACHE: "false",
	};
	describe("reading", () => {
		let f: ReturnType<typeof readingFixture>;
		beforeEach(() => {
			f = readingFixture();
		});
		afterEach(async () => {
			await Promise.all(f.ctx._waitUntilPromises);
			f.close();
			vi.restoreAllMocks();
		});
		const readList = (query = "forumId=1", headers?: HeadersInit) =>
			list(new Request(`https://example.com/api/v1/threads?${query}`, { headers }), f.env, f.ctx);
		const readDetail = (id: string | number = 1, headers?: HeadersInit) =>
			getById(new Request(`https://example.com/api/v1/threads/${id}`, { headers }), f.env, f.ctx);

		it.each(["", "forumId=abc", "forumId=0", "forumId=-1", "forumId=9007199254740992"])(
			"rejects invalid forum query %s before D1",
			async (query) => {
				const response = await readList(query);
				expect(response.status).toBe(400);
				expect((await response.json()).error.code).toBe("INVALID_REQUEST");
				expect(f.calls).toHaveLength(0);
			},
		);

		it.each([
			["", 100],
			["200", 100],
			["100", 100],
			["0", 100],
			["-5", 100],
			["30", 30],
		])("normalizes limit %s to %i", async (value, limit) => {
			for (let id = 1; id <= 110; id++) f.thread(id);
			const response = await readList(`forumId=1&limit=${value}`);
			expect(response.status).toBe(200);
			expect((await response.json()).data).toHaveLength(limit);
		});

		it("maps entity and statistic fields, user enrichment, and first-thread status", async () => {
			f.thread(1, { views: 42, recommends: 3, created_at: 1711540800, last_post_at: 1711544400 });
			f.thread(2, { created_at: 1711544400 });
			const body = await (await readList()).json();
			const thread = body.data[0];
			expect(thread).toMatchObject({
				id: 1,
				forumId: 1,
				authorId: 10,
				authorName: "alice",
				authorAvatar: "alice.png",
				createdAt: 1711540800,
				lastPostAt: 1711544400,
				lastPoster: "bob",
				lastPosterId: 20,
				views: 42,
				recommends: 3,
				isAuthorFirstThread: true,
				isRecommended: false,
			});
			expect(body.data[1].isAuthorFirstThread).toBe(false);
			for (const field of ["forum_id", "author_id", "post_table_id", "postTableId", "password"])
				expect(thread).not.toHaveProperty(field);
			expect(f.calls.some((call) => call.sql.includes("LEFT JOIN users"))).toBe(false);
		});

		it("keeps global announcements above category/forum pins and keyset pages roundtrip", async () => {
			f.thread(1, { forum_id: 2, sticky: 2, last_post_at: 1 });
			f.thread(2, { sticky: 3, last_post_at: 9 });
			f.thread(3, { sticky: 1, last_post_at: 10 });
			const first = await (await readList("forumId=1&limit=1")).json();
			expect(first.data.map((row: { id: number }) => row.id)).toEqual([1]);
			expect(JSON.parse(atob(first.meta.nextCursor))).toEqual({ sticky: 4, lastPostAt: 1, id: 1 });
			const second = await (
				await readList(`forumId=1&limit=1&cursor=${encodeURIComponent(first.meta.nextCursor)}`)
			).json();
			expect(second.data.map((row: { id: number }) => row.id)).toEqual([2]);
			expect(JSON.parse(atob(second.meta.nextCursor)).sticky).toBe(3);
		});

		it.each([
			"not-valid-base64!!!",
			btoa(JSON.stringify({ wrong: "structure" })),
			btoa(JSON.stringify({ sticky: 0, lastPostAt: -1, id: 1 })),
		])("invalid cursor falls back to the first page: %s", async (cursor) => {
			f.thread(1);
			const body = await (await readList(`forumId=1&cursor=${encodeURIComponent(cursor)}`)).json();
			expect(body.data[0].id).toBe(1);
			expect(body.meta.nextCursor).toBeNull();
		});

		it("preserves offset totals/pages and response metadata", async () => {
			for (let id = 1; id <= 50; id++) f.thread(id);
			const body = await (await readList("forumId=1&page=2&limit=10")).json();
			expect(body.meta).toMatchObject({ total: 50, page: 2, limit: 10, pages: 5 });
			expect(body.data.map((row: { id: number }) => row.id)).toEqual([
				40, 39, 38, 37, 36, 35, 34, 33, 32, 31,
			]);
			expect(body.meta.timestamp).toBeGreaterThan(0);
			expect(body.meta.requestId).toEqual(expect.any(String));
		});

		it("empty and partial pages have no next cursor", async () => {
			expect((await (await readList()).json()).meta.nextCursor).toBeNull();
			f.thread(1);
			expect((await (await readList("forumId=1&limit=20")).json()).meta.nextCursor).toBeNull();
		});

		it("preserves CORS headers on success and validation errors", async () => {
			const headers = { Origin: "http://localhost:3000" };
			expect(
				(await readList("forumId=1", headers)).headers.get("Access-Control-Allow-Origin"),
			).toBe(headers.Origin);
			expect((await readList("", headers)).headers.get("Access-Control-Allow-Origin")).toBe(
				headers.Origin,
			);
		});

		it("parses detail ID and preserves mapped fields", async () => {
			f.thread(456, { views: 42, special: 1 });
			const response = await readDetail(456);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data).toMatchObject({
				id: 456,
				forumId: 1,
				authorId: 10,
				authorName: "alice",
				views: 42,
				special: 1,
			});
			for (const field of ["forum_id", "post_table_id", "ip"])
				expect(body.data).not.toHaveProperty(field);
		});

		it.each(["abc", "0", "-1", "9007199254740992", "999"])(
			"missing/invalid thread %s returns 404 without views",
			async (id) => {
				expect((await readDetail(id)).status).toBe(404);
				expect(f.calls.filter((call) => call.mode === "run")).toHaveLength(0);
			},
		);

		it.each([
			[0, "public", 404],
			[2, "public", 404],
			[1, "members", 403],
			[1, "staff", 403],
			[1, "admin", 403],
		])(
			"checks current forum status %i / visibility %s before detail",
			async (status, visibility, expected) => {
				f.thread(1);
				f.sqlite
					.prepare("UPDATE forums SET status=?, visibility=? WHERE id=1")
					.run(status, visibility);
				const response = await readDetail();
				expect(response.status).toBe(expected);
				expect((await response.json()).error.code).toBe(
					expected === 404 ? "THREAD_NOT_FOUND" : "FORBIDDEN",
				);
				expect(f.calls.filter((call) => call.mode === "run")).toHaveLength(0);
			},
		);

		it("one authorized normal fetch records exactly one logical view", async () => {
			const recordView = vi
				.spyOn(threadViews, "scheduleThreadViewIncrement")
				.mockImplementation(() => undefined);
			f.thread(1);
			expect((await readDetail()).status).toBe(200);
			expect(recordView).toHaveBeenCalledExactlyOnceWith(f.env, f.ctx, 1);
		});

		it.each([
			{ "X-Ellie-Read-Purpose": "metadata" },
			{ "X-Ellie-Read-Purpose": "prefetch" },
			{ "Sec-Purpose": "prefetch;prerender" },
			{ Purpose: "prefetch" },
		])("metadata and prefetch do not record views: %j", async (headers) => {
			const recordView = vi
				.spyOn(threadViews, "scheduleThreadViewIncrement")
				.mockImplementation(() => undefined);
			f.thread(1);
			expect((await readDetail(1, headers)).status).toBe(200);
			expect(recordView).not.toHaveBeenCalled();
		});
	});
	describe("create", () => {
		it("should require authentication", async () => {
			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
				}),
				mockEnv,
			);

			expect(response.status).toBe(401);
		});

		it("should validate required fields", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1 }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should require valid forumId", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: "invalid" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should reject non-existent forum", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": null,
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
				runResults: { "": { success: true, meta: { last_row_id: 100 } } },
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1, subject: "Test", content: "Test content" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error.code).toBe("FORUM_NOT_FOUND");
		});

		it("should validate subject length", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						forumId: 1,
						subject: "a".repeat(201),
						content: "Test content",
					}),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("subject must be at most 200 characters");
		});

		it("should create thread with first post and update counts", async () => {
			const token = await createJwtForRole(0, 42);
			const createdThread = makeD1ThreadRow({ id: 100, forum_id: 1 });
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT * FROM threads WHERE id": createdThread,
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
					"SELECT username FROM users": { username: "testuser" },
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
				runResults: {
					"": { success: true, meta: { last_row_id: 100 } },
					"INSERT INTO threads": { success: true, meta: { last_row_id: 100 } },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						forumId: 1,
						subject: "Test Thread",
						content: "<p>Test content</p>",
					}),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.id).toBe(100);
			expect(body.data.subject).toBe("Test Thread");

			// Verify batch was called: 1 post INSERT + 2 count updates = 3 statements
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(3);
		});

		it("should trim subject and content", async () => {
			const token = await createJwtForRole(0, 42);
			const createdThread = makeD1ThreadRow({ id: 100 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT * FROM threads WHERE id": createdThread,
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
					"SELECT username FROM users": { username: "testuser" },
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
				runResults: {
					"": { success: true, meta: { last_row_id: 100 } },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						forumId: 1,
						subject: "  Test Thread  ",
						content: "  <p>Test content</p>  ",
					}),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.subject).toBe("Test Thread");
		});

		it("should reject empty subject after trimming", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1, subject: "   ", content: "Test" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("subject is required");
		});

		it("should reject empty content after trimming", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1, subject: "Test", content: "   " }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("content is required");
		});

		it("should handle malformed JSON", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: "invalid json",
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		// docs/17 §5.4 — Phase 5b email-verification gate regression.
		it("rejects unverified user with 403 EMAIL_NOT_VERIFIED payload (gate fires before business SQL)", async () => {
			const { env, calls } = makeUnverifiedEnv(1);
			const token = await unverifiedUserJwt(1);
			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1, subject: "x", content: "y" }),
				}),
				env,
			);
			await expectEmailNotVerifiedResponse(response);
			// Auth middleware runs exactly one DB query (SELECT role, status,
			// email_verified_at FROM users) and the handler short-circuits before
			// hitting any forum / settings / thread SQL.
			expect(calls.length).toBe(1);
			expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
		});
	});
});
