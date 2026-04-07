import { describe, expect, it, mock } from "bun:test";
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
		const kvPut = mock(() => Promise.resolve());
		const kvGet = mock((key: string, type?: string) => {
			if (key === "stats:online_peak" && type === "json") {
				return Promise.resolve(options?.existingPeak ?? null);
			}
			return Promise.resolve(null);
		});
		const kvList = mock(() =>
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
					delete: mock(() => Promise.resolve()),
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

	it("should create new peak when none exists", async () => {
		const onlineKeys = [{ name: "online:1" }, { name: "online:2" }];
		const { env, kvPut, kvGet } = createMockEnv({ onlineKeys, existingPeak: null });

		const originalNow = Date.now;
		const originalDate = global.Date;
		Date.now = () => NOW * 1000;
		// Mock Date constructor for toISOString
		global.Date = class extends originalDate {
			constructor(...args: Parameters<DateConstructor>) {
				if (args.length === 0) {
					super(NOW * 1000);
				} else {
					// @ts-expect-error - spread args to super
					super(...args);
				}
			}
			static now() {
				return NOW * 1000;
			}
		} as typeof Date;

		try {
			await aggregateOnlineStats(env);

			expect(kvGet).toHaveBeenCalledWith("stats:online_peak", "json");
			// Should create new peak (no TTL)
			const putCalls = kvPut.mock.calls;
			const peakCall = putCalls.find((call) => call[0] === "stats:online_peak");
			expect(peakCall).toBeDefined();
			const peakData = JSON.parse(peakCall![1] as string);
			expect(peakData.count).toBe(2);
			expect(peakData.timestamp).toBe(NOW);
		} finally {
			Date.now = originalNow;
			global.Date = originalDate;
		}
	});

	it("should update peak when current count exceeds previous", async () => {
		const onlineKeys = [
			{ name: "online:1" },
			{ name: "online:2" },
			{ name: "online:3" },
			{ name: "online:4" },
			{ name: "online:5" },
		];
		const existingPeak = { count: 3, date: "2024-03-30", timestamp: NOW - 86400 };
		const { env, kvPut } = createMockEnv({ onlineKeys, existingPeak });

		const originalNow = Date.now;
		const originalDate = global.Date;
		Date.now = () => NOW * 1000;
		global.Date = class extends originalDate {
			constructor(...args: Parameters<DateConstructor>) {
				if (args.length === 0) {
					super(NOW * 1000);
				} else {
					// @ts-expect-error - spread args to super
					super(...args);
				}
			}
			static now() {
				return NOW * 1000;
			}
		} as typeof Date;

		try {
			await aggregateOnlineStats(env);

			const putCalls = kvPut.mock.calls;
			const peakCall = putCalls.find((call) => call[0] === "stats:online_peak");
			expect(peakCall).toBeDefined();
			const peakData = JSON.parse(peakCall![1] as string);
			expect(peakData.count).toBe(5);
		} finally {
			Date.now = originalNow;
			global.Date = originalDate;
		}
	});

	it("should NOT update peak when current count is lower", async () => {
		const onlineKeys = [{ name: "online:1" }, { name: "online:2" }];
		const existingPeak = { count: 10, date: "2024-03-30", timestamp: NOW - 86400 };
		const { env, kvPut } = createMockEnv({ onlineKeys, existingPeak });

		await aggregateOnlineStats(env);

		const putCalls = kvPut.mock.calls;
		// Should only have online_count put, not peak update
		expect(putCalls.length).toBe(1);
		expect(putCalls[0][0]).toBe("stats:online_count");
	});

	it("should handle zero online users", async () => {
		const { env, kvPut } = createMockEnv({ onlineKeys: [] });

		await aggregateOnlineStats(env);

		expect(kvPut).toHaveBeenCalledWith("stats:online_count", "0", { expirationTtl: 300 });
	});

	it("should paginate through large key sets", async () => {
		// Simulate pagination with multiple list calls
		let callCount = 0;
		const kvPut = mock(() => Promise.resolve());
		const kvGet = mock(() => Promise.resolve(null));
		const kvList = mock(() => {
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
				delete: mock(() => Promise.resolve()),
			} as unknown as KVNamespace,
		} as Env;

		await aggregateOnlineStats(env);

		// Should have called list twice (pagination)
		expect(kvList).toHaveBeenCalledTimes(2);
		// Total count should be 1500
		expect(kvPut).toHaveBeenCalledWith("stats:online_count", "1500", { expirationTtl: 300 });
	});
});
