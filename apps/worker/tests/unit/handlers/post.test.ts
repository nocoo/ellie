import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create, getById, list } from "../../../src/handlers/post";
import type { Env } from "../../../src/lib/env";
import * as statistics from "../../../src/lib/stats-counter";
import {
	createJwtForRole,
	createMockDb,
	createMockKV,
	makeD1PostRow,
	makeD1ThreadRow,
	TEST_JWT_SECRET,
} from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

describe("post handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
	};
	describe("reading", () => {
		let f: ReturnType<typeof readingFixture>;
		beforeEach(() => {
			f = readingFixture();
			f.thread(1);
		});
		afterEach(async () => {
			await Promise.all(f.ctx._waitUntilPromises);
			f.close();
		});
		const readList = (query = "threadId=1", headers?: HeadersInit) =>
			list(new Request(`https://example.com/api/v1/posts?${query}`, { headers }), f.env);
		const readDetail = (id: string | number = 1) =>
			getById(new Request(`https://example.com/api/v1/posts/${id}`), f.env);

		it.each(["", "threadId=abc", "threadId=0", "threadId=-1", "threadId=9007199254740992"])(
			"rejects invalid thread query %s without D1",
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
			["-2", 100],
			["10", 10],
		])("normalizes limit %s to %i", async (value, limit) => {
			for (let id = 1; id <= 110; id++) f.post(id);
			const response = await readList(`threadId=1&limit=${value}`);
			expect(response.status).toBe(200);
			expect((await response.json()).data).toHaveLength(limit);
			expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
		});

		it("maps snake_case fields, isFirst booleans, current usernames and ratings", async () => {
			f.post(1, { created_at: 1711540800 });
			f.post(2, { is_first: 0 });
			const body = await (await readList()).json();
			expect(body.data[0]).toMatchObject({
				id: 1,
				threadId: 1,
				forumId: 1,
				authorId: 10,
				authorName: "alice",
				isFirst: true,
				content: "Body 1",
				createdAt: 1711540800,
			});
			expect(body.data[1].isFirst).toBe(false);
			for (const field of ["thread_id", "author_id", "is_first", "ip"])
				expect(body.data[0]).not.toHaveProperty(field);
		});

		async function checkCachedPage(limit: number, position: number | null, last: boolean) {
			const cursor =
				position === null
					? ""
					: `&cursor=${encodeURIComponent(btoa(JSON.stringify({ position })))}`;
			const query = `threadId=1&limit=${limit}${cursor}${last ? "&last=1" : ""}`;
			const body = await (await readList(query)).json();
			const start = last ? Math.max(1, 261 - limit) : (position ?? 0) + 1;
			const ids = Array.from(
				{ length: Math.min(limit, Math.max(0, 261 - start)) },
				(_, i) => start + i,
			);
			expect(body.data.map((post: { id: number }) => post.id)).toEqual(ids);
			if (last || ids.length < limit) expect(body.meta.nextCursor).toBeNull();
			else expect(JSON.parse(atob(body.meta.nextCursor))).toEqual({ position: ids.at(-1) });
			f.calls.length = 0;
			expect((await (await readList(query)).json()).data).toEqual(body.data);
			// Hot path: thread/forum gate, plus <=2 post membership gates.
			expect(f.calls.length).toBe(ids.length === 0 ? 1 : ids.length > 99 ? 3 : 2);
			expect(f.calls.some((call) => call.sql.includes("content"))).toBe(false);
		}

		it.each([1, 2, 17, 20, 25, 50, 99, 100])(
			"caches limit=%i for first, deep cursor and last pages",
			async (limit) => {
				for (let id = 1; id <= 260; id++) f.post(id);
				for (const position of [null, 0, 1, 100, 199, 260]) {
					for (const last of [false, true]) await checkCachedPage(limit, position, last);
				}
			},
		);

		it.each([
			"not-valid-base64!!!",
			btoa(JSON.stringify({ wrong: "structure" })),
			btoa(JSON.stringify({ position: -1 })),
		])("invalid cursor falls back without changing response semantics: %s", async (cursor) => {
			f.post(1);
			const body = await (await readList(`threadId=1&cursor=${encodeURIComponent(cursor)}`)).json();
			expect(body.data.map((post: { id: number }) => post.id)).toEqual([1]);
			expect(body.meta.nextCursor).toBeNull();
		});

		it("empty pages preserve the response envelope and CORS", async () => {
			const response = await readList("threadId=1", { Origin: "http://localhost:3000" });
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
			const body = await response.json();
			expect(body.data).toEqual([]);
			expect(body.meta.nextCursor).toBeNull();
			expect(body.meta.timestamp).toBeGreaterThan(0);
			expect(body.meta.requestId).toEqual(expect.any(String));
		});

		it("single detail shares the warmed body and aggregate with a list", async () => {
			f.post(456, { is_first: 0 });
			await readList();
			f.calls.length = 0;
			const response = await readDetail(456);
			expect(response.status).toBe(200);
			expect((await response.json()).data).toMatchObject({
				id: 456,
				threadId: 1,
				forumId: 1,
				isFirst: false,
				content: "Body 456",
			});
			expect(f.calls).toHaveLength(2);
			expect(f.calls.every((call) => !call.sql.includes("content"))).toBe(true);
		});

		it.each(["999", "abc", "0", "-1"])("missing/invalid post %s is 404", async (id) => {
			const response = await readDetail(id);
			expect(response.status).toBe(404);
			expect((await response.json()).error.code).toBe("POST_NOT_FOUND");
		});

		it("current deletion gates hide a warm post and refill the page", async () => {
			for (let id = 1; id <= 3; id++) f.post(id);
			await readList("threadId=1&limit=2");
			f.sqlite.exec("UPDATE posts SET invisible=1 WHERE id=1");
			expect((await readDetail(1)).status).toBe(404);
			const body = await (await readList("threadId=1&limit=2")).json();
			expect(body.data.map((post: { id: number }) => post.id)).toEqual([2, 3]);
			expect(JSON.parse(atob(body.meta.nextCursor))).toEqual({ position: 3 });
		});
	});
	describe("create", () => {
		it("should require authentication", async () => {
			const response = await create(
				new Request("https://example.com/api/v1/posts", {
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
					"JOIN forums f": makeD1ThreadRow({
						id: 1,
						closed: 0,
						status: 1,
						visibility: "public",
					}),
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
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1 }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should require valid threadId", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: "invalid", content: "Test" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should reject non-existent thread", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"JOIN forums f": null,
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
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 999, content: "Test reply" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should reject reply to closed thread", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"JOIN forums f": { id: 1, forum_id: 10, closed: 1, status: 1, visibility: "public" },
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
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1, content: "Test reply" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(403);
			const body = await response.json();
			expect(body.error.code).toBe("THREAD_CLOSED");
		});

		it.each([0, 1, 2])(
			"creates a reply and reports authoritative thread sticky %i",
			async (sticky) => {
				const increment = vi.spyOn(statistics, "incrementStatsOnPostCreate");
				const token = await createJwtForRole(0, 42);
				const createdPost = makeD1PostRow({
					id: 50,
					thread_id: 1,
					forum_id: 10,
					position: 6,
					is_first: 0,
				});
				const { db, batchCalls } = createMockDb({
					firstResults: {
						"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
						"JOIN forums f": {
							id: 1,
							forum_id: 10,
							closed: 0,
							status: 1,
							visibility: "public",
							sticky,
						},
						"SELECT MAX(position)": { maxPos: 5 },
						"SELECT * FROM posts WHERE id": createdPost,
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
					runResults: {
						"INSERT INTO posts": { success: true, meta: { last_row_id: 50 } },
					},
				});

				const response = await create(
					new Request("https://example.com/api/v1/posts", {
						method: "POST",
						headers: { Authorization: `Bearer ${token}` },
						body: JSON.stringify({ threadId: 1, content: "<p>My reply</p>" }),
					}),
					{ ...mockEnv, DB: db },
				);

				expect(response.status).toBe(201);
				const body = await response.json();
				expect(body.data.id).toBe(50);
				expect(body.meta.threadSticky).toBe(sticky);
				expect(increment).toHaveBeenCalledWith(expect.objectContaining({ DB: db }), 10);
				increment.mockRestore();

				// Verify batch was called: UPDATE threads + UPDATE forums + UPDATE users = 3
				expect(batchCalls.length).toBe(1);
				expect(batchCalls[0].length).toBe(3);
			},
		);

		it("should trim content", async () => {
			const token = await createJwtForRole(0, 42);
			const createdPost = makeD1PostRow({ id: 50, content: "Trimmed" });
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"JOIN forums f": { id: 1, forum_id: 10, closed: 0, status: 1, visibility: "public" },
					"SELECT MAX(position)": { maxPos: 1 },
					"SELECT * FROM posts WHERE id": createdPost,
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
				runResults: {
					"INSERT INTO posts": { success: true, meta: { last_row_id: 50 } },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1, content: "  Trimmed  " }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(201);
		});

		it("should reject empty content after trimming", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"JOIN forums f": { id: 1, forum_id: 10, closed: 0, status: 1, visibility: "public" },
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
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1, content: "   " }),
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
				new Request("https://example.com/api/v1/posts", {
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
	});
});

// docs/17 §5.4 — Phase 5b email-verification gate regression for post.create.
describe("post handlers — §5.4 email-verification gate", () => {
	it("create: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await create(
			new Request("https://example.com/api/v1/posts", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: JSON.stringify({ threadId: 1, content: "x" }),
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});
});
