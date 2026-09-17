import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../src/lib/env";
import { trackOnline } from "../../../src/middleware/online";

describe("middleware/online — memory budget, throttle, and fault recovery", () => {
	const BASE_TIME = 1_700_000_000_000;

	const createMockEnv = (
		kvPutImpl?: (key: string, value: string, opts?: unknown) => Promise<void>,
	) => {
		const kvPut = vi.fn(kvPutImpl ?? (() => Promise.resolve()));
		return {
			env: {
				API_KEY: "test-api-key",
				ADMIN_API_KEY: "test-admin-api-key",
				DB: {} as D1Database,
				ENVIRONMENT: "test",
				JWT_SECRET: "test-secret",
				KV: {
					put: kvPut,
					get: vi.fn(() => Promise.resolve(null)),
					list: vi.fn(() => Promise.resolve({ keys: [], list_complete: true })),
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
			} as Env,
			kvPut,
		};
	};

	const createMockCtx = () => {
		const waitUntilPromises: Promise<unknown>[] = [];
		return {
			ctx: {
				waitUntil: (p: Promise<unknown>) => {
					waitUntilPromises.push(p);
				},
				passThroughOnException: () => {},
			} as ExecutionContext,
			waitUntilPromises,
		};
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(BASE_TIME);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("throttles same-user online writes within 60 seconds (PRESENCE_WRITE_INTERVAL_MS)", async () => {
		const { env, kvPut } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 10, role: 0 };
		const req = new Request("https://example.com/api/v1/forums");

		// First call writes to KV
		trackOnline(req, env, ctx, user);
		await Promise.all(waitUntilPromises);
		expect(kvPut).toHaveBeenCalledTimes(1);

		// Second call at +30 seconds is throttled (no second KV put)
		vi.advanceTimersByTime(30_000);
		trackOnline(req, env, ctx, user);
		await Promise.all(waitUntilPromises);
		expect(kvPut).toHaveBeenCalledTimes(1);

		// Third call at +60 seconds (total 60s from first call) allows next write
		vi.advanceTimersByTime(30_000);
		trackOnline(req, env, ctx, user);
		await Promise.all(waitUntilPromises);
		expect(kvPut).toHaveBeenCalledTimes(2);
	});

	it("maintains user isolation without cross-user throttling", async () => {
		const { env, kvPut } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const req = new Request("https://example.com/api/v1/forums");

		// User A
		trackOnline(req, env, ctx, { userId: 10, role: 0 });
		// User B immediately after
		trackOnline(req, env, ctx, { userId: 20, role: 0 });
		await Promise.all(waitUntilPromises);

		expect(kvPut).toHaveBeenCalledTimes(2);
		expect(kvPut.mock.calls[0][0]).toBe("online:10");
		expect(kvPut.mock.calls[1][0]).toBe("online:20");
	});

	it("recovers reservation on KV write failure allowing immediate retry", async () => {
		let shouldFail = true;
		const { env, kvPut } = createMockEnv(async () => {
			if (shouldFail) throw new Error("KV outage");
		});
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 50, role: 0 };
		const req = new Request("https://example.com/api/v1/forums");

		// Call 1 fails asynchronously in waitUntil
		trackOnline(req, env, ctx, user);
		await Promise.all(waitUntilPromises);
		expect(kvPut).toHaveBeenCalledTimes(1);

		// Because KV write failed, the catch handler deleted the throttled timestamp for user 50.
		// Next call (even just 1 second later) should NOT be throttled and can retry.
		shouldFail = false;
		vi.advanceTimersByTime(1000);
		trackOnline(req, env, ctx, user);
		await Promise.all(waitUntilPromises);

		expect(kvPut).toHaveBeenCalledTimes(2);
	});

	it("caps in-memory lastWrites map at 4096 entries (LRU/FIFO eviction)", async () => {
		const { env, kvPut } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const req = new Request("https://example.com/api/v1/forums");

		// Insert 4096 unique users
		for (let uid = 1; uid <= 4096; uid++) {
			trackOnline(req, env, ctx, { userId: uid, role: 0 });
		}
		await Promise.all(waitUntilPromises);
		expect(kvPut).toHaveBeenCalledTimes(4096);

		// Inserting user 4097 evicts the oldest entry (user 1)
		trackOnline(req, env, ctx, { userId: 4097, role: 0 });
		await Promise.all(waitUntilPromises);
		expect(kvPut).toHaveBeenCalledTimes(4097);

		// User 1 was evicted, so even though 60s hasn't passed, user 1 can write again
		trackOnline(req, env, ctx, { userId: 1, role: 0 });
		await Promise.all(waitUntilPromises);
		expect(kvPut).toHaveBeenCalledTimes(4098);
	});

	it("isolates memory tracking per KV namespace instance", async () => {
		const { env: env1, kvPut: kvPut1 } = createMockEnv();
		const { env: env2, kvPut: kvPut2 } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 100, role: 0 };
		const req = new Request("https://example.com/api/v1/forums");

		// Write user 100 on env1
		trackOnline(req, env1, ctx, user);
		// Same user 100 on env2 should not be blocked by env1's in-memory record
		trackOnline(req, env2, ctx, user);
		await Promise.all(waitUntilPromises);

		expect(kvPut1).toHaveBeenCalledTimes(1);
		expect(kvPut2).toHaveBeenCalledTimes(1);
	});

	it("does not scan all users or perform list operations", async () => {
		const { env } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const req = new Request("https://example.com/api/v1/forums");

		trackOnline(req, env, ctx, { userId: 123, role: 0 });
		await Promise.all(waitUntilPromises);

		expect(env.KV.list).not.toHaveBeenCalled();
		expect(env.KV.get).not.toHaveBeenCalled();
	});
});
