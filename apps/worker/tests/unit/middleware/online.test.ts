import { describe, expect, it, mock, spyOn } from "bun:test";
import type { Env } from "../../../src/lib/env";
import { trackOnline, type OnlineUserData } from "../../../src/middleware/online";

describe("trackOnline", () => {
	const createMockEnv = () => {
		const kvPut = mock(() => Promise.resolve());
		return {
			env: {
				API_KEY: "test-api-key",
				ADMIN_API_KEY: "test-admin-api-key",
				DB: {} as D1Database,
				ENVIRONMENT: "test",
				JWT_SECRET: "test-secret",
				KV: {
					put: kvPut,
					get: mock(() => Promise.resolve(null)),
					list: mock(() => Promise.resolve({ keys: [], list_complete: true })),
					delete: mock(() => Promise.resolve()),
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

	it("should write online key with correct format", async () => {
		const { env, kvPut } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 123, role: 0 };
		const request = new Request("https://example.com/api/v1/forums", {
			headers: { "CF-Connecting-IP": "1.2.3.4" },
		});

		trackOnline(request, env, ctx, user);

		// Wait for all waitUntil promises
		await Promise.all(waitUntilPromises);

		expect(kvPut).toHaveBeenCalledTimes(1);
		const [key, value, options] = kvPut.mock.calls[0];
		expect(key).toBe("online:123");
		expect(options).toEqual({ expirationTtl: 900 });

		const data: OnlineUserData = JSON.parse(value as string);
		expect(data.uid).toBe(123);
		expect(data.ip).toBe("1.2.3.4");
		expect(data.page).toBe("/api/v1/forums");
		expect(data.ts).toBeGreaterThan(0);
	});

	it("should handle missing CF-Connecting-IP header", async () => {
		const { env, kvPut } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 456, role: 1 };
		const request = new Request("https://example.com/api/v1/threads/1");

		trackOnline(request, env, ctx, user);
		await Promise.all(waitUntilPromises);

		const [, value] = kvPut.mock.calls[0];
		const data: OnlineUserData = JSON.parse(value as string);
		expect(data.ip).toBe("");
		expect(data.page).toBe("/api/v1/threads/1");
	});

	it("should use waitUntil for non-blocking write", () => {
		const { env } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 789, role: 0 };
		const request = new Request("https://example.com/api/v1/posts");

		trackOnline(request, env, ctx, user);

		// Should have called waitUntil
		expect(waitUntilPromises.length).toBe(1);
	});

	it("should include timestamp in seconds", async () => {
		const { env, kvPut } = createMockEnv();
		const { ctx, waitUntilPromises } = createMockCtx();
		const user = { userId: 100, role: 0 };
		const request = new Request("https://example.com/api/v1/me");

		const before = Math.floor(Date.now() / 1000);
		trackOnline(request, env, ctx, user);
		await Promise.all(waitUntilPromises);
		const after = Math.floor(Date.now() / 1000);

		const [, value] = kvPut.mock.calls[0];
		const data: OnlineUserData = JSON.parse(value as string);
		expect(data.ts).toBeGreaterThanOrEqual(before);
		expect(data.ts).toBeLessThanOrEqual(after);
	});
});
