import { describe, expect, it, mock } from "bun:test";
import type { Env } from "../../../src/lib/env";
import { trackActivity } from "../../../src/middleware/activity";

describe("trackActivity", () => {
	const NOW = 1711900800; // Fixed timestamp for testing

	const createMockEnv = (options?: {
		throttleValue?: string | null;
		userData?: { last_activity: number; ol_time: number } | null;
	}) => {
		const kvGet = mock(() => Promise.resolve(options?.throttleValue ?? null));
		const kvPut = mock(() => Promise.resolve());
		// Use explicit check for undefined to allow null as a valid value
		const userDataValue =
			options?.userData === undefined ? { last_activity: 0, ol_time: 0 } : options.userData;
		const dbFirst = mock(() => Promise.resolve(userDataValue));
		const dbRun = mock(() => Promise.resolve({ success: true }));

		// Create separate bind mocks for SELECT and UPDATE queries
		const selectBind = mock(() => ({ first: dbFirst }));
		const updateBind = mock(() => ({ run: dbRun }));

		// Track which query is being prepared
		const dbPrepare = mock((sql: string) => {
			if (sql.includes("SELECT")) {
				return { bind: selectBind };
			}
			return { bind: updateBind };
		});

		return {
			env: {
				API_KEY: "test-api-key",
				ADMIN_API_KEY: "test-admin-api-key",
				DB: { prepare: dbPrepare } as unknown as D1Database,
				ENVIRONMENT: "test",
				JWT_SECRET: "test-secret",
				KV: {
					get: kvGet,
					put: kvPut,
					list: mock(() => Promise.resolve({ keys: [], list_complete: true })),
					delete: mock(() => Promise.resolve()),
				} as unknown as KVNamespace,
			} as Env,
			kvGet,
			kvPut,
			dbPrepare,
			selectBind,
			updateBind,
			dbFirst,
			dbRun,
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

	it("should skip if throttled (updated within 1 minute)", async () => {
		const recentUpdate = String(NOW - 30); // 30 seconds ago
		const { env, kvGet, dbPrepare } = createMockEnv({ throttleValue: recentUpdate });
		const { ctx } = createMockCtx();
		const user = { userId: 123, role: 0 };

		// Mock Date.now
		const originalNow = Date.now;
		Date.now = () => NOW * 1000;

		try {
			await trackActivity(env, ctx, user);

			expect(kvGet).toHaveBeenCalledWith("activity_throttle:123");
			expect(dbPrepare).not.toHaveBeenCalled(); // Should not query DB
		} finally {
			Date.now = originalNow;
		}
	});

	it("should update last_activity without adding ol_time for first activity", async () => {
		const { env, kvPut, updateBind, dbRun } = createMockEnv({
			throttleValue: null,
			userData: { last_activity: 0, ol_time: 0 },
		});
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 456, role: 0 };

		const originalNow = Date.now;
		Date.now = () => NOW * 1000;

		try {
			await trackActivity(env, ctx, user);
			await Promise.all(waitUntilPromises);

			// Should set throttle marker
			expect(kvPut).toHaveBeenCalledWith(`activity_throttle:456`, String(NOW), { expirationTtl: 120 });

			// Should update user with 0 additional minutes (first activity, gap > threshold)
			// Now includes optimistic lock: bind(now, addMinutes, userId, old_last_activity)
			expect(updateBind).toHaveBeenCalledWith(NOW, 0, 456, 0);
		} finally {
			Date.now = originalNow;
		}
	});

	it("should accumulate ol_time for activity within 30 minutes", async () => {
		const lastActivity = NOW - 600; // 10 minutes ago
		const { env, updateBind } = createMockEnv({
			throttleValue: null,
			userData: { last_activity: lastActivity, ol_time: 100 },
		});
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 789, role: 0 };

		const originalNow = Date.now;
		Date.now = () => NOW * 1000;

		try {
			await trackActivity(env, ctx, user);
			await Promise.all(waitUntilPromises);

			// gap = 600 seconds = 10 minutes, should add 10 minutes
			// bind(now, addMinutes, userId, old_last_activity)
			expect(updateBind).toHaveBeenCalledWith(NOW, 10, 789, lastActivity);
		} finally {
			Date.now = originalNow;
		}
	});

	it("should not accumulate ol_time for activity gap > 30 minutes", async () => {
		const lastActivity = NOW - 3600; // 1 hour ago
		const { env, updateBind } = createMockEnv({
			throttleValue: null,
			userData: { last_activity: lastActivity, ol_time: 100 },
		});
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 111, role: 0 };

		const originalNow = Date.now;
		Date.now = () => NOW * 1000;

		try {
			await trackActivity(env, ctx, user);
			await Promise.all(waitUntilPromises);

			// gap > 30 minutes, should add 0 minutes (session break)
			// bind(now, addMinutes, userId, old_last_activity)
			expect(updateBind).toHaveBeenCalledWith(NOW, 0, 111, lastActivity);
		} finally {
			Date.now = originalNow;
		}
	});

	it("should not update if user not found", async () => {
		const { env, kvPut, dbRun, dbFirst, dbPrepare } = createMockEnv({
			throttleValue: null,
			userData: null, // User not found
		});
		const { ctx } = createMockCtx();
		const user = { userId: 999, role: 0 };

		const originalNow = Date.now;
		Date.now = () => NOW * 1000;

		try {
			await trackActivity(env, ctx, user);

			// Verify SELECT was called
			expect(dbPrepare).toHaveBeenCalled();
			expect(dbFirst).toHaveBeenCalled();

			// Should not call KV put or DB run (early return after user not found)
			expect(dbRun).not.toHaveBeenCalled();
		} finally {
			Date.now = originalNow;
		}
	});

	it("should not accumulate for gap < 60 seconds", async () => {
		const lastActivity = NOW - 30; // 30 seconds ago
		const { env, updateBind } = createMockEnv({
			throttleValue: null,
			userData: { last_activity: lastActivity, ol_time: 50 },
		});
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 222, role: 0 };

		const originalNow = Date.now;
		Date.now = () => NOW * 1000;

		try {
			await trackActivity(env, ctx, user);
			await Promise.all(waitUntilPromises);

			// gap = 30 seconds < 60, should add 0 minutes
			// bind(now, addMinutes, userId, old_last_activity)
			expect(updateBind).toHaveBeenCalledWith(NOW, 0, 222, lastActivity);
		} finally {
			Date.now = originalNow;
		}
	});

	it("should use optimistic locking to prevent concurrent overwrites", async () => {
		// This test verifies the SQL includes the WHERE clause for optimistic locking
		const lastActivity = NOW - 120; // 2 minutes ago
		const { env, dbPrepare, updateBind } = createMockEnv({
			throttleValue: null,
			userData: { last_activity: lastActivity, ol_time: 50 },
		});
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 333, role: 0 };

		const originalNow = Date.now;
		Date.now = () => NOW * 1000;

		try {
			await trackActivity(env, ctx, user);
			await Promise.all(waitUntilPromises);

			// Verify UPDATE SQL includes optimistic lock (WHERE last_activity = ?)
			const updateCall = dbPrepare.mock.calls.find(
				(call) => typeof call[0] === "string" && call[0].includes("UPDATE"),
			);
			expect(updateCall).toBeDefined();
			expect(updateCall![0]).toContain("AND last_activity = ?");

			// Verify bind includes old last_activity as 4th parameter
			expect(updateBind).toHaveBeenCalledWith(NOW, 2, 333, lastActivity);
		} finally {
			Date.now = originalNow;
		}
	});
});
