import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	batchDelete as censorWordBatchDelete,
	remove as censorWordRemove,
} from "../../../../src/handlers/admin/censorWord";
import { update as userUpdate } from "../../../../src/handlers/admin/user";
import {
	adminEntityCacheKey,
	invalidateAdminEntityCache,
	readAdminEntity,
} from "../../../../src/lib/cache/admin-entity-read";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, err) => {
		resolve = done;
		reject = err;
	});
	return { promise, resolve, reject };
}

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

describe("admin entity cache invalidation", () => {
	it("invalidates detail and list cache keys when an admin entity is updated via CRUD", async () => {
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "users", id: 10 },
			scope: "admin",
		};
		const listDesc: CacheDescriptor = {
			family: "admin:entity:list",
			params: { entity: "users", query: "limit=20&page=1" },
			scope: "admin",
		};

		// 1. Initial warm reads
		const key1 = await adminEntityCacheKey(f.env, detailDesc);
		const listKey1 = await adminEntityCacheKey(f.env, listDesc);

		const u1 = (await readAdminEntity(f.env, f.ctx, detailDesc)) as { credits: number };
		expect(u1.credits).toBe(0);

		const l1 = (await readAdminEntity(f.env, f.ctx, listDesc)) as { items: unknown[] };
		expect(l1.items.length).toBeGreaterThan(0);

		// Verified hot: subsequent reads do zero D1 queries
		const coldCalls = f.calls.length;
		await readAdminEntity(f.env, f.ctx, detailDesc);
		await readAdminEntity(f.env, f.ctx, listDesc);
		expect(f.calls.length).toBe(coldCalls);

		// 2. Perform CRUD update via user update handler (PATCH credits 0 -> 5)
		const req = createAdminRequest("PATCH", "/api/admin/users/10", { credits: 5 });
		const res = await userUpdate(req, f.env);
		expect(res.status).toBe(200);

		// 3. Verify canonical keys changed due to bumped generation
		const key2 = await adminEntityCacheKey(f.env, detailDesc);
		const listKey2 = await adminEntityCacheKey(f.env, listDesc);
		expect(key2).not.toBe(key1);
		expect(listKey2).not.toBe(listKey1);

		// 4. Subsequent read sees updated ground truth from D1
		const u2 = (await readAdminEntity(f.env, f.ctx, detailDesc)) as { credits: number };
		expect(u2.credits).toBe(5);
	});

	it("semantic no-op update (PATCHing identical value) does not bump generation", async () => {
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "users", id: 10 },
			scope: "admin",
		};
		const key1 = await adminEntityCacheKey(f.env, detailDesc);
		await readAdminEntity(f.env, f.ctx, detailDesc);

		// User 10 currently has credits = 0; PATCH credits: 0 is a semantic no-op
		const req = createAdminRequest("PATCH", "/api/admin/users/10", { credits: 0 });
		const res = await userUpdate(req, f.env);
		expect(res.status).toBe(200);

		// Key MUST be identical because no D1 write and no invalidation occurred
		const key2 = await adminEntityCacheKey(f.env, detailDesc);
		expect(key2).toBe(key1);
	});

	it("false-success D1 update (changes=0) does not bump generation or invalidate cache", async () => {
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "users", id: 10 },
			scope: "admin",
		};
		const key1 = await adminEntityCacheKey(f.env, detailDesc);
		await readAdminEntity(f.env, f.ctx, detailDesc);

		// Simulate a false-success D1 run where success=true but changes=0
		const origPrepare = f.env.DB.prepare.bind(f.env.DB);
		vi.spyOn(f.env.DB, "prepare").mockImplementation((sql: string) => {
			const stmt = origPrepare(sql);
			if (sql.startsWith("UPDATE users SET")) {
				return {
					bind: (..._params: unknown[]) => ({
						run: async () => ({
							success: true,
							results: [],
							meta: { changes: 0, last_row_id: 0 },
						}),
					}),
				} as unknown as D1PreparedStatement;
			}
			return stmt;
		});

		const req = createAdminRequest("PATCH", "/api/admin/users/10", { credits: 99 });
		const res = await userUpdate(req, f.env);
		expect(res.status).toBe(200);

		// Key must NOT have changed because meta.changes was 0
		const key2 = await adminEntityCacheKey(f.env, detailDesc);
		expect(key2).toBe(key1);
	});

	it("zero-change delete and batch delete do not bump generation", async () => {
		const desc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "censor_words", id: 1 },
			scope: "admin",
		};
		f.insert("censor_words", {
			id: 1,
			find: "bad",
			replacement: "***",
			action: "replace",
			admin_id: 1,
			admin_name: "admin",
			created_at: 100,
		});

		const k1 = await adminEntityCacheKey(f.env, desc);

		// Simulate DELETE where changes=0
		const origPrepare = f.env.DB.prepare.bind(f.env.DB);
		vi.spyOn(f.env.DB, "prepare").mockImplementation((sql: string) => {
			const stmt = origPrepare(sql);
			if (sql.startsWith("DELETE FROM censor_words")) {
				return {
					bind: () => ({
						run: async () => ({
							success: true,
							results: [],
							meta: { changes: 0, last_row_id: 0 },
						}),
					}),
				} as unknown as D1PreparedStatement;
			}
			return stmt;
		});

		// Single delete with changes=0
		const reqSingle = createAdminRequest("DELETE", "/api/admin/censor-words/1");
		const resSingle = await censorWordRemove(reqSingle, f.env);
		expect(resSingle.status).toBe(200);
		expect(await adminEntityCacheKey(f.env, desc)).toBe(k1);

		// Batch delete with changes=0
		const reqBatch = createAdminRequest("POST", "/api/admin/censor-words/batch-delete", {
			ids: [1],
		});
		const resBatch = await censorWordBatchDelete(reqBatch, f.env);
		expect(resBatch.status).toBe(200);
		const batchBody = (await resBatch.json()) as { data: { count: number } };
		expect(batchBody.data.count).toBe(0);
		expect(await adminEntityCacheKey(f.env, desc)).toBe(k1);
	});

	it("stale old loader vs new resource epoch: old loader completion cannot poison cache with previous version", async () => {
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "users", id: 10 },
			scope: "admin",
		};

		// 1. Warm initial read
		const key1 = await adminEntityCacheKey(f.env, detailDesc);
		await readAdminEntity(f.env, f.ctx, detailDesc);

		// 2. Start a real cache miss that pauses after reading the old D1 row.
		f.values.delete(key1);
		const selectCaptured = deferred<void>();
		const allowSelectToFinish = deferred<void>();

		let captureActive = true;
		f.state.afterRead = async (sql: string) => {
			if (captureActive && sql.includes("FROM users")) {
				captureActive = false;
				selectCaptured.resolve();
				await allowSelectToFinish.promise;
			}
		};

		const staleFill = readAdminEntity<{ credits: number }>(f.env, undefined, detailDesc);
		await selectCaptured.promise;

		// 3. Now a mutation happens (credits 0 -> 50) and invalidates the entity cache
		const req = createAdminRequest("PATCH", "/api/admin/users/10", { credits: 50 });
		const res = await userUpdate(req, f.env);
		expect(res.status).toBe(200);

		// Key changed to key2
		const key2 = await adminEntityCacheKey(f.env, detailDesc);
		expect(key2).not.toBe(key1);

		// 4. Release stale loader
		allowSelectToFinish.resolve();
		expect((await staleFill).credits).toBe(0);

		// 5. Active key2 must read the updated value (50) from D1, never the stale (0)
		f.state.afterRead = undefined;
		const fresh = (await readAdminEntity(f.env, f.ctx, detailDesc)) as { credits: number };
		expect(fresh.credits).toBe(50);
		const queries = f.calls.length;
		expect(await readAdminEntity(f.env, undefined, detailDesc)).toMatchObject({ credits: 50 });
		expect(f.calls).toHaveLength(queries);
	});

	it("executes exactly one KV epoch read per key and hot hit executes zero D1 queries", async () => {
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "users", id: 10 },
			scope: "admin",
		};

		vi.mocked(f.env.KV.get).mockClear();
		f.calls.length = 0;

		// 1. Cold key generation
		await adminEntityCacheKey(f.env, detailDesc);
		const epochGets = vi
			.mocked(f.env.KV.get)
			.mock.calls.filter((c) => String(c[0]).startsWith("admin:entity:gen:"));
		expect(epochGets).toHaveLength(1);
		expect(f.calls).toHaveLength(0); // Zero D1 queries during key generation

		// 2. Read and populate cache
		await readAdminEntity(f.env, f.ctx, detailDesc);
		const callsAfterCold = f.calls.length;
		expect(callsAfterCold).toBeGreaterThan(0);

		// 3. Hot read
		await readAdminEntity(f.env, f.ctx, detailDesc);
		// Zero additional D1 queries on hot read
		expect(f.calls.length).toBe(callsAfterCold);
	});

	it("failed write (404) does not bump generation or invalidate cache", async () => {
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "users", id: 10 },
			scope: "admin",
		};
		const key1 = await adminEntityCacheKey(f.env, detailDesc);
		await readAdminEntity(f.env, f.ctx, detailDesc);

		// Trigger failed update (non-existent user)
		const req = createAdminRequest("PATCH", "/api/admin/users/99999", { credits: 10 });
		const res = await userUpdate(req, f.env);
		expect(res.status).toBe(404);

		// Key must NOT have changed
		const key2 = await adminEntityCacheKey(f.env, detailDesc);
		expect(key2).toBe(key1);
	});

	it("invalidateAdminEntityCache handles custom resources like users, forum_thread_types, settings", async () => {
		const staffDesc: CacheDescriptor = { family: "admin:users:staff", params: {}, scope: "admin" };
		const kStaff1 = await adminEntityCacheKey(f.env, staffDesc);

		await invalidateAdminEntityCache(f.env, "users");

		const kStaff2 = await adminEntityCacheKey(f.env, staffDesc);
		expect(kStaff2).not.toBe(kStaff1);

		const ttDesc: CacheDescriptor = {
			family: "admin:thread-types",
			params: { forumId: 1 },
			scope: "admin",
		};
		const kTt1 = await adminEntityCacheKey(f.env, ttDesc);

		await invalidateAdminEntityCache(f.env, "forum_thread_types");

		const kTt2 = await adminEntityCacheKey(f.env, ttDesc);
		expect(kTt2).not.toBe(kTt1);

		const settingsDesc: CacheDescriptor = { family: "admin:settings", params: {}, scope: "admin" };
		const kSet1 = await adminEntityCacheKey(f.env, settingsDesc);

		await invalidateAdminEntityCache(f.env, "settings");

		const kSet2 = await adminEntityCacheKey(f.env, settingsDesc);
		expect(kSet2).not.toBe(kSet1);
	});

	it("unrelated entity generation bump does not invalidate other entities", async () => {
		const userDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "users", id: 10 },
			scope: "admin",
		};
		const forumDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "forums", id: 1 },
			scope: "admin",
		};

		const kUser1 = await adminEntityCacheKey(f.env, userDesc);
		const kForum1 = await adminEntityCacheKey(f.env, forumDesc);

		// Invalidate forums only
		await invalidateAdminEntityCache(f.env, "forums");

		const kUser2 = await adminEntityCacheKey(f.env, userDesc);
		const kForum2 = await adminEntityCacheKey(f.env, forumDesc);

		expect(kForum2).not.toBe(kForum1);
		// User key is untouched
		expect(kUser2).toBe(kUser1);
	});
});
