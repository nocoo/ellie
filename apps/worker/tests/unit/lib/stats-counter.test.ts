import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	incrementStatsOnPostCreate,
	incrementStatsOnThreadCreate,
	incrementStatsOnUserRegister,
} from "../../../src/lib/stats-counter";
import { readingFixture } from "./cache/thread-cache-fixture";

describe("stats-counter", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		f = readingFixture();
	});

	afterEach(() => {
		f.close();
		vi.restoreAllMocks();
	});

	describe("incrementStatsOnThreadCreate", () => {
		it("increments total_threads and total_posts with atomic single D1 UPDATE", async () => {
			// Initially 0 in settings
			await incrementStatsOnThreadCreate(f.env);

			const threads = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_threads'")
				.get() as { value: string };
			const posts = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_posts'")
				.get() as { value: string };

			expect(threads.value).toBe("1");
			expect(posts.value).toBe("1");

			// Single UPDATE query issued
			const updateCalls = f.calls.filter((c) =>
				c.sql.startsWith("UPDATE settings SET value = CAST(value AS INTEGER) + 1"),
			);
			expect(updateCalls).toHaveLength(1);
			expect(updateCalls[0].params.slice(1)).toEqual(["stats.total_threads", "stats.total_posts"]);

			// No per-create KV writes
			expect(f.env.KV.put).not.toHaveBeenCalled();
		});
	});

	describe("incrementStatsOnPostCreate", () => {
		it("increments total_posts with atomic single D1 UPDATE", async () => {
			await incrementStatsOnPostCreate(f.env);

			const posts = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_posts'")
				.get() as { value: string };
			expect(posts.value).toBe("1");

			const updateCalls = f.calls.filter((c) =>
				c.sql.startsWith("UPDATE settings SET value = CAST(value AS INTEGER) + 1"),
			);
			expect(updateCalls).toHaveLength(1);
			expect(updateCalls[0].params.slice(1)).toEqual(["stats.total_posts"]);

			// No per-create KV writes
			expect(f.env.KV.put).not.toHaveBeenCalled();
		});

		it("accumulates multiple increments accurately using SQL arithmetic", async () => {
			await incrementStatsOnPostCreate(f.env);
			await incrementStatsOnPostCreate(f.env);
			await incrementStatsOnPostCreate(f.env);

			const posts = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_posts'")
				.get() as { value: string };
			expect(posts.value).toBe("3");
		});
	});

	describe("incrementStatsOnUserRegister", () => {
		it("increments total_members with atomic single D1 UPDATE", async () => {
			await incrementStatsOnUserRegister(f.env);

			const members = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_members'")
				.get() as { value: string };
			expect(members.value).toBe("1");

			const updateCalls = f.calls.filter((c) =>
				c.sql.startsWith("UPDATE settings SET value = CAST(value AS INTEGER) + 1"),
			);
			expect(updateCalls).toHaveLength(1);
			expect(updateCalls[0].params.slice(1)).toEqual(["stats.total_members"]);

			// No per-create KV writes
			expect(f.env.KV.put).not.toHaveBeenCalled();
		});
	});
});
