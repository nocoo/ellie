import { describe, expect, it } from "vitest";
import {
	batchDecrementUserPosts,
	decrementUserPosts,
	decrementUserThreads,
} from "../../../src/lib/userCounters";
import { createMockDb, makeEnv } from "../../helpers";

describe("userCounters", () => {
	describe("decrementUserThreads", () => {
		it("should decrement thread count with MAX(0, ...)", async () => {
			const { db, calls } = createMockDb({});
			const env = makeEnv({ DB: db });

			await decrementUserThreads(env, 42, 1);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET threads"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.sql).toContain("MAX(0, threads - ?)");
			expect(updateCall?.params).toEqual([1, 42]);
		});

		it("should support custom count", async () => {
			const { db, calls } = createMockDb({});
			const env = makeEnv({ DB: db });

			await decrementUserThreads(env, 10, 5);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET threads"));
			expect(updateCall?.params).toEqual([5, 10]);
		});
	});

	describe("decrementUserPosts", () => {
		it("should decrement post count with MAX(0, ...)", async () => {
			const { db, calls } = createMockDb({});
			const env = makeEnv({ DB: db });

			await decrementUserPosts(env, 42, 1);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET posts"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.sql).toContain("MAX(0, posts - ?)");
			expect(updateCall?.params).toEqual([1, 42]);
		});
	});

	describe("batchDecrementUserPosts", () => {
		it("should batch decrement for multiple users", async () => {
			const { db, batchCalls } = createMockDb({});
			const env = makeEnv({ DB: db });

			const authorCounts = new Map([
				[1, 3],
				[2, 5],
			]);

			await batchDecrementUserPosts(env, authorCounts);

			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(2);
		});

		it("should no-op for empty map", async () => {
			const { db, batchCalls } = createMockDb({});
			const env = makeEnv({ DB: db });

			await batchDecrementUserPosts(env, new Map());

			expect(batchCalls.length).toBe(0);
		});
	});
});
