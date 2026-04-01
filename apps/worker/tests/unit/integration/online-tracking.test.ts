import { describe, expect, it, mock } from "bun:test";

/**
 * Integration tests for online tracking middleware.
 *
 * NOTE: These tests require the full monorepo environment to run because
 * they import the worker module which depends on @ellie/types.
 * Run from repo root: `bun test apps/worker/tests/unit/integration/online-tracking.test.ts`
 *
 * The core tracking logic is covered by unit tests:
 * - tests/unit/middleware/online.test.ts (4 tests)
 * - tests/unit/middleware/activity.test.ts (7 tests)
 * - tests/unit/lib/online-stats.test.ts (6 tests)
 */

// Skip full integration tests in isolated worktree environments
// These tests pass when run from the monorepo root with all dependencies installed
const canRunIntegration = (() => {
	try {
		// Try to resolve @ellie/types — if it fails, we're in an isolated environment
		require.resolve("@ellie/types");
		return true;
	} catch {
		return false;
	}
})();

describe.skipIf(!canRunIntegration)("online tracking integration", () => {
	// Dynamic import to avoid parse-time errors in isolated environments
	const getWorker = async () => (await import("../../../src/index")).default;
	const getSignJwt = async () => (await import("../../../src/lib/jwt")).signJwt;

	const TEST_API_KEY = "test-api-key";
	const JWT_SECRET = "test-secret";

	/** Create a mock ExecutionContext that captures waitUntil promises */
	const makeCtx = () => {
		const waitUntilPromises: Promise<unknown>[] = [];
		return {
			ctx: {
				waitUntil: (p: Promise<unknown>) => {
					waitUntilPromises.push(p);
				},
				passThroughOnException: mock(() => {}),
			} as ExecutionContext,
			waitUntilPromises,
		};
	};

	/** Create mock env with KV tracking */
	const makeEnv = (options?: { kvGet?: ReturnType<typeof mock> }) => {
		const kvPut = mock(() => Promise.resolve());
		const kvGet =
			options?.kvGet ??
			mock((key: string) => {
				// Return null for throttle check (allow tracking)
				if (key.startsWith("activity_throttle:")) return Promise.resolve(null);
				return Promise.resolve(null);
			});

		return {
			env: {
				API_KEY: TEST_API_KEY,
				ADMIN_API_KEY: "test-admin-api-key",
				DB: {
					prepare: mock((sql: string) => {
						// Handle SELECT for activity tracking
						if (sql.includes("SELECT last_activity")) {
							return {
								bind: mock(() => ({
									first: mock(() =>
										Promise.resolve({ last_activity: Math.floor(Date.now() / 1000) - 120, ol_time: 10 }),
									),
								})),
							};
						}
						// Handle UPDATE for activity tracking
						if (sql.includes("UPDATE users SET last_activity")) {
							return {
								bind: mock(() => ({
									run: mock(() => Promise.resolve({ success: true })),
								})),
							};
						}
						// Default: return empty results
						return {
							bind: mock(() => ({
								first: mock(() => Promise.resolve(null)),
								all: mock(() => Promise.resolve({ results: [] })),
								run: mock(() => Promise.resolve()),
							})),
							all: mock(() => Promise.resolve({ results: [] })),
							first: mock(() => Promise.resolve(null)),
						};
					}),
					batch: mock(() =>
						Promise.resolve([
							{ results: [{ cnt: 0 }] },
							{ results: [{ cnt: 0 }] },
							{ results: [{ cnt: 0 }] },
							{ results: [{ cnt: 0 }] },
							{ results: [] },
						]),
					),
				} as unknown as D1Database,
				ENVIRONMENT: "test",
				JWT_SECRET,
				KV: {
					get: kvGet,
					put: kvPut,
				} as unknown as KVNamespace,
			},
			kvPut,
			kvGet,
		};
	};

	const makeRequest = (url: string, init?: RequestInit) => new Request(url, init);

	/** Create a valid JWT for testing */
	async function createTestJwt(userId: number, role: number) {
		const signJwt = await getSignJwt();
		const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
		return signJwt({ userId, role, exp }, JWT_SECRET);
	}

	it("should trigger online tracking for authenticated requests", async () => {
		const worker = await getWorker();
		const { env, kvPut } = makeEnv();
		const { ctx, waitUntilPromises } = makeCtx();

		const token = await createTestJwt(123, 0);
		const request = makeRequest("https://api.example.com/api/v1/forums", {
			headers: {
				"X-API-Key": TEST_API_KEY,
				Authorization: `Bearer ${token}`,
			},
		});

		await worker.fetch(request, env, ctx);
		await Promise.all(waitUntilPromises);

		// Should have written online:{userId} key
		const onlinePutCall = kvPut.mock.calls.find(
			(call) => typeof call[0] === "string" && call[0].startsWith("online:"),
		);
		expect(onlinePutCall).toBeDefined();
		expect(onlinePutCall?.[0]).toBe("online:123");
	});

	it("should trigger activity tracking for authenticated requests", async () => {
		const worker = await getWorker();
		const { env, kvPut } = makeEnv();
		const { ctx, waitUntilPromises } = makeCtx();

		const token = await createTestJwt(456, 0);
		const request = makeRequest("https://api.example.com/api/v1/forums", {
			headers: {
				"X-API-Key": TEST_API_KEY,
				Authorization: `Bearer ${token}`,
			},
		});

		await worker.fetch(request, env, ctx);
		await Promise.all(waitUntilPromises);

		// Should have written activity_throttle:{userId} key
		const throttlePutCall = kvPut.mock.calls.find(
			(call) => typeof call[0] === "string" && call[0].startsWith("activity_throttle:"),
		);
		expect(throttlePutCall).toBeDefined();
		expect(throttlePutCall?.[0]).toBe("activity_throttle:456");
	});

	it("should NOT trigger tracking for unauthenticated requests", async () => {
		const worker = await getWorker();
		const { env, kvPut } = makeEnv();
		const { ctx, waitUntilPromises } = makeCtx();

		const request = makeRequest("https://api.example.com/api/v1/forums", {
			headers: {
				"X-API-Key": TEST_API_KEY,
				// No Authorization header
			},
		});

		await worker.fetch(request, env, ctx);
		await Promise.all(waitUntilPromises);

		// Should NOT have written any online: or activity_throttle: keys
		const trackingCalls = kvPut.mock.calls.filter(
			(call) =>
				typeof call[0] === "string" &&
				(call[0].startsWith("online:") || call[0].startsWith("activity_throttle:")),
		);
		expect(trackingCalls.length).toBe(0);
	});

	it("should NOT trigger tracking for invalid tokens", async () => {
		const worker = await getWorker();
		const { env, kvPut } = makeEnv();
		const { ctx, waitUntilPromises } = makeCtx();

		const request = makeRequest("https://api.example.com/api/v1/forums", {
			headers: {
				"X-API-Key": TEST_API_KEY,
				Authorization: "Bearer invalid-token",
			},
		});

		await worker.fetch(request, env, ctx);
		await Promise.all(waitUntilPromises);

		// Should NOT have written any tracking keys
		const trackingCalls = kvPut.mock.calls.filter(
			(call) =>
				typeof call[0] === "string" &&
				(call[0].startsWith("online:") || call[0].startsWith("activity_throttle:")),
		);
		expect(trackingCalls.length).toBe(0);
	});

	it("should include correct data in online KV entry", async () => {
		const worker = await getWorker();
		const { env, kvPut } = makeEnv();
		const { ctx, waitUntilPromises } = makeCtx();

		const token = await createTestJwt(789, 0);
		const request = makeRequest("https://api.example.com/api/v1/threads?forumId=1", {
			headers: {
				"X-API-Key": TEST_API_KEY,
				Authorization: `Bearer ${token}`,
				"CF-Connecting-IP": "192.168.1.1",
			},
		});

		await worker.fetch(request, env, ctx);
		await Promise.all(waitUntilPromises);

		const onlinePutCall = kvPut.mock.calls.find(
			(call) => typeof call[0] === "string" && call[0].startsWith("online:"),
		);
		expect(onlinePutCall).toBeDefined();

		const data = JSON.parse(onlinePutCall?.[1] as string);
		expect(data.uid).toBe(789);
		expect(data.ip).toBe("192.168.1.1");
		expect(data.page).toBe("/api/v1/threads");
		expect(data.ts).toBeGreaterThan(0);

		// TTL should be 900 seconds (15 minutes)
		expect(onlinePutCall?.[2]).toEqual({ expirationTtl: 900 });
	});
});
