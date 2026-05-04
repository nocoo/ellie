import { describe, expect, it, vi } from "vitest";

// Mock forum-cache module to control tree + volatile data
vi.mock("../../../src/lib/forum-cache", () => ({
	isForumCacheEnabled: vi.fn(() => true),
	getForumTree: vi.fn(async () => [
		{
			id: 1,
			parentId: 0,
			name: "General",
			description: "General discussion",
			icon: "",
			displayOrder: 1,
			status: 1,
			visibility: "public",
			type: "forum",
			moderators: "",
			moderatorIds: "",
			moderatorList: [],
		},
	]),
	getForumVolatile: vi.fn(async () => ({
		1: {
			lastThreadId: 50,
			lastThreadSubject: "Hello",
			lastPostAt: 1700000000,
			lastPosterId: 10,
			lastPoster: "alice",
			todayThreads: 2,
			threads: 30,
			posts: 300,
		},
	})),
}));

// Mock user-cache module
vi.mock("../../../src/lib/user-cache", () => ({
	getUserProfiles: vi.fn(async () => new Map()),
}));

import { list } from "../../../src/handlers/forum";
import type { Env } from "../../../src/lib/env";
import { createMockCtx, createMockKV } from "../../helpers";

describe("forum list — KV forum cache ON + user cache OFF (avatar fallback)", () => {
	it("fetches avatars via batch SQL when user cache is disabled", async () => {
		const prepareSpy = vi.fn((sql: string) => {
			// Avatar fallback query
			if (sql.includes("SELECT id, avatar, avatar_path FROM users")) {
				return {
					bind: vi.fn(() => ({
						all: vi.fn(() =>
							Promise.resolve({
								results: [{ id: 10, avatar: "alice.png", avatar_path: "avatars/alice.jpg" }],
							}),
						),
					})),
				};
			}
			return {
				bind: vi.fn(() => ({
					all: vi.fn(() => Promise.resolve({ results: [] })),
				})),
			};
		});

		const env: Env = {
			API_KEY: "test-api-key",
			ADMIN_API_KEY: "test-admin-api-key",
			DB: { prepare: prepareSpy } as unknown as D1Database,
			ENVIRONMENT: "test",
			JWT_SECRET: "test-secret",
			KV: createMockKV(),
			USE_KV_FORUM_CACHE: "true",
			USE_KV_USER_CACHE: "false",
		};
		const ctx = createMockCtx();

		const response = await list(new Request("https://example.com/api/v1/forums"), env, ctx);

		expect(response.status).toBe(200);
		const data = await response.json();

		// Should have avatar data from SQL fallback
		expect(data.data[0].lastPosterAvatar).toBe("alice.png");
		expect(data.data[0].lastPosterAvatarPath).toBe("avatars/alice.jpg");

		// Verify the avatar SQL query was made
		expect(prepareSpy).toHaveBeenCalledWith(
			expect.stringContaining("SELECT id, avatar, avatar_path FROM users"),
		);
	});

	it("returns empty avatar when lastPosterId is 0 (no SQL query needed)", async () => {
		// Override getForumVolatile for this test to return lastPosterId: 0
		const { getForumVolatile } = await import("../../../src/lib/forum-cache");
		(getForumVolatile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			1: {
				lastThreadId: 0,
				lastThreadSubject: "",
				lastPostAt: 0,
				lastPosterId: 0,
				lastPoster: "",
				todayThreads: 0,
				threads: 0,
				posts: 0,
			},
		});

		const prepareSpy = vi.fn(() => ({
			bind: vi.fn(() => ({
				all: vi.fn(() => Promise.resolve({ results: [] })),
			})),
		}));

		const env: Env = {
			API_KEY: "test-api-key",
			ADMIN_API_KEY: "test-admin-api-key",
			DB: { prepare: prepareSpy } as unknown as D1Database,
			ENVIRONMENT: "test",
			JWT_SECRET: "test-secret",
			KV: createMockKV(),
			USE_KV_FORUM_CACHE: "true",
			USE_KV_USER_CACHE: "false",
		};
		const ctx = createMockCtx();

		const response = await list(new Request("https://example.com/api/v1/forums"), env, ctx);

		expect(response.status).toBe(200);
		const data = await response.json();

		// No poster → empty avatar, no SQL query
		expect(data.data[0].lastPosterAvatar).toBe("");
		expect(data.data[0].lastPosterAvatarPath).toBe("");
		// Should NOT query users table for avatars
		expect(prepareSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("SELECT id, avatar, avatar_path FROM users"),
		);
	});
});
