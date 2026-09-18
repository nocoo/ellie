import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../src/lib/env";
import { aggregateOnlineStats } from "../../../src/lib/online-stats";

describe("aggregateOnlineStats", () => {
	const NOW = 1711900800; // Fixed timestamp for testing
	const _TODAY = "2024-03-31"; // Corresponding date

	const createMockEnv = (options?: {
		onlineKeys?: { name: string }[];
		existingPeak?: { count: number; date: string; timestamp: number } | null;
	}) => {
		const keys = options?.onlineKeys ?? [];
		const kvPut = vi.fn(() => Promise.resolve());
		const kvGet = vi.fn((key: string, type?: string) => {
			if (key === "stats:online_peak" && type === "json") {
				return Promise.resolve(options?.existingPeak ?? null);
			}
			return Promise.resolve(null);
		});
		const kvList = vi.fn(() =>
			Promise.resolve({
				keys,
				list_complete: true,
				cursor: undefined,
			}),
		);

		return {
			env: {
				API_KEY: "test-api-key",
				ADMIN_API_KEY: "test-admin-api-key",
				DB: {} as D1Database,
				ENVIRONMENT: "test",
				JWT_SECRET: "test-secret",
				KV: {
					get: kvGet,
					put: kvPut,
					list: kvList,
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
			} as Env,
			kvPut,
			kvGet,
			kvList,
		};
	};

	it("should count online users from KV list", async () => {
		const onlineKeys = [{ name: "online:1" }, { name: "online:2" }, { name: "online:3" }];
		const { env, kvList, kvPut } = createMockEnv({ onlineKeys });

		const originalNow = Date.now;
		Date.now = () => NOW * 1000;

		try {
			await aggregateOnlineStats(env);

			expect(kvList).toHaveBeenCalledWith({ prefix: "online:", cursor: undefined, limit: 1000 });
			// Should store count with 5 min TTL
			expect(kvPut).toHaveBeenCalledWith("stats:online_count", "3", { expirationTtl: 300 });
		} finally {
			Date.now = originalNow;
		}
	});

	it("does not read or write historical peak records", async () => {
		const { env, kvPut, kvGet } = createMockEnv({ onlineKeys: [{ name: "online:1" }] });
		await aggregateOnlineStats(env);
		expect(kvGet).not.toHaveBeenCalled();
		expect(kvPut).toHaveBeenCalledTimes(1);
		expect(kvPut).toHaveBeenCalledWith("stats:online_count", "1", { expirationTtl: 300 });
	});

	it("should handle zero online users", async () => {
		const { env, kvPut } = createMockEnv({ onlineKeys: [] });

		await aggregateOnlineStats(env);

		expect(kvPut).toHaveBeenCalledWith("stats:online_count", "0", { expirationTtl: 300 });
	});

	it("should paginate through large key sets", async () => {
		// Simulate pagination with multiple list calls
		let callCount = 0;
		const kvPut = vi.fn(() => Promise.resolve());
		const kvGet = vi.fn(() => Promise.resolve(null));
		const kvList = vi.fn(() => {
			callCount++;
			if (callCount === 1) {
				// First page: 1000 keys, more to come
				const keys = Array.from({ length: 1000 }, (_, i) => ({ name: `online:${i}` }));
				return Promise.resolve({
					keys,
					list_complete: false,
					cursor: "cursor1",
				});
			}
			// Second page: 500 keys, done
			const keys = Array.from({ length: 500 }, (_, i) => ({ name: `online:${1000 + i}` }));
			return Promise.resolve({
				keys,
				list_complete: true,
				cursor: undefined,
			});
		});

		const env = {
			API_KEY: "test-api-key",
			ADMIN_API_KEY: "test-admin-api-key",
			DB: {} as D1Database,
			ENVIRONMENT: "test",
			JWT_SECRET: "test-secret",
			KV: {
				get: kvGet,
				put: kvPut,
				list: kvList,
				delete: vi.fn(() => Promise.resolve()),
			} as unknown as KVNamespace,
		} as Env;

		await aggregateOnlineStats(env);

		// Should have called list twice (pagination)
		expect(kvList).toHaveBeenCalledTimes(2);
		// Total count should be 1500
		expect(kvPut).toHaveBeenCalledWith("stats:online_count", "1500", { expirationTtl: 300 });
	});
});
