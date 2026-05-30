import { beforeEach, describe, expect, it, vi } from "vitest";
import { getThreadTypes } from "../../../src/handlers/forum";
import { createMockCtx, createMockKV, makeEnv } from "../../helpers";

// We mock the v2 forum:meta path so the test focuses on:
//   1. Visibility / 403 / 404 propagation from getForumMetaV2
//   2. The shape of the public payload (config + types[])
//   3. WHERE filter (enabled = 1, ORDER BY display_order ASC, id ASC)
vi.mock("../../../src/middleware/auth", () => ({
	optionalAuthVerified: vi.fn(async () => null),
}));

vi.mock("../../../src/lib/cache/forum-read", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/cache/forum-read")>(
		"../../../src/lib/cache/forum-read",
	);
	return {
		...actual,
		getForumMetaV2: vi.fn(),
		// Stubbed to satisfy the closure capture in getThreadTypes — the
		// loadFullForumFromD1 callback is never invoked because we mock the
		// surrounding getForumMetaV2 directly.
	};
});

import type { Forum } from "@ellie/types";
import { getForumMetaV2 } from "../../../src/lib/cache/forum-read";

const mockGetMeta = getForumMetaV2 as ReturnType<typeof vi.fn>;

function makeForum(overrides?: Partial<Forum>): Forum {
	return {
		id: 1,
		parentId: 0,
		name: "General",
		description: "",
		icon: "",
		displayOrder: 1,
		threads: 0,
		posts: 0,
		type: "forum" as Forum["type"],
		status: 1,
		visibility: "public",
		moderators: "",
		moderatorList: [],
		todayThreads: 0,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: "",
		threadTypes: { enabled: true, required: false, listable: true, prefix: false },
		...overrides,
	};
}

describe("getThreadTypes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 400 for invalid forum ID", async () => {
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/abc/thread-types");
		const res = await getThreadTypes(req, env, ctx);
		expect(res.status).toBe(400);
	});

	it("returns 404 when meta path reports notFound (forum missing or inactive)", async () => {
		mockGetMeta.mockResolvedValue({ kind: "notFound" });
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/999/thread-types");
		const res = await getThreadTypes(req, env, ctx);
		expect(res.status).toBe(404);
	});

	it("returns 403 when meta path reports forbidden (visibility mismatch)", async () => {
		mockGetMeta.mockResolvedValue({ kind: "forbidden" });
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/5/thread-types");
		const res = await getThreadTypes(req, env, ctx);
		expect(res.status).toBe(403);
	});

	it("returns config + enabled rows on 200", async () => {
		mockGetMeta.mockResolvedValue({
			kind: "ok",
			forum: makeForum({
				id: 7,
				threadTypes: { enabled: true, required: true, listable: true, prefix: false },
			}),
		});
		const all = vi.fn().mockResolvedValue({
			results: [
				{
					id: 11,
					name: "Question",
					display_order: 0,
					icon: "❓",
					enabled: 1,
					moderator_only: 0,
				},
				{
					id: 12,
					name: "Answer",
					display_order: 1,
					icon: "",
					enabled: 1,
					moderator_only: 1,
				},
			],
		});
		const bind = vi.fn().mockReturnValue({ all });
		const prepare = vi.fn().mockReturnValue({ bind });
		const env = makeEnv({ DB: { prepare } as unknown as D1Database });
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/7/thread-types");
		const res = await getThreadTypes(req, env, ctx);
		expect(res.status).toBe(200);

		const body = (await res.json()) as { data: unknown };
		expect(body.data).toEqual({
			enabled: true,
			required: true,
			listable: true,
			prefix: false,
			types: [
				{
					id: 11,
					name: "Question",
					displayOrder: 0,
					icon: "❓",
					enabled: true,
					moderatorOnly: false,
				},
				{
					id: 12,
					name: "Answer",
					displayOrder: 1,
					icon: "",
					enabled: true,
					moderatorOnly: true,
				},
			],
		});

		// Pin: only enabled rows surface (tombstones excluded). The SQL
		// must filter on `enabled = 1` and order by display_order then id —
		// regression-guard the WHERE clause directly. Also pin the column
		// list so the full ForumThreadType DTO surface stays available.
		const sql = (prepare.mock.calls[0]?.[0] ?? "") as string;
		expect(sql).toMatch(/WHERE\s+forum_id\s*=\s*\?\s+AND\s+enabled\s*=\s*1/i);
		expect(sql).toMatch(/ORDER\s+BY\s+display_order\s+ASC\s*,\s*id\s+ASC/i);
		expect(sql).toMatch(/icon/);
		expect(sql).toMatch(/moderator_only/);
		expect(bind).toHaveBeenCalledWith(7);
	});

	it("empty types[] is a valid payload (forum has switches but no rows)", async () => {
		mockGetMeta.mockResolvedValue({
			kind: "ok",
			forum: makeForum({
				id: 9,
				threadTypes: { enabled: false, required: false, listable: false, prefix: false },
			}),
		});
		const all = vi.fn().mockResolvedValue({ results: [] });
		const env = makeEnv({
			DB: {
				prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all }) }),
			} as unknown as D1Database,
		});
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/9/thread-types");
		const res = await getThreadTypes(req, env, ctx);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { types: unknown[]; enabled: boolean } };
		expect(body.data.types).toEqual([]);
		expect(body.data.enabled).toBe(false);
	});

	it("does NOT expose source_typeid (admin-only field)", async () => {
		mockGetMeta.mockResolvedValue({
			kind: "ok",
			forum: makeForum({ id: 7 }),
		});
		const all = vi.fn().mockResolvedValue({
			results: [
				{
					id: 11,
					name: "Q",
					display_order: 0,
					icon: "",
					enabled: 1,
					moderator_only: 0,
					source_typeid: 999,
				},
			],
		});
		const env = makeEnv({
			DB: {
				prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all }) }),
			} as unknown as D1Database,
		});
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/7/thread-types");
		const res = await getThreadTypes(req, env, ctx);
		const body = (await res.json()) as {
			data: { types: Array<Record<string, unknown>> };
		};
		expect(body.data.types[0]).toEqual({
			id: 11,
			name: "Q",
			displayOrder: 0,
			icon: "",
			enabled: true,
			moderatorOnly: false,
		});
		expect("source_typeid" in body.data.types[0]).toBe(false);
		expect("typeId" in body.data.types[0]).toBe(false);
	});

	it("falls back to empty icon when DB returns NULL", async () => {
		mockGetMeta.mockResolvedValue({
			kind: "ok",
			forum: makeForum({ id: 7 }),
		});
		const all = vi.fn().mockResolvedValue({
			results: [
				{
					id: 11,
					name: "Q",
					display_order: 0,
					icon: null,
					enabled: 1,
					moderator_only: 0,
				},
			],
		});
		const env = makeEnv({
			DB: {
				prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all }) }),
			} as unknown as D1Database,
		});
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/7/thread-types");
		const res = await getThreadTypes(req, env, ctx);
		const body = (await res.json()) as { data: { types: Array<{ icon: string }> } };
		expect(body.data.types[0].icon).toBe("");
	});

	it("returns cached data on KV hit without querying D1 for rows", async () => {
		const cachedPayload = {
			enabled: true,
			required: false,
			listable: true,
			prefix: false,
			types: [
				{ id: 88, name: "Cached", displayOrder: 0, icon: "", enabled: true, moderatorOnly: false },
			],
		};
		mockGetMeta.mockResolvedValue({
			kind: "ok",
			forum: makeForum({ id: 5 }),
		});
		const kv = createMockKV({ "thread-types:5": JSON.stringify(cachedPayload) });
		const all = vi.fn();
		const prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all }) });
		const env = makeEnv({ DB: { prepare } as unknown as D1Database, KV: kv });
		const ctx = createMockCtx();

		const req = new Request("https://api.example.com/api/v1/forums/5/thread-types");
		const res = await getThreadTypes(req, env, ctx);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: typeof cachedPayload };
		expect(body.data.types[0].id).toBe(88);
		// DB all() should not be called (cache hit)
		expect(all).not.toHaveBeenCalled();
	});

	it("writes to KV cache after D1 query on cache miss", async () => {
		mockGetMeta.mockResolvedValue({
			kind: "ok",
			forum: makeForum({
				id: 3,
				threadTypes: { enabled: true, required: false, listable: false, prefix: true },
			}),
		});
		const all = vi.fn().mockResolvedValue({
			results: [
				{ id: 77, name: "Fresh", display_order: 0, icon: "", enabled: 1, moderator_only: 0 },
			],
		});
		const kv = createMockKV({});
		const env = makeEnv({
			DB: {
				prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all }) }),
			} as unknown as D1Database,
			KV: kv,
		});
		const ctx = createMockCtx();

		const req = new Request("https://api.example.com/api/v1/forums/3/thread-types");
		const res = await getThreadTypes(req, env, ctx);

		expect(res.status).toBe(200);
		expect(kv.put).toHaveBeenCalledTimes(1);
		const putCall = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(putCall[0]).toBe("thread-types:3");
		expect((putCall[2] as { expirationTtl: number }).expirationTtl).toBe(86400);
	});
});
