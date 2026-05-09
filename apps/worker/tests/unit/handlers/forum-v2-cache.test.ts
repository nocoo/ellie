// Tests for the v2 forum cache wired into list / getById / getAncestors.
// Covers reviewer-required invariants:
//   - bucket isolation (staff sees no admin-only; admin does)
//   - active filter (status !== 1 dropped from list / treated as 404 in getById)
//   - cache HIT path = 0 D1 calls (auth verify aside)
//   - cache MISS path writes only the requesting bucket's key
//   - getById 403 / 404 → no KV write
//   - flag disabled → no v2 KV interaction at all

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAncestors, getById, list } from "../../../src/handlers/forum";
import type { Env } from "../../../src/lib/env";
import { createMockCtx, createMockKV } from "../../helpers";

vi.mock("../../../src/middleware/auth", () => ({
	optionalAuthVerified: vi.fn(async () => null),
}));
import { optionalAuthVerified } from "../../../src/middleware/auth";
const mockAuth = optionalAuthVerified as ReturnType<typeof vi.fn>;

// ─── Helpers ────────────────────────────────────────────────────────

interface ForumD1 {
	id: number;
	parent_id: number;
	name: string;
	description: string;
	icon: string;
	display_order: number;
	threads: number;
	posts: number;
	type: string;
	status: number;
	visibility: string;
	moderators: string;
	moderator_ids: string;
	last_thread_id: number;
	last_post_at: number;
	last_poster: string;
	last_poster_id: number;
	last_thread_subject: string;
	last_poster_avatar?: string;
	last_poster_avatar_path?: string;
}

function makeForumRow(overrides: Partial<ForumD1> = {}): ForumD1 {
	return {
		id: 1,
		parent_id: 0,
		name: "Root",
		description: "d",
		icon: "i",
		display_order: 1,
		threads: 5,
		posts: 50,
		type: "forum",
		status: 1,
		visibility: "public",
		moderators: "",
		moderator_ids: "",
		last_thread_id: 100,
		last_post_at: 1700000000,
		last_poster: "alice",
		last_poster_id: 7,
		last_thread_subject: "hello",
		last_poster_avatar: "a.png",
		last_poster_avatar_path: "/avatars/a.png",
		...overrides,
	};
}

interface VisibleLastThreadFixture {
	forum_id: number;
	thread_id: number;
	subject: string;
	last_post_at: number;
	last_poster_id: number;
	last_poster: string;
}

interface UserFixture {
	id: number;
	username?: string;
	avatar?: string;
	avatar_path?: string;
}

/** D1 mock that routes by SQL keyword. Tracks all `prepare` calls. */
function makeD1Mock(
	forumRows: ForumD1[],
	opts: {
		visibleLastThreads?: VisibleLastThreadFixture[];
		users?: UserFixture[];
	} = {},
) {
	const prepareCalls: string[] = [];
	const visibleLastThreads = opts.visibleLastThreads ?? [];
	const users = opts.users ?? [];
	const db = {
		prepare: vi.fn((sql: string) => {
			prepareCalls.push(sql);
			// v2 snapshot: SELECT * FROM forums ORDER BY display_order
			if (
				sql.includes("SELECT * FROM forums") &&
				sql.includes("ORDER BY display_order") &&
				!sql.includes("WHERE")
			) {
				return {
					all: vi.fn(async () => ({ results: forumRows })),
				};
			}
			// legacy list snapshot: SELECT f.*, u.avatar... FROM forums f LEFT JOIN users
			if (
				sql.includes("FROM forums f") &&
				sql.includes("LEFT JOIN users") &&
				!sql.includes("WHERE")
			) {
				return {
					all: vi.fn(async () => ({ results: forumRows })),
				};
			}
			// today count
			if (
				sql.includes("created_at") &&
				sql.includes("FROM threads") &&
				sql.includes("GROUP BY forum_id")
			) {
				return {
					bind: vi.fn(() => ({ all: vi.fn(async () => ({ results: [] })) })),
				};
			}
			// today count for single forum (getById builder)
			if (sql.includes("COUNT(*)") && sql.includes("forum_id = ?")) {
				return {
					bind: vi.fn(() => ({ first: vi.fn(async () => ({ cnt: 0 })) })),
				};
			}
			// visible last threads (snapshot + handler share the same signature)
			if (sql.includes("MAX(last_post_at)")) {
				return {
					bind: vi.fn((...ids: number[]) => ({
						all: vi.fn(async () => ({
							results: visibleLastThreads.filter((v) => ids.includes(v.forum_id)),
						})),
					})),
				};
			}
			// users lookup (moderator names + visible-last-poster avatars)
			if (sql.includes("FROM users WHERE id IN")) {
				return {
					bind: vi.fn((...ids: number[]) => ({
						all: vi.fn(async () => ({
							results: users.filter((u) => ids.includes(u.id)),
						})),
					})),
				};
			}
			// getById raw row
			if (
				sql.includes("FROM forums f") &&
				sql.includes("LEFT JOIN users") &&
				sql.includes("WHERE f.id")
			) {
				return {
					bind: vi.fn((id: number) => ({
						first: vi.fn(async () => forumRows.find((r) => r.id === id) ?? null),
					})),
				};
			}
			// fallback
			return {
				bind: vi.fn(() => ({
					first: vi.fn(async () => null),
					all: vi.fn(async () => ({ results: [] })),
				})),
				all: vi.fn(async () => ({ results: [] })),
			};
		}),
	} as unknown as D1Database;
	return { db, prepareCalls };
}

function makeEnvV2(db: D1Database, kv: KVNamespace = createMockKV()): Env {
	return {
		API_KEY: "k",
		ADMIN_API_KEY: "a",
		DB: db,
		ENVIRONMENT: "test",
		JWT_SECRET: "s",
		KV: kv,
		USE_KV_FORUM_CACHE_V2: "true",
	} as Env;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.mockResolvedValue(null);
});

// ─── list ───────────────────────────────────────────────────────────

describe("forum.list — v2 cache", () => {
	it("anon bucket: drops admin-only and inactive forums", async () => {
		const rows = [
			makeForumRow({ id: 1, visibility: "public", status: 1 }),
			makeForumRow({ id: 2, visibility: "admin", status: 1 }),
			makeForumRow({ id: 3, visibility: "public", status: 0 }), // inactive
		];
		const visibleLastThreads = [
			{
				forum_id: 1,
				thread_id: 100,
				subject: "hello",
				last_post_at: 1700000000,
				last_poster_id: 7,
				last_poster: "alice",
			},
		];
		const users = [{ id: 7, username: "alice", avatar: "a.png", avatar_path: "/avatars/a.png" }];
		const { db } = makeD1Mock(rows, { visibleLastThreads, users });
		const env = makeEnvV2(db);
		const ctx = createMockCtx();

		const res = await list(new Request("https://x/api/v1/forums"), env, ctx);
		expect(res.status).toBe(200);
		const body: { data: Array<{ id: number; lastPosterAvatar: string }> } = await res.json();
		expect(body.data.map((f) => f.id)).toEqual([1]);
		expect(body.data[0].lastPosterAvatar).toBe("a.png");
	});

	it("admin bucket: includes admin-only active forums", async () => {
		mockAuth.mockResolvedValue({ userId: 1, role: 1 /* Admin */ });
		const rows = [
			makeForumRow({ id: 1, visibility: "public" }),
			makeForumRow({ id: 2, visibility: "admin" }),
		];
		const { db } = makeD1Mock(rows);
		const env = makeEnvV2(db);
		const ctx = createMockCtx();

		const res = await list(new Request("https://x/api/v1/forums"), env, ctx);
		expect(res.status).toBe(200);
		const body: { data: Array<{ id: number }> } = await res.json();
		expect(body.data.map((f) => f.id)).toEqual([1, 2]);
	});

	it("staff bucket: includes staff but NOT admin", async () => {
		mockAuth.mockResolvedValue({ userId: 1, role: 3 /* Mod */ });
		const rows = [
			makeForumRow({ id: 1, visibility: "public" }),
			makeForumRow({ id: 2, visibility: "staff" }),
			makeForumRow({ id: 3, visibility: "admin" }),
		];
		const { db } = makeD1Mock(rows);
		const env = makeEnvV2(db);
		const ctx = createMockCtx();

		const res = await list(new Request("https://x/api/v1/forums"), env, ctx);
		const body: { data: Array<{ id: number }> } = await res.json();
		expect(body.data.map((f) => f.id)).toEqual([1, 2]);
	});

	it("cache HIT: 0 DB prepare calls (auth aside)", async () => {
		// Pre-populate KV with valid tree + summary payloads.
		const initial: Record<string, string> = {};
		// gen tokens
		initial["forum:tree:gen"] = "tok-T";
		initial["forum:summary:gen"] = "tok-S";
		initial["forum:tree:v2:anon:gtok-T"] = JSON.stringify({
			bucket: "anon",
			forums: [
				{
					id: 1,
					parentId: 0,
					name: "Root",
					description: "d",
					icon: "i",
					displayOrder: 1,
					type: "forum",
					status: 1,
					visibility: "public",
					moderators: "",
					moderatorIds: "",
					moderatorList: [],
				},
			],
		});
		initial["forum:summary:v2:anon:gtok-S"] = JSON.stringify({
			bucket: "anon",
			aggregates: {
				1: {
					threads: 5,
					posts: 50,
					todayThreads: 0,
					lastThreadId: 100,
					lastThreadSubject: "hello",
					lastPostAt: 1700000000,
					lastPoster: "alice",
					lastPosterId: 7,
					lastPosterAvatar: "cached-avatar.png",
					lastPosterAvatarPath: "/cached/avatar.png",
				},
			},
		});
		const kv = createMockKV(initial);
		const { db, prepareCalls } = makeD1Mock([]);
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx();

		const res = await list(new Request("https://x/api/v1/forums"), env, ctx);
		const body: {
			data: Array<{ id: number; lastPosterAvatar: string; lastPosterAvatarPath: string }>;
		} = await res.json();
		expect(body.data[0].lastPosterAvatar).toBe("cached-avatar.png");
		expect(body.data[0].lastPosterAvatarPath).toBe("/cached/avatar.png");
		expect(prepareCalls).toEqual([]); // ZERO SQL on hit
	});

	it("cache MISS for member only writes the member key, not other buckets", async () => {
		mockAuth.mockResolvedValue({ userId: 1, role: 0 /* User */ });
		const initial: Record<string, string> = {
			"forum:tree:gen": "tT",
			"forum:summary:gen": "tS",
		};
		const kv = createMockKV(initial);
		const rows = [makeForumRow({ id: 1, visibility: "public" })];
		const { db } = makeD1Mock(rows);
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		await list(new Request("https://x/api/v1/forums"), env, ctx);
		// Wait for the deferred KV writes.
		await Promise.all(ctx._waitUntilPromises);

		const putMock = kv.put as unknown as ReturnType<typeof vi.fn>;
		const writtenKeys = putMock.mock.calls.map((c) => c[0] as string);
		expect(writtenKeys).toContain("forum:tree:v2:member:gtT");
		expect(writtenKeys).toContain("forum:summary:v2:member:gtS");
		// No other bucket keys should have been written.
		for (const bucket of ["anon", "staff", "admin"]) {
			expect(writtenKeys).not.toContain(`forum:tree:v2:${bucket}:gtT`);
			expect(writtenKeys).not.toContain(`forum:summary:v2:${bucket}:gtS`);
		}
	});

	it("cold-start (tree+summary both miss) loads forum snapshot only ONCE", async () => {
		const rows = [makeForumRow({ id: 1, visibility: "public" })];
		const { db, prepareCalls } = makeD1Mock(rows);
		const env = makeEnvV2(db);
		const ctx = createMockCtx();

		await list(new Request("https://x/api/v1/forums"), env, ctx);
		// The snapshot SQL is "SELECT * FROM forums ORDER BY display_order".
		const snapshotCalls = prepareCalls.filter(
			(s) =>
				s.includes("SELECT * FROM forums") &&
				s.includes("ORDER BY display_order") &&
				!s.includes("WHERE"),
		);
		expect(snapshotCalls.length).toBe(1);
	});

	it("visible last-thread overrides hidden forum row subject (list + summary cache)", async () => {
		// forums.last_thread_subject = "hidden-subj" with poster_id=99 (the
		// stored row points at a hidden / recycled thread). The visible
		// last-thread query returns subject="visible-subj" + poster_id=8.
		// v2 list response AND the written summary cache must use the
		// visible subject and the visible poster's avatar (NOT the row's
		// last_poster_id=99 avatar).
		const rows = [
			makeForumRow({
				id: 1,
				visibility: "public",
				last_thread_id: 999,
				last_thread_subject: "hidden-subj",
				last_post_at: 1_700_000_999,
				last_poster: "ghost",
				last_poster_id: 99,
			}),
		];
		const visibleLastThreads = [
			{
				forum_id: 1,
				thread_id: 100,
				subject: "visible-subj",
				last_post_at: 1_700_000_100,
				last_poster_id: 8,
				last_poster: "bob",
			},
		];
		const users = [
			// id=99 (hidden poster) MUST NOT be looked up; include it just to
			// prove that even if a buggy code path resolved it, the test fixture
			// has a different avatar than what we expect to flow through.
			{ id: 99, username: "ghost", avatar: "ghost.png", avatar_path: "/g.png" },
			{ id: 8, username: "bob", avatar: "bob.png", avatar_path: "/b.png" },
		];
		const kv = createMockKV({ "forum:tree:gen": "tT", "forum:summary:gen": "tS" });
		const { db } = makeD1Mock(rows, { visibleLastThreads, users });
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		const res = await list(new Request("https://x/api/v1/forums"), env, ctx);
		expect(res.status).toBe(200);
		const body: {
			data: Array<{
				id: number;
				lastThreadId: number;
				lastThreadSubject: string;
				lastPoster: string;
				lastPosterId: number;
				lastPosterAvatar: string;
				lastPosterAvatarPath: string;
				lastPostAt: number;
			}>;
		} = await res.json();
		const f = body.data[0];
		expect(f.lastThreadId).toBe(100);
		expect(f.lastThreadSubject).toBe("visible-subj");
		expect(f.lastPostAt).toBe(1_700_000_100);
		expect(f.lastPoster).toBe("bob");
		expect(f.lastPosterId).toBe(8);
		expect(f.lastPosterAvatar).toBe("bob.png");
		expect(f.lastPosterAvatarPath).toBe("/b.png");

		// Summary cache must also have been written with the visible values.
		await Promise.all(ctx._waitUntilPromises);
		const putMock = kv.put as unknown as ReturnType<typeof vi.fn>;
		const summaryWrite = putMock.mock.calls.find((c) =>
			(c[0] as string).startsWith("forum:summary:v2:anon:gtS"),
		);
		expect(summaryWrite).toBeDefined();
		const summaryPayload = JSON.parse(summaryWrite?.[1] as string) as {
			aggregates: Record<
				string,
				{
					lastThreadId: number;
					lastThreadSubject: string;
					lastPoster: string;
					lastPosterId: number;
					lastPosterAvatar: string;
					lastPosterAvatarPath: string;
				}
			>;
		};
		const agg = summaryPayload.aggregates["1"];
		expect(agg.lastThreadId).toBe(100);
		expect(agg.lastThreadSubject).toBe("visible-subj");
		expect(agg.lastPoster).toBe("bob");
		expect(agg.lastPosterId).toBe(8);
		expect(agg.lastPosterAvatar).toBe("bob.png");
		expect(agg.lastPosterAvatarPath).toBe("/b.png");
	});

	it("no visible thread → list response and summary cache clear last-* + avatar fields", async () => {
		const rows = [
			makeForumRow({
				id: 1,
				visibility: "public",
				last_thread_id: 999,
				last_thread_subject: "stale",
				last_poster: "ghost",
				last_poster_id: 99,
				last_post_at: 1_700_000_999,
			}),
		];
		// No visible threads returned by the visible-last-thread query.
		const kv = createMockKV({ "forum:tree:gen": "tT", "forum:summary:gen": "tS" });
		const { db } = makeD1Mock(rows, { visibleLastThreads: [], users: [] });
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		const res = await list(new Request("https://x/api/v1/forums"), env, ctx);
		const body: {
			data: Array<{
				lastThreadId: number;
				lastThreadSubject: string;
				lastPostAt: number;
				lastPoster: string;
				lastPosterId: number;
				lastPosterAvatar: string;
				lastPosterAvatarPath: string;
			}>;
		} = await res.json();
		const f = body.data[0];
		expect(f.lastThreadId).toBe(0);
		expect(f.lastThreadSubject).toBe("");
		expect(f.lastPostAt).toBe(0);
		expect(f.lastPoster).toBe("");
		expect(f.lastPosterId).toBe(0);
		expect(f.lastPosterAvatar).toBe("");
		expect(f.lastPosterAvatarPath).toBe("");

		await Promise.all(ctx._waitUntilPromises);
		const putMock = kv.put as unknown as ReturnType<typeof vi.fn>;
		const summaryWrite = putMock.mock.calls.find((c) =>
			(c[0] as string).startsWith("forum:summary:v2:anon:gtS"),
		);
		expect(summaryWrite).toBeDefined();
		const agg = (
			JSON.parse(summaryWrite?.[1] as string) as {
				aggregates: Record<
					string,
					{
						lastThreadId: number;
						lastThreadSubject: string;
						lastPostAt: number;
						lastPoster: string;
						lastPosterId: number;
						lastPosterAvatar: string;
						lastPosterAvatarPath: string;
					}
				>;
			}
		).aggregates["1"];
		expect(agg.lastThreadId).toBe(0);
		expect(agg.lastThreadSubject).toBe("");
		expect(agg.lastPostAt).toBe(0);
		expect(agg.lastPoster).toBe("");
		expect(agg.lastPosterId).toBe(0);
		expect(agg.lastPosterAvatar).toBe("");
		expect(agg.lastPosterAvatarPath).toBe("");
	});
});

// ─── getById ────────────────────────────────────────────────────────

describe("forum.getById — v2 cache", () => {
	it("404 when row does not exist (no KV write)", async () => {
		const { db } = makeD1Mock([]); // empty
		const kv = createMockKV({ "forum:summary:gen": "tS" });
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx();
		const res = await getById(new Request("https://x/api/v1/forums/99"), env, ctx);
		expect(res.status).toBe(404);
		const putMock = kv.put as unknown as ReturnType<typeof vi.fn>;
		expect(
			putMock.mock.calls.find((c) => (c[0] as string).startsWith("forum:meta:v2")),
		).toBeUndefined();
	});

	it("404 when row is inactive (no KV write)", async () => {
		const rows = [makeForumRow({ id: 5, status: 0, visibility: "public" })];
		const { db } = makeD1Mock(rows);
		const kv = createMockKV({ "forum:summary:gen": "tS" });
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx();
		const res = await getById(new Request("https://x/api/v1/forums/5"), env, ctx);
		expect(res.status).toBe(404);
		const putMock = kv.put as unknown as ReturnType<typeof vi.fn>;
		expect(
			putMock.mock.calls.find((c) => (c[0] as string).startsWith("forum:meta:v2")),
		).toBeUndefined();
	});

	it("403 when bucket cannot see (no KV write)", async () => {
		// anon caller, admin-only forum, active.
		const rows = [makeForumRow({ id: 7, status: 1, visibility: "admin" })];
		const { db } = makeD1Mock(rows);
		const kv = createMockKV({ "forum:summary:gen": "tS" });
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx();
		const res = await getById(new Request("https://x/api/v1/forums/7"), env, ctx);
		expect(res.status).toBe(403);
		const putMock = kv.put as unknown as ReturnType<typeof vi.fn>;
		expect(
			putMock.mock.calls.find((c) => (c[0] as string).startsWith("forum:meta:v2")),
		).toBeUndefined();
	});

	it("200 + writes meta key on miss for visible bucket", async () => {
		const rows = [makeForumRow({ id: 3, status: 1, visibility: "public" })];
		const { db } = makeD1Mock(rows);
		const kv = createMockKV({ "forum:summary:gen": "tS" });
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
		const res = await getById(new Request("https://x/api/v1/forums/3"), env, ctx);
		expect(res.status).toBe(200);
		await Promise.all(ctx._waitUntilPromises);
		const putMock = kv.put as unknown as ReturnType<typeof vi.fn>;
		const wrote = putMock.mock.calls.find((c) => (c[0] as string).startsWith("forum:meta:v2"));
		expect(wrote?.[0]).toBe("forum:meta:v2:3:anon:gtS");
	});

	it("cache HIT: 0 D1 calls", async () => {
		const initial: Record<string, string> = {
			"forum:summary:gen": "tS",
			"forum:meta:v2:3:anon:gtS": JSON.stringify({
				bucket: "anon",
				forum: {
					id: 3,
					parentId: 0,
					name: "Cached",
					description: "d",
					icon: "",
					displayOrder: 1,
					threads: 5,
					posts: 50,
					type: "forum",
					status: 1,
					visibility: "public",
					moderators: "",
					moderatorList: [],
					todayThreads: 0,
					lastThreadId: 100,
					lastPostAt: 1,
					lastPoster: "alice",
					lastPosterId: 7,
					lastPosterAvatar: "cached.png",
					lastPosterAvatarPath: "/c.png",
					lastThreadSubject: "h",
				},
			}),
		};
		const kv = createMockKV(initial);
		const { db, prepareCalls } = makeD1Mock([]);
		const env = makeEnvV2(db, kv);
		const ctx = createMockCtx();
		const res = await getById(new Request("https://x/api/v1/forums/3"), env, ctx);
		expect(res.status).toBe(200);
		const body: { data: { lastPosterAvatar: string; name: string } } = await res.json();
		expect(body.data.name).toBe("Cached");
		expect(body.data.lastPosterAvatar).toBe("cached.png");
		expect(prepareCalls).toEqual([]); // ZERO SQL on hit
	});
});

// ─── getAncestors ───────────────────────────────────────────────────

describe("forum.getAncestors — v2 cache", () => {
	it("hidden parent terminates ancestor chain (parent absent from filtered tree)", async () => {
		// Tree: root(1) → hidden(2, status=0) → child(3). For anon bucket,
		// hidden parent gets filtered, so when looking up id=3, ancestors
		// should be empty rather than leak {id:1, name:"Root"} via {id:2}.
		const rows = [
			makeForumRow({ id: 1, parent_id: 0, name: "Root", visibility: "public" }),
			makeForumRow({ id: 2, parent_id: 1, name: "Hidden", status: 0, visibility: "public" }),
			makeForumRow({ id: 3, parent_id: 2, name: "Child", visibility: "public" }),
		];
		const { db } = makeD1Mock(rows);
		const env = makeEnvV2(db);
		const ctx = createMockCtx();
		const res = await getAncestors(new Request("https://x/api/v1/forums/3/ancestors"), env, ctx);
		expect(res.status).toBe(200);
		const body: { data: { forum: { id: number }; ancestors: Array<{ id: number }> } } =
			await res.json();
		expect(body.data.forum.id).toBe(3);
		// Chain should NOT include id=1 because the link via hidden id=2 is broken.
		expect(body.data.ancestors).toEqual([]);
	});

	it("admin bucket sees admin-only forum in tree (404 to anon)", async () => {
		const rows = [makeForumRow({ id: 9, visibility: "admin" })];
		const { db } = makeD1Mock(rows);
		const env = makeEnvV2(db);

		// anon → 404
		mockAuth.mockResolvedValue(null);
		let res = await getAncestors(
			new Request("https://x/api/v1/forums/9/ancestors"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(404);

		// admin → 200
		mockAuth.mockResolvedValue({ userId: 1, role: 1 });
		res = await getAncestors(
			new Request("https://x/api/v1/forums/9/ancestors"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(200);
	});
});

// ─── disabled flag ──────────────────────────────────────────────────

describe("v2 flag disabled", () => {
	it("list does NOT touch v2 KV keys", async () => {
		const rows = [makeForumRow({ id: 1 })];
		const { db } = makeD1Mock(rows);
		const kv = createMockKV();
		// USE_KV_FORUM_CACHE_V2 absent ⇒ v2 disabled
		const env = {
			API_KEY: "k",
			ADMIN_API_KEY: "a",
			DB: db,
			ENVIRONMENT: "test",
			JWT_SECRET: "s",
			KV: kv,
		} as Env;
		const ctx = createMockCtx();
		await list(new Request("https://x/api/v1/forums"), env, ctx);
		const getMock = kv.get as unknown as ReturnType<typeof vi.fn>;
		const putMock = kv.put as unknown as ReturnType<typeof vi.fn>;
		const v2Touch = [...getMock.mock.calls, ...putMock.mock.calls].some(
			(c) =>
				(c[0] as string).startsWith("forum:tree:v2") ||
				(c[0] as string).startsWith("forum:summary:v2") ||
				(c[0] as string).startsWith("forum:meta:v2"),
		);
		expect(v2Touch).toBe(false);
	});
});
