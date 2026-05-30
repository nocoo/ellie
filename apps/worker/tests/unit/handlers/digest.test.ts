import { describe, expect, it, type vi } from "vitest";
import * as digest from "../../../src/handlers/digest";
import {
	createJwtForRole,
	createMockCtx,
	createMockDb,
	createMockKV,
	makeEnv,
} from "../../helpers";

describe("digest handlers", () => {
	// ─── list ───────────────────────────────────────────────────────

	describe("list", () => {
		it("should return empty list when no digest threads exist", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT t.* FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest");
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: unknown[];
				meta: { nextCursor: string | null };
			};
			expect(body.data).toEqual([]);
			expect(body.meta.nextCursor).toBeNull();
		});

		it("should return digest threads with next cursor when page is full", async () => {
			const threads = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				forum_id: 1,
				author_id: 10,
				author_name: "alice",
				subject: `Thread ${i + 1}`,
				created_at: 1711540800 + i,
				last_post_at: 1711544400 + i,
				last_poster: "bob",
				last_poster_id: 20,
				replies: 5,
				views: 100,
				closed: 0,
				sticky: 0,
				digest: 1,
				special: 0,
				highlight: 0,
				recommends: 0,
				type_name: "",
				post_table_id: 1,
				author_avatar: "",
				last_poster_avatar: "",
			}));
			const { db } = createMockDb({
				allResults: {
					"SELECT t.* FROM threads": threads,
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest");
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: unknown[];
				meta: { nextCursor: string | null };
			};
			expect(body.data).toHaveLength(20);
			expect(body.meta.nextCursor).not.toBeNull();
		});

		it("should support cursor-based pagination", async () => {
			const cursor = btoa(JSON.stringify({ digest: 1, lastPostAt: 1711544400, id: 5 }));
			const { db } = createMockDb({
				allResults: {
					"SELECT t.* FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request(`https://api.example.com/api/v1/digest?cursor=${cursor}`);
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by forumId", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT t.* FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest?forumId=1");
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by level", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT t.* FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest?level=2");
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by year", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT t.* FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest?year=2024");
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should respect limit parameter", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT t.* FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest?limit=5");
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should clamp limit to MAX_LIMIT", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT t.* FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest?limit=200");
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should handle authenticated user for visibility", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
				allResults: {
					"SELECT t.* FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await digest.list(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ─── stats ──────────────────────────────────────────────────────

	describe("stats", () => {
		it("should return digest statistics", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: { total: 100, level1: 60, level2: 30, level3: 10 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest/stats");
			const response = await digest.stats(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: { total: number; level1: number; level2: number; level3: number };
			};
			expect(body.data.total).toBe(100);
			expect(body.data.level1).toBe(60);
			expect(body.data.level2).toBe(30);
			expect(body.data.level3).toBe(10);
		});

		it("should return zeros when no digest threads exist", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest/stats");
			const response = await digest.stats(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { total: number } };
			expect(body.data.total).toBe(0);
		});

		it("should handle authenticated user for visibility", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					SELECT: { total: 50, level1: 30, level2: 15, level3: 5 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest/stats", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await digest.stats(request, env);
			expect(response.status).toBe(200);
		});

		it("should return cached data when KV hit", async () => {
			const cachedData = { total: 77, level1: 40, level2: 27, level3: 10 };
			const kv = createMockKV({ "digest:stats:anon": JSON.stringify(cachedData) });
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db, KV: kv });
			const ctx = createMockCtx();
			const request = new Request("https://api.example.com/api/v1/digest/stats");

			const response = await digest.stats(request, env, ctx);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: typeof cachedData };
			expect(body.data.total).toBe(77);
			expect(kv.get).toHaveBeenCalled();
			expect(kv.put).not.toHaveBeenCalled();
		});

		it("should write to KV cache after D1 read on miss", async () => {
			const kv = createMockKV({});
			const { db } = createMockDb({
				firstResults: {
					SELECT: { total: 55, level1: 30, level2: 20, level3: 5 },
				},
			});
			const env = makeEnv({ DB: db, KV: kv });
			const ctx = createMockCtx();
			const request = new Request("https://api.example.com/api/v1/digest/stats");

			const response = await digest.stats(request, env, ctx);

			expect(response.status).toBe(200);
			expect(kv.put).toHaveBeenCalledTimes(1);
			const putCall = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(putCall[0]).toBe("digest:stats:anon");
			expect((putCall[2] as { expirationTtl: number }).expirationTtl).toBe(3600);
		});
	});

	// ─── filters ────────────────────────────────────────────────────

	describe("filters", () => {
		it("should return available filter options", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT DISTINCT strftime": [{ year: "2024" }, { year: "2023" }],
					"SELECT f.id, f.name": [
						{ id: 1, name: "General", digest_count: 10 },
						{ id: 2, name: "Tech", digest_count: 5 },
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest/filters");
			const response = await digest.filters(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: { years: number[]; forums: { id: number; name: string; digestCount: number }[] };
			};
			expect(body.data.years).toEqual([2024, 2023]);
			expect(body.data.forums).toHaveLength(2);
			expect(body.data.forums[0].name).toBe("General");
			expect(body.data.forums[0].digestCount).toBe(10);
		});

		it("should return empty arrays when no digest content exists", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT DISTINCT strftime": [],
					"SELECT f.id, f.name": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest/filters");
			const response = await digest.filters(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { years: number[]; forums: unknown[] } };
			expect(body.data.years).toEqual([]);
			expect(body.data.forums).toEqual([]);
		});

		it("should handle authenticated user for visibility", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
				allResults: {
					"SELECT DISTINCT strftime": [],
					"SELECT f.id, f.name": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/digest/filters", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await digest.filters(request, env);
			expect(response.status).toBe(200);
		});

		it("should return cached data when KV hit", async () => {
			const cachedData = {
				years: [2025, 2024],
				forums: [{ id: 5, name: "Cached", digestCount: 99 }],
			};
			const kv = createMockKV({ "digest:filters:anon": JSON.stringify(cachedData) });
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db, KV: kv });
			const ctx = createMockCtx();
			const request = new Request("https://api.example.com/api/v1/digest/filters");

			const response = await digest.filters(request, env, ctx);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: typeof cachedData };
			expect(body.data.years).toEqual([2025, 2024]);
			expect(body.data.forums[0].name).toBe("Cached");
			expect(kv.get).toHaveBeenCalled();
			expect(kv.put).not.toHaveBeenCalled();
		});

		it("should write to KV cache after D1 read on miss", async () => {
			const kv = createMockKV({});
			const { db } = createMockDb({
				allResults: {
					"SELECT DISTINCT strftime": [{ year: "2026" }],
					"SELECT f.id, f.name": [{ id: 3, name: "New", digest_count: 7 }],
				},
			});
			const env = makeEnv({ DB: db, KV: kv });
			const ctx = createMockCtx();
			const request = new Request("https://api.example.com/api/v1/digest/filters");

			const response = await digest.filters(request, env, ctx);

			expect(response.status).toBe(200);
			expect(kv.put).toHaveBeenCalledTimes(1);
			const putCall = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(putCall[0]).toBe("digest:filters:anon");
			expect((putCall[2] as { expirationTtl: number }).expirationTtl).toBe(3600);
		});
	});
});
