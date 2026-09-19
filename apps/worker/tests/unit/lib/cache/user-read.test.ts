import { type CacheDescriptor, getCheckinLevel } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAvatarPathCached,
	getPublicUsers,
	getUserHistory,
	getUserSearchCached,
	isHistoryCursor,
	isUserCacheData,
	loadAvatarPathFromDb,
	loadUserHistory,
	loadUserPublicFromDb,
	loadUserSearchFromDb,
	loadUserStatsFromDb,
	rebuildUserCache,
	userCacheKey,
	userHistoryScope,
	validateUserCacheDescriptor,
} from "../../../../src/lib/cache/user-read";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

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

describe("lib/cache/user-read — descriptor validation & key generation", () => {
	it("validates user:public:v2 descriptor and scope", async () => {
		const validPublic: CacheDescriptor = {
			family: "user:public:v2",
			scope: "public",
			params: { id: 10, viewerBucket: "public" },
		};
		validateUserCacheDescriptor(validPublic);
		expect(await userCacheKey(f.env, validPublic)).toBe("user:public:v2:10:public");

		const validStaff: CacheDescriptor = {
			family: "user:public:v2",
			scope: "staff",
			params: { id: 10, viewerBucket: "staff" },
		};
		validateUserCacheDescriptor(validStaff);
		expect(await userCacheKey(f.env, validStaff)).toBe("user:public:v2:10:staff");

		// Scope mismatch with viewerBucket
		expect(() =>
			validateUserCacheDescriptor({
				family: "user:public:v2",
				scope: "public",
				params: { id: 10, viewerBucket: "staff" },
			}),
		).toThrow("Invalid profile audience");

		// Non-positive ID
		expect(() =>
			validateUserCacheDescriptor({
				family: "user:public:v2",
				scope: "public",
				params: { id: 0, viewerBucket: "public" },
			}),
		).toThrow("Invalid user ID");

		// Unknown dimension
		expect(() =>
			validateUserCacheDescriptor({
				family: "user:public:v2",
				scope: "public",
				params: { id: 10, viewerBucket: "public", extra: 1 },
			}),
		).toThrow("Invalid user cache dimensions");
	});

	it("validates user:stats and user:avatar-path exact keys and public scope", async () => {
		const statsDesc: CacheDescriptor = {
			family: "user:stats",
			scope: "public",
			params: { id: 10 },
		};
		validateUserCacheDescriptor(statsDesc);
		expect(await userCacheKey(f.env, statsDesc)).toBe("user:stats:10");

		const avatarDesc: CacheDescriptor = {
			family: "user:avatar-path",
			scope: "public",
			params: { id: 10 },
		};
		validateUserCacheDescriptor(avatarDesc);
		expect(await userCacheKey(f.env, avatarDesc)).toBe("user:avatar-path:10");

		// Reject non-public scope
		expect(() =>
			validateUserCacheDescriptor({
				family: "user:stats",
				scope: "staff",
				params: { id: 10 },
			}),
		).toThrow("Invalid profile audience");
	});

	it("validates user:search dimensions, scope, normalization, and bounds", async () => {
		const validSearch: CacheDescriptor = {
			family: "user:search",
			scope: "public",
			params: { q: "alice", limit: 10 },
		};
		validateUserCacheDescriptor(validSearch);
		const key = await userCacheKey(f.env, validSearch);
		expect(key).toContain("cache:v3:user:search:");

		// Query too short (< 2)
		expect(() =>
			validateUserCacheDescriptor({
				family: "user:search",
				scope: "public",
				params: { q: "a", limit: 10 },
			}),
		).toThrow("Invalid user search");

		// Untrimmed query
		expect(() =>
			validateUserCacheDescriptor({
				family: "user:search",
				scope: "public",
				params: { q: " alice ", limit: 10 },
			}),
		).toThrow("Invalid user search");

		// Limit > 20
		expect(() =>
			validateUserCacheDescriptor({
				family: "user:search",
				scope: "public",
				params: { q: "alice", limit: 50 },
			}),
		).toThrow("Invalid user search");

		// Very long query marks key as !unavailable
		const longQDesc: CacheDescriptor = {
			family: "user:search",
			scope: "public",
			params: { q: "a".repeat(300), limit: 10 },
		};
		expect(await userCacheKey(f.env, longQDesc)).toContain(":!unavailable");
	});

	it("validates user history descriptor, viewer scopes, and cursor shapes", async () => {
		expect(userHistoryScope(null, 10)).toBe("anon");
		expect(userHistoryScope({ role: 0, userId: 10 }, 10)).toBe("role_0_uid_self");
		expect(userHistoryScope({ role: 3, userId: 30 }, 10)).toBe("role_3_uid_other");

		const validHist: CacheDescriptor = {
			family: "user:threads",
			scope: "role_0_uid_self",
			params: { userId: 10, limit: 20, cursorTime: null, cursorId: null },
		};
		validateUserCacheDescriptor(validHist);

		// Incomplete cursor
		expect(() =>
			validateUserCacheDescriptor({
				...validHist,
				params: { ...validHist.params, cursorId: 5, cursorTime: 100 },
			}),
		).not.toThrow();

		expect(() =>
			validateUserCacheDescriptor({
				...validHist,
				params: { ...validHist.params, cursorId: null, cursorTime: 100 },
			}),
		).toThrow("Incomplete history cursor");

		// Negative cursor timestamp
		expect(() =>
			validateUserCacheDescriptor({
				...validHist,
				params: { ...validHist.params, cursorId: 5, cursorTime: -1 },
			}),
		).toThrow("Invalid history cursor");

		// Invalid audience scope syntax
		expect(() =>
			validateUserCacheDescriptor({
				...validHist,
				scope: "invalid_audience",
			}),
		).toThrow("Invalid history audience");
	});

	it("checks isHistoryCursor discriminator", () => {
		expect(isHistoryCursor({ id: 1, createdAt: 100 })).toBe(true);
		expect(isHistoryCursor({ id: 0, createdAt: 100 })).toBe(false);
		expect(isHistoryCursor({ id: 1, createdAt: -1 })).toBe(false);
	});
});

describe("lib/cache/user-read — isUserCacheData validator branch table", () => {
	it("validates null negative cache entries only for allowed families", () => {
		expect(
			isUserCacheData(
				{ family: "user:public:v2", scope: "public", params: { id: 10, viewerBucket: "public" } },
				null,
			),
		).toBe(true);
		expect(
			isUserCacheData({ family: "user:stats", scope: "public", params: { id: 10 } }, null),
		).toBe(true);
		expect(
			isUserCacheData({ family: "user:avatar-path", scope: "public", params: { id: 10 } }, null),
		).toBe(true);
		expect(
			isUserCacheData(
				{ family: "user:search", scope: "public", params: { q: "test", limit: 10 } },
				null,
			),
		).toBe(false);
		expect(
			isUserCacheData(
				{
					family: "user:threads",
					scope: "anon",
					params: { userId: 10, limit: 20, cursorTime: null, cursorId: null },
				},
				null,
			),
		).toBe(false);
	});

	it("validates user:search cached data array and bounds", () => {
		const searchDesc: CacheDescriptor = {
			family: "user:search",
			scope: "public",
			params: { q: "test", limit: 2 },
		};
		expect(
			isUserCacheData(searchDesc, [
				{ id: 1, username: "alice" },
				{ id: 2, username: "bob" },
			]),
		).toBe(true);
		// Over limit
		expect(
			isUserCacheData(searchDesc, [
				{ id: 1, username: "a" },
				{ id: 2, username: "b" },
				{ id: 3, username: "c" },
			]),
		).toBe(false);
		// Unknown dimensions in items
		expect(isUserCacheData(searchDesc, [{ id: 1, username: "a", extra: 1 }])).toBe(false);
		// Non-positive id
		expect(isUserCacheData(searchDesc, [{ id: 0, username: "a" }])).toBe(false);
		// Non-array
		expect(isUserCacheData(searchDesc, { items: [] })).toBe(false);
	});

	it("validates user:public:v2 stable fields and staff/public whitelist", () => {
		const publicDesc: CacheDescriptor = {
			family: "user:public:v2",
			scope: "public",
			params: { id: 10, viewerBucket: "public" },
		};
		const staffDesc: CacheDescriptor = {
			family: "user:public:v2",
			scope: "staff",
			params: { id: 10, viewerBucket: "staff" },
		};

		const samplePublic = {
			id: 10,
			username: "alice",
			avatar: "alice.png",
			avatarPath: "alice.jpg",
			role: 0,
			regDate: 100,
			signature: "",
			groupTitle: "Member",
			groupStars: 0,
			groupColor: "",
			customTitle: "",
			gender: 0,
			birthYear: 0,
			birthMonth: 0,
			birthDay: 0,
			resideProvince: "",
			resideCity: "",
			graduateSchool: "",
			bio: "",
			interest: "",
			qq: "",
			site: "",
			campus: "",
		};

		expect(isUserCacheData(publicDesc, samplePublic)).toBe(true);

		// ID poisoning / mismatch
		expect(isUserCacheData(publicDesc, { ...samplePublic, id: 20 })).toBe(false);

		// Public cache with leaked staff IP columns fails validation
		expect(
			isUserCacheData(publicDesc, { ...samplePublic, regIp: "1.2.3.4", lastIp: "1.2.3.4" }),
		).toBe(false);

		// Staff cache allows regIp and lastIp
		expect(
			isUserCacheData(staffDesc, { ...samplePublic, regIp: "1.2.3.4", lastIp: "1.2.3.4" }),
		).toBe(true);
	});

	it("validates user:stats payload and checkin levels", () => {
		const statsDesc: CacheDescriptor = {
			family: "user:stats",
			scope: "public",
			params: { id: 10 },
		};
		const validStats = {
			threads: 5,
			posts: 10,
			credits: 100,
			coins: 50,
			digestPosts: 1,
			olTime: 20,
			lastActivity: 1700000000,
			checkin: null,
		};
		expect(isUserCacheData(statsDesc, validStats)).toBe(true);

		// Missing required field
		const { posts: _, ...missingField } = validStats;
		expect(isUserCacheData(statsDesc, missingField)).toBe(false);

		// Checkin populated with matching level
		const totalDays = 10;
		const withCheckin = {
			...validStats,
			checkin: {
				totalDays,
				monthDays: 5,
				streakDays: 3,
				lastCheckinAt: 1700000000,
				level: getCheckinLevel(totalDays),
			},
		};
		expect(isUserCacheData(statsDesc, withCheckin)).toBe(true);

		// Checkin with corrupted level
		const corruptCheckin = {
			...validStats,
			checkin: {
				...withCheckin.checkin,
				level: { current: 99, name: "Lv.99", nextDays: 0, currentLevelDays: 0, nextLevelDays: 0 },
			},
		};
		expect(isUserCacheData(statsDesc, corruptCheckin)).toBe(false);
	});

	it("validates user:avatar-path exact payload", () => {
		const avatarDesc: CacheDescriptor = {
			family: "user:avatar-path",
			scope: "public",
			params: { id: 10 },
		};
		expect(isUserCacheData(avatarDesc, { avatarPath: "path/to/avatar.jpg" })).toBe(true);
		expect(isUserCacheData(avatarDesc, { avatarPath: "path", extra: 1 })).toBe(false);
		expect(isUserCacheData(avatarDesc, { avatarPath: 123 })).toBe(false);
	});

	it("validates user history payload structure and post vs thread requirements", () => {
		const threadHistDesc: CacheDescriptor = {
			family: "user:threads",
			scope: "anon",
			params: { userId: 10, limit: 10, cursorTime: null, cursorId: null },
		};
		const postHistDesc: CacheDescriptor = {
			family: "user:posts",
			scope: "anon",
			params: { userId: 10, limit: 10, cursorTime: null, cursorId: null },
		};

		expect(
			isUserCacheData(threadHistDesc, { items: [{ id: 1, createdAt: 100 }], nextCursor: null }),
		).toBe(true);
		// user:posts items must have threadId
		expect(
			isUserCacheData(postHistDesc, { items: [{ id: 1, createdAt: 100 }], nextCursor: null }),
		).toBe(false);
		expect(
			isUserCacheData(postHistDesc, {
				items: [{ id: 1, createdAt: 100, threadId: 10 }],
				nextCursor: null,
			}),
		).toBe(true);
	});
});

describe("lib/cache/user-read — rebuildUserCache pure queries & safety", () => {
	it("rebuildUserCache loads stable profile without leaking email or password", async () => {
		f.sqlite
			.prepare(
				"UPDATE users SET email = 'secret@example.com', password_hash = 'hash123' WHERE id = 10",
			)
			.run();

		const profile = (await rebuildUserCache(f.env, undefined, {
			family: "user:public:v2",
			scope: "public",
			params: { id: 10, viewerBucket: "public" },
		})) as Record<string, unknown>;

		expect(profile).toBeDefined();
		expect(profile.id).toBe(10);
		expect(profile.username).toBe("alice");
		expect(profile.email).toBeUndefined();
		expect(profile.password_hash).toBeUndefined();
		expect(profile.regIp).toBeUndefined();
	});

	it("staff profile includes reg_ip and last_ip", async () => {
		f.sqlite
			.prepare("UPDATE users SET reg_ip = '10.0.0.1', last_ip = '10.0.0.2' WHERE id = 10")
			.run();

		const profile = (await rebuildUserCache(f.env, undefined, {
			family: "user:public:v2",
			scope: "staff",
			params: { id: 10, viewerBucket: "staff" },
		})) as Record<string, unknown>;

		expect(profile.regIp).toBe("10.0.0.1");
		expect(profile.lastIp).toBe("10.0.0.2");
	});

	it("rebuilds user stats from users table and user_checkins", async () => {
		f.sqlite
			.prepare(
				"UPDATE users SET threads = 3, posts = 7, credits = 50, coins = 20, digest_posts = 1, ol_time = 15, last_activity = 1700000000 WHERE id = 10",
			)
			.run();
		f.sqlite
			.prepare(
				"INSERT INTO user_checkins (user_id, total_days, month_days, streak_days, last_checkin_at) VALUES (10, 5, 5, 2, 1700000000)",
			)
			.run();

		const stats = (await rebuildUserCache(f.env, undefined, {
			family: "user:stats",
			scope: "public",
			params: { id: 10 },
		})) as Record<string, unknown>;

		expect(stats.threads).toBe(3);
		expect(stats.posts).toBe(7);
		expect(stats.credits).toBe(50);
		expect(stats.coins).toBe(20);
		expect(stats.digestPosts).toBe(1);
		expect(stats.checkin).toMatchObject({
			totalDays: 5,
			monthDays: 5,
			streakDays: 2,
		});
	});

	it("rebuilds avatar path", async () => {
		const avatar = (await rebuildUserCache(f.env, undefined, {
			family: "user:avatar-path",
			scope: "public",
			params: { id: 10 },
		})) as { avatarPath: string };
		expect(avatar.avatarPath).toBe("alice.jpg");
	});

	it("returns null for non-existent user on single profile/stats/avatar loads", async () => {
		expect(await loadUserPublicFromDb(f.env, 99999, false)).toBeNull();
		expect(await loadUserStatsFromDb(f.env, 99999)).toBeNull();
		expect(await loadAvatarPathFromDb(f.env, 99999)).toBeNull();
	});
});

describe("lib/cache/user-read — getPublicUsers 500 IDs, chunking, and hot hits", () => {
	it("handles 500 IDs in chunks of 80/100 without exceeding SQL bindings", async () => {
		// Populate 500 users (id 1001 to 1500)
		for (let id = 1001; id <= 1500; id++) {
			f.insert("users", {
				id,
				username: `user_${id}`,
				email_verified_at: 1,
				role: 0,
				avatar_path: `avatar_${id}.jpg`,
				threads: 1,
				posts: 2,
			});
		}

		const ids = Array.from({ length: 500 }, (_, i) => 1001 + i);
		f.calls.length = 0;

		const users = await getPublicUsers(f.env, f.ctx, ids, "public");
		expect(users.size).toBe(500);
		expect(users.get(1001)?.username).toBe("user_1001");
		expect(users.get(1500)?.username).toBe("user_1500");

		// D1 SQL bindings check: max params in any query <= 100
		const maxParams = Math.max(...f.calls.map((c) => c.params.length));
		expect(maxParams).toBeLessThanOrEqual(100);

		// userRows chunks by 80; for 500 IDs that's ceil(500/80) = 7 chunks for stable and 7 for stats
		const selectUsersCalls = f.calls.filter((c) => c.sql.includes("FROM users u"));
		expect(selectUsersCalls.length).toBe(14);
	});

	it("serves hot hits without D1 queries and queries only missing IDs on partial misses", async () => {
		// Preload user 10
		const initial = await getPublicUsers(f.env, f.ctx, [10], "public");
		expect(initial.get(10)?.username).toBe("alice");

		f.calls.length = 0;

		// Hot hit: zero D1 queries
		const hot = await getPublicUsers(f.env, f.ctx, [10], "public");
		expect(hot.get(10)?.username).toBe("alice");
		expect(f.calls).toHaveLength(0);

		// Partial miss: request [10, 20] -> only 20 is queried from D1
		const partial = await getPublicUsers(f.env, f.ctx, [10, 20], "public");
		expect(partial.size).toBe(2);
		expect(partial.get(10)?.username).toBe("alice");
		expect(partial.get(20)?.username).toBe("bob");

		const d1Calls = f.calls.filter((c) => c.sql.includes("FROM users u"));
		// Exactly 2 calls (1 for stable, 1 for stats) querying ID 20 only
		expect(d1Calls.length).toBe(2);
		expect(d1Calls[0].params).toEqual([20]);
		expect(d1Calls[1].params).toEqual([20]);
	});
});

describe("lib/cache/user-read — history and search caching", () => {
	it("filters anonymous content in user history based on viewer authorization", async () => {
		f.thread(101, { author_id: 10, anonymous_author: 1, subject: "Anon Thread" });
		f.thread(102, { author_id: 10, anonymous_author: 0, subject: "Public Thread" });

		// Other regular viewer (cannot unmask)
		const otherDesc: CacheDescriptor = {
			family: "user:threads",
			scope: "role_0_uid_other",
			params: { userId: 10, limit: 10, cursorTime: null, cursorId: null },
		};
		const otherList = await getUserHistory(f.env, f.ctx, otherDesc);
		expect(otherList.items).toHaveLength(1);
		expect(otherList.items[0].id).toBe(102);

		// Self viewer (author sees own anonymous threads)
		const selfDesc: CacheDescriptor = {
			family: "user:threads",
			scope: "role_0_uid_self",
			params: { userId: 10, limit: 10, cursorTime: null, cursorId: null },
		};
		const selfList = await getUserHistory(f.env, f.ctx, selfDesc);
		expect(selfList.items).toHaveLength(2);
	});

	it("user search normalizes case and caches with HOUR tier", async () => {
		f.insert("users", { id: 301, username: "Charlie", email_verified_at: 1, role: 0 });

		const res1 = await getUserSearchCached(f.env, f.ctx, "Cha", 5);
		expect(res1).toHaveLength(1);
		expect(res1[0].username).toBe("Charlie");

		const callsBefore = f.calls.length;
		// Uppercase query normalizes to lowercase cache key
		const res2 = await getUserSearchCached(f.env, f.ctx, "CHA", 5);
		expect(res2).toEqual(res1);
		// Served from cache
		expect(f.calls.length).toBe(callsBefore);
	});

	it("cached avatar path returns null for missing users and caches result", async () => {
		const res = await getAvatarPathCached(f.env, f.ctx, 10);
		expect(res?.avatarPath).toBe("alice.jpg");

		const missing = await getAvatarPathCached(f.env, f.ctx, 9999);
		expect(missing).toBeNull();

		const callsBefore = f.calls.length;
		const missingCached = await getAvatarPathCached(f.env, f.ctx, 9999);
		expect(missingCached).toBeNull();
		expect(f.calls.length).toBe(callsBefore);
	});
});

describe("lib/cache/user-read — fault tolerance & errors", () => {
	it("throws when D1 user rows query fails (!result.success)", async () => {
		f.state.queryError = true;
		await expect(loadUserPublicFromDb(f.env, 10, false)).rejects.toThrow(
			"User rows could not be loaded",
		);
		await expect(loadUserStatsFromDb(f.env, 10)).rejects.toThrow("User rows could not be loaded");
		await expect(
			loadUserHistory(f.env, {
				family: "user:threads",
				scope: "anon",
				params: { userId: 10, limit: 10, cursorTime: null, cursorId: null },
			}),
		).rejects.toThrow();
		await expect(loadUserSearchFromDb(f.env, "test", 10)).rejects.toThrow(
			"User search could not be loaded",
		);
	});
});
