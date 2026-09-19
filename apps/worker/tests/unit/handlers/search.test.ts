import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchThreads } from "../../../src/handlers/search";
import { createJwtForRole } from "../../helpers";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

describe("search handlers", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_700_000_000_000);
		f = readingFixture();
	});

	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("searchThreads", () => {
		it("returns 503 when search is disabled in settings", async () => {
			f.sqlite
				.prepare(
					"INSERT OR REPLACE INTO settings (key, value, type, updated_at) VALUES ('general.search.enabled', 'false', 'boolean', 0)",
				)
				.run();

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test"),
				f.env,
				f.ctx,
			);

			expect(response.status).toBe(503);
			const data = (await response.json()) as { error: { code: string } };
			expect(data.error.code).toBe("FEATURE_DISABLED");
		});

		it("returns 400 for empty or too short query", async () => {
			const resEmpty = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q="),
				f.env,
				f.ctx,
			);
			expect(resEmpty.status).toBe(400);

			const resShort = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=a"),
				f.env,
				f.ctx,
			);
			expect(resShort.status).toBe(400);
		});

		it("returns 400 for invalid cursor format", async () => {
			const res = await searchThreads(
				new Request(
					"https://api.example.com/api/v1/search/threads?q=hello&cursor=not-a-valid-cursor",
				),
				f.env,
				f.ctx,
			);
			expect(res.status).toBe(400);
		});

		it("executes real SQLite FTS search and returns results with total", async () => {
			f.thread(1, { subject: "TypeScript handbook" });
			f.thread(2, { subject: "Rust book" });

			const res = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=TypeScript"),
				f.env,
				f.ctx,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				data: { id: number; subject: string }[];
				meta: { total: number; nextCursor: string | null };
			};
			expect(body.data).toHaveLength(1);
			expect(body.data[0].id).toBe(1);
			expect(body.data[0].subject).toBe("TypeScript handbook");
			expect(body.meta.total).toBe(1);
			expect(body.meta.nextCursor).toBeNull();
		});

		it("composes current forum gates and hides private forums from unauthorized users", async () => {
			// forum 2 is staff-only
			f.thread(10, { forum_id: 2, subject: "Confidential handbook" });

			// Anonymous search finds 0
			const anonRes = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=Confidential"),
				f.env,
				f.ctx,
			);
			const anonBody = (await anonRes.json()) as { data: unknown[]; meta: { total: number } };
			expect(anonBody.data).toHaveLength(0);
			expect(anonBody.meta.total).toBe(0);

			// Staff search finds 1
			const token = await createJwtForRole(3, 30, f.env.JWT_SECRET);
			const staffRes = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=Confidential", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				f.env,
				f.ctx,
			);
			const staffBody = (await staffRes.json()) as {
				data: { id: number }[];
				meta: { total: number };
			};
			expect(staffBody.data).toHaveLength(1);
			expect(staffBody.data[0].id).toBe(10);
			expect(staffBody.meta.total).toBe(1);
		});

		it("supports pagination with nextCursor", async () => {
			for (let i = 1; i <= 3; i++) {
				f.thread(i, { subject: `Common guide part ${i}`, last_post_at: 1000 + i });
			}

			// Page 1 with limit 2
			const res1 = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=Common&limit=2"),
				f.env,
				f.ctx,
			);
			const body1 = (await res1.json()) as {
				data: { id: number }[];
				meta: { total: number; nextCursor: string };
			};
			expect(body1.data).toHaveLength(2);
			expect(body1.meta.total).toBe(3);
			expect(body1.meta.nextCursor).not.toBeNull();

			// Page 2
			const res2 = await searchThreads(
				new Request(
					`https://api.example.com/api/v1/search/threads?q=Common&limit=2&cursor=${encodeURIComponent(body1.meta.nextCursor)}`,
				),
				f.env,
				f.ctx,
			);
			const body2 = (await res2.json()) as {
				data: { id: number }[];
				meta: { total: number; nextCursor: string | null };
			};
			expect(body2.data).toHaveLength(1);
			expect(body2.meta.nextCursor).toBeNull();
		});

		it("serves repeated hot reads from cache without re-running FTS query", async () => {
			f.thread(1, { subject: "Unique keyword searching" });

			const req = new Request("https://api.example.com/api/v1/search/threads?q=Unique");
			const res1 = await searchThreads(req, f.env, f.ctx);
			expect(res1.status).toBe(200);

			const ftsCallsBefore = f.calls.filter((c) => c.sql.includes("threads_fts MATCH")).length;
			expect(ftsCallsBefore).toBe(2); // SELECT items + SELECT COUNT(*)

			// Repeated search (hot cache hit for catalog page)
			const res2 = await searchThreads(req, f.env, f.ctx);
			expect(res2.status).toBe(200);

			const ftsCallsAfter = f.calls.filter((c) => c.sql.includes("threads_fts MATCH")).length;
			// Never re-executes FTS match query
			expect(ftsCallsAfter).toBe(ftsCallsBefore);
		});
	});
});
