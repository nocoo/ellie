import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	batchFetch as getUserBatch,
	getById as getUserById,
} from "../../../../src/handlers/admin/user";
import {
	adminEntityCacheKey,
	getAdminEntities,
	isAdminEntityCacheData,
	readAdminEntity,
	rebuildAdminEntityCache,
} from "../../../../src/lib/cache/admin-entity-read";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(1_700_000_000_000);
	f = readingFixture();
});

afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("lib/cache/admin-entity-read — descriptors, keys, and validation", () => {
	it("enforces admin scope strictly", async () => {
		const desc: CacheDescriptor = {
			family: "admin:entity:detail",
			scope: "public",
			params: { entity: "users", id: 10 },
		};
		await expect(adminEntityCacheKey(f.env, desc)).rejects.toThrow("Admin scope is required");
		await expect(rebuildAdminEntityCache(f.env, undefined, desc)).rejects.toThrow(
			"Admin scope is required",
		);
	});

	it("validates exact descriptor dimensions for admin:entity:detail and admin:entity:list", async () => {
		// Valid detail descriptor
		const validDetail: CacheDescriptor = {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 10 },
		};
		const key = await adminEntityCacheKey(f.env, validDetail);
		expect(key).toContain("cache:v3:admin:entity:detail:");
		expect(f.calls).toHaveLength(0); // Zero D1 queries during key generation

		// Invalid detail id
		await expect(
			adminEntityCacheKey(f.env, {
				family: "admin:entity:detail",
				scope: "admin",
				params: { entity: "users", id: 0 },
			}),
		).rejects.toThrow("Invalid admin entity ID");

		await expect(
			adminEntityCacheKey(f.env, {
				family: "admin:entity:detail",
				scope: "admin",
				params: { entity: "users", id: -5 },
			}),
		).rejects.toThrow("Invalid admin entity ID");

		// Unexpected params on detail
		await expect(
			adminEntityCacheKey(f.env, {
				family: "admin:entity:detail",
				scope: "admin",
				params: { entity: "users", id: 10, extra: 1 },
			}),
		).rejects.toThrow("Invalid admin entity ID");

		// Valid list descriptor (query must match adminListQuery normalized string)
		const validList: CacheDescriptor = {
			family: "admin:entity:list",
			scope: "admin",
			params: { entity: "users", query: "limit=20&page=1" },
		};
		const listKey = await adminEntityCacheKey(f.env, validList);
		expect(listKey).toContain("cache:v3:admin:entity:list:");

		// Unnormalized list query throws
		await expect(
			adminEntityCacheKey(f.env, {
				family: "admin:entity:list",
				scope: "admin",
				params: { entity: "users", query: "page=1&limit=20" }, // not sorted
			}),
		).rejects.toThrow("Invalid admin list parameters");

		// Unknown entity throws
		await expect(
			adminEntityCacheKey(f.env, {
				family: "admin:entity:detail",
				scope: "admin",
				params: { entity: "nonexistent_table", id: 1 },
			}),
		).rejects.toThrow("Unknown admin entity");
	});

	it("validates static admin families (admin:settings, admin:users:staff, admin:thread-types)", async () => {
		const staffDesc: CacheDescriptor = {
			family: "admin:users:staff",
			scope: "admin",
			params: {},
		};
		expect(await adminEntityCacheKey(f.env, staffDesc)).toContain("cache:v3:admin:users:staff:");

		const settingsDesc: CacheDescriptor = {
			family: "admin:settings",
			scope: "admin",
			params: {},
		};
		expect(await adminEntityCacheKey(f.env, settingsDesc)).toContain("cache:v3:admin:settings:");

		const threadTypesDesc: CacheDescriptor = {
			family: "admin:thread-types",
			scope: "admin",
			params: { forumId: 1 },
		};
		expect(await adminEntityCacheKey(f.env, threadTypesDesc)).toContain(
			"cache:v3:admin:thread-types:",
		);

		// Invalid forumId
		await expect(
			adminEntityCacheKey(f.env, {
				family: "admin:thread-types",
				scope: "admin",
				params: { forumId: 0 },
			}),
		).rejects.toThrow("Invalid admin display parameters");
	});
});

describe("lib/cache/admin-entity-read — pure static rebuild and data validation", () => {
	it("rebuildAdminEntityCache rebuilds detail, list, and static collections", async () => {
		// Detail rebuild
		const user = (await rebuildAdminEntityCache(f.env, undefined, {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 10 },
		})) as { id: number; username: string };
		expect(user).toBeDefined();
		expect(user.id).toBe(10);
		expect(user.username).toBe("alice");

		// Missing detail rebuild returns null
		const missingUser = await rebuildAdminEntityCache(f.env, undefined, {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 99999 },
		});
		expect(missingUser).toBeNull();

		// List rebuild
		const list = (await rebuildAdminEntityCache(f.env, undefined, {
			family: "admin:entity:list",
			scope: "admin",
			params: { entity: "users", query: "limit=20&page=1" },
		})) as { items: unknown[]; total: number; page: number; limit: number; paginated: boolean };
		expect(list.items.length).toBeGreaterThan(0);
		expect(list.total).toBeGreaterThanOrEqual(5);

		// Staff list rebuild (in fixture: mod 30 role 3, admin 1 role 1, super 2 role 2)
		const staff = (await rebuildAdminEntityCache(f.env, undefined, {
			family: "admin:users:staff",
			scope: "admin",
			params: {},
		})) as { id: number; role: number }[];
		expect(staff.length).toBe(3);
		expect(staff.map((s) => s.id).sort()).toEqual([1, 2, 30]);
	});

	it("isAdminEntityCacheData validates structure and handles negative caching", async () => {
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 10 },
		};
		const user = (await rebuildAdminEntityCache(f.env, undefined, detailDesc)) as Record<
			string,
			unknown
		>;
		expect(isAdminEntityCacheData(detailDesc, user)).toBe(true);
		expect(isAdminEntityCacheData(detailDesc, { ...user, id: 20 })).toBe(false);
		expect(isAdminEntityCacheData(detailDesc, { id: 10, username: "alice" })).toBe(false);
		expect(isAdminEntityCacheData(detailDesc, null)).toBe(true); // negative cache allowed for detail

		const listDesc: CacheDescriptor = {
			family: "admin:entity:list",
			scope: "admin",
			params: { entity: "users", query: "limit=20&page=1" },
		};
		expect(
			isAdminEntityCacheData(listDesc, {
				items: [],
				total: 0,
				page: 1,
				limit: 20,
				paginated: true,
			}),
		).toBe(true);
		expect(isAdminEntityCacheData(listDesc, null)).toBe(false);
	});
});

describe("lib/cache/admin-entity-read — readAdminEntity caching & query budgets", () => {
	it("list and detail use SHORT tier (60s) and serve hot reads with zero D1 queries", async () => {
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 10 },
		};

		// Cold read
		const cold = (await readAdminEntity(f.env, f.ctx, detailDesc)) as { id: number };
		expect(cold.id).toBe(10);
		const coldCalls = f.calls.length;
		expect(coldCalls).toBeGreaterThan(0);

		// Hot read
		const hot = (await readAdminEntity(f.env, f.ctx, detailDesc)) as { id: number };
		expect(hot.id).toBe(10);
		expect(f.calls.length).toBe(coldCalls); // zero additional D1 queries

		// Verify SHORT tier envelope in KV
		const key = await adminEntityCacheKey(f.env, detailDesc);
		const raw = (await f.env.KV.get(key, "json")) as {
			tier: string;
			expiresAt: number;
			loadedAt: number;
		};
		expect(raw.tier).toBe("SHORT");
		expect(raw.expiresAt - raw.loadedAt).toBe(60_000);
	});

	it("null detail is cached negatively as SHORT (60s)", async () => {
		const missingDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 9999 },
		};
		const cold = await readAdminEntity(f.env, f.ctx, missingDesc);
		expect(cold).toBeNull();

		const callsBefore = f.calls.length;
		const hot = await readAdminEntity(f.env, f.ctx, missingDesc);
		expect(hot).toBeNull();
		expect(f.calls.length).toBe(callsBefore);

		const key = await adminEntityCacheKey(f.env, missingDesc);
		const raw = (await f.env.KV.get(key, "json")) as { tier: string; data: unknown };
		expect(raw.tier).toBe("SHORT");
		expect(raw.data).toBeNull();
	});
});

describe("lib/cache/admin-entity-read — getAdminEntities batch queries & limits", () => {
	it("batches all-cold IDs into chunks of <= 100 without N+1 queries", async () => {
		// Insert 105 users (id 101 to 205)
		for (let id = 101; id <= 205; id++) {
			f.insert("users", {
				id,
				username: `user_${id}`,
				email_verified_at: 1,
				role: 0,
			});
		}

		const ids = Array.from({ length: 105 }, (_, i) => 101 + i);
		f.calls.length = 0;

		const result = await getAdminEntities<{ id: number; username: string }>(
			f.env,
			f.ctx,
			"users",
			ids,
		);
		expect(result.size).toBe(105);
		expect(result.get(101)?.username).toBe("user_101");
		expect(result.get(205)?.username).toBe("user_205");

		// Chunks of max 100: 105 IDs require exactly 2 SELECT queries
		const selectCalls = f.calls.filter((c) => c.sql.includes("FROM users WHERE id IN"));
		expect(selectCalls).toHaveLength(2);
		expect(selectCalls[0].params.length).toBe(100);
		expect(selectCalls[1].params.length).toBe(5);
	});

	it("loads only missing IDs on partial cache misses and reuses detail entries", async () => {
		// Preload user 10 into cache via readAdminEntity
		const u10 = await readAdminEntity(f.env, f.ctx, {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 10 },
		});
		expect(u10).toBeDefined();

		f.calls.length = 0;

		// Batch request for users [10, 20] (where 10 is hot hit, 20 is cold miss)
		const batch = await getAdminEntities<{ id: number; username: string }>(
			f.env,
			f.ctx,
			"users",
			[10, 20],
		);
		expect(batch.size).toBe(2);
		expect(batch.get(10)?.username).toBe("alice");
		expect(batch.get(20)?.username).toBe("bob");

		const selectCalls = f.calls.filter((c) => c.sql.includes("FROM users WHERE id IN"));
		expect(selectCalls).toHaveLength(1);
		// Only queried user 20
		expect(selectCalls[0].params).toEqual([20]);
	});

	it("detail and batch share the exact same cache entries", async () => {
		// Load via getAdminEntities
		await getAdminEntities(f.env, f.ctx, "users", [20]);

		f.calls.length = 0;

		// Read via readAdminEntity (detail)
		const detail = (await readAdminEntity(f.env, f.ctx, {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 20 },
		})) as { id: number; username: string };

		expect(detail.id).toBe(20);
		expect(detail.username).toBe("bob");
		// Zero D1 calls because batch populated the exact detail cache key
		expect(f.calls).toHaveLength(0);
	});
});

describe("lib/cache/admin-entity-read — user detail handler", () => {
	it("admin getById reuses cached user entities without retired online reads", async () => {
		const req = createAdminRequest("GET", "/api/admin/users/10");

		// Run 1: cold load without online activity
		const res1 = await getUserById(req, f.env, f.ctx);
		expect(res1.status).toBe(200);
		const body1 = (await res1.json()) as { data: { id: number; onlineIp?: string } };
		expect(body1.data.id).toBe(10);
		expect(body1.data.onlineIp).toBeUndefined();

		const callsBefore = f.calls.length;

		// Set active online session in KV (ts within 15 minutes)
		await f.env.KV.put(
			"online:10",
			JSON.stringify({ ip: "198.51.100.1", page: "/forum", ts: 1_700_000_000 - 30 }),
		);

		// Retired snapshots must not affect a hot entity read.
		const res2 = await getUserById(req, f.env, f.ctx);
		expect(res2.status).toBe(200);
		const body2 = (await res2.json()) as {
			data: { id: number; onlineIp?: string; onlinePage?: string };
		};
		expect(body2.data.id).toBe(10);
		expect(body2.data.onlineIp).toBeUndefined();
		expect(body2.data.onlinePage).toBeUndefined();
		expect(vi.mocked(f.env.KV.get).mock.calls.some(([key]) => key === "online:10")).toBe(false);

		// User row was NOT re-queried from D1
		const userQueries = f.calls.slice(callsBefore).filter((c) => c.sql.includes("FROM users"));
		expect(userQueries).toHaveLength(0);
	});

	it("admin getUserBatch delegates to getAdminEntities", async () => {
		const req = createAdminRequest("GET", "/api/admin/users/batch?ids=10,20");
		const res = await getUserBatch(req, f.env, f.ctx);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { id: number }[] };
		expect(body.data).toHaveLength(2);
		expect(body.data.map((u) => u.id).sort()).toEqual([10, 20]);
	});
});

describe("lib/cache/admin-entity-read — fault tolerance & errors", () => {
	it("poisoned/corrupt KV entry is rejected by validator and falls back to fresh load", async () => {
		const desc: CacheDescriptor = {
			family: "admin:entity:detail",
			scope: "admin",
			params: { entity: "users", id: 10 },
		};
		const key = await adminEntityCacheKey(f.env, desc);

		// Store corrupt JSON / wrong shape in KV
		await f.env.KV.put(key, JSON.stringify({ wrong: "envelope" }));

		const res = (await readAdminEntity(f.env, f.ctx, desc)) as { id: number; username: string };
		expect(res).toBeDefined();
		expect(res.id).toBe(10);
		expect(res.username).toBe("alice");
	});

	it("D1 query failure rejects without corrupting cache or returning fake data", async () => {
		const listDesc: CacheDescriptor = {
			family: "admin:entity:list",
			scope: "admin",
			params: { entity: "users", query: "limit=20&page=1" },
		};
		f.state.queryError = true;

		// List rebuild fails on D1 queryError
		await expect(rebuildAdminEntityCache(f.env, undefined, listDesc)).rejects.toThrow();

		// Batch load also throws on D1 failure
		await expect(getAdminEntities(f.env, f.ctx, "users", [10])).rejects.toThrow();
	});
});

it("shares filter totals across pages for one hour and invalidates after an admin mutation", async () => {
	const { list } = await import("../../../../src/handlers/admin/user");
	const { invalidateAdminEntityCache } = await import(
		"../../../../src/lib/cache/admin-entity-read"
	);
	const read = async (query: string) =>
		await (await list(createAdminRequest("GET", `/api/admin/users?${query}`), f.env)).json();
	await read("page=1&limit=2&status=0");
	await read("page=2&limit=1&status=00");
	expect(f.calls.filter((c) => c.sql.includes("COUNT(*)"))).toHaveLength(1);
	expect(f.snapshots("admin:entity:count")[0]).toMatchObject({
		tier: "HOUR",
		params: { entity: "users", query: "status=0" },
	});
	vi.setSystemTime(Date.now() + 3_599_000);
	await read("page=1&limit=3&status=0");
	expect(f.calls.filter((c) => c.sql.includes("COUNT(*)"))).toHaveLength(1);
	vi.setSystemTime(Date.now() + 1_001);
	await read("page=2&limit=3&status=0");
	expect(f.calls.filter((c) => c.sql.includes("COUNT(*)"))).toHaveLength(2);
	await invalidateAdminEntityCache(f.env, "users");
	await read("page=1&limit=2&status=0");
	expect(f.calls.filter((c) => c.sql.includes("COUNT(*)"))).toHaveLength(3);
	await read("status=-1");
	expect(f.calls.filter((c) => c.sql.includes("COUNT(*)"))).toHaveLength(4);
});
it("validates and rebuilds count snapshots without reading any page rows", async () => {
	const d = {
		family: "admin:entity:count",
		scope: "admin",
		params: { entity: "users", query: "" },
	};
	expect(await rebuildAdminEntityCache(f.env, undefined, d)).toBe(5);
	expect(f.calls).toHaveLength(1);
	expect(isAdminEntityCacheData(d, 5)).toBe(true);
	expect(isAdminEntityCacheData(d, -1)).toBe(false);
	await expect(
		adminEntityCacheKey(f.env, { ...d, params: { entity: "users", query: "page=2" } }),
	).rejects.toThrow("Invalid admin list parameters");
});

it("keeps a newly populated last page visible even with an older cached total", async () => {
	const { list } = await import("../../../../src/handlers/admin/user");
	await list(createAdminRequest("GET", "/api/admin/users?limit=5"), f.env);
	f.insert("users", { id: 99, username: "new-user" });
	const res = await list(createAdminRequest("GET", "/api/admin/users?page=2&limit=5"), f.env);
	const body = await res.json();
	expect(body.data).toHaveLength(1);
	expect(body.meta.total).toBe(6);
	expect(f.calls.filter((c) => c.sql.includes("COUNT(*)"))).toHaveLength(1);
});

it("explicitly rebuilding a list reads its authoritative total instead of the cached count", async () => {
	const { list } = await import("../../../../src/handlers/admin/user");
	const { rebuildCacheEntry } = await import("../../../../src/lib/cache/manage");
	await list(createAdminRequest("GET", "/api/admin/users?limit=2"), f.env);
	f.insert("users", { id: 99, username: "registered" });
	f.calls.length = 0;
	const entry = f.snapshots("admin:entity:list")[0];
	const rebuilt = await rebuildCacheEntry(f.env, undefined, entry.key);
	expect(rebuilt.data).toMatchObject({ total: 6 });
	expect(f.calls.filter((c) => c.sql.includes("COUNT(*)"))).toHaveLength(1);
});
