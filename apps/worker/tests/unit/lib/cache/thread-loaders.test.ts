import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bumpPostAttachmentsGen,
	bumpPostEntityGen,
	bumpPostListGen,
	bumpThreadMetaGen,
} from "../../../../src/lib/cache/invalidate";
import { getThreadListPage } from "../../../../src/lib/cache/thread-list-read";
import {
	getPostAttachments,
	getPostComments,
	getPostPage,
	getPostRows,
	getPostRowsBatch,
	getRatingAggregates,
	getRatingRows,
	getThreadRows,
	isThreadCacheData,
	loadPostAccessBatch,
	readingCacheKey,
	rebuildThreadCache,
	validateThreadCacheDescriptor,
} from "../../../../src/lib/cache/thread-loaders";
import { deferred, readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	f.thread(1, { replies: 2, views: 10 });
	f.post(1);
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
});

describe("reusable reading loaders", () => {
	it("splits stable entities from SHORT stats and does no hot content SELECTs", async () => {
		const cold = await getThreadRows(f.env, undefined, [1]);
		expect(cold.get(1)).toMatchObject({ subject: "Thread 1", replies: 2, views: 10 });
		expect(f.calls).toHaveLength(2);
		f.sqlite.exec("UPDATE threads SET subject = 'Edited', replies = 3, views = 20 WHERE id = 1");
		f.calls.length = 0;
		vi.setSystemTime(Date.now() + 59_999);
		expect((await getThreadRows(f.env, undefined, [1])).get(1)).toMatchObject({
			subject: "Thread 1",
			replies: 2,
		});
		expect(f.calls).toHaveLength(0);
		vi.setSystemTime(Date.now() + 1);
		expect((await getThreadRows(f.env, undefined, [1])).get(1)).toMatchObject({
			subject: "Thread 1",
			replies: 3,
			views: 20,
		});
		expect(f.calls).toHaveLength(1);
		await bumpThreadMetaGen(f.env, 1);
		expect((await getThreadRows(f.env, undefined, [1])).get(1)?.subject).toBe("Edited");
		expect(f.snapshots("thread:entity")[0].tier).toBe("MEDIUM");
		expect(f.snapshots("thread:entity")[0].data).not.toHaveProperty("replies");
	});

	it.each([
		["post:entity", 1_800_000],
		["post:attachments", 86_400_000],
	] as const)("%s hits until exactly its fixed expiry", async (family, ttl) => {
		f.insert("attachments", {
			id: 1,
			post_id: 1,
			thread_id: 1,
			author_id: 10,
			filename: "a.png",
			file_path: "/a.png",
		});
		const get = () =>
			family === "post:entity"
				? getPostRows(f.env, undefined, [1], 1)
				: getPostAttachments(f.env, undefined, [1], 1);
		await get();
		const loadedAt = f.snapshots(family)[0].loadedAt;
		f.calls.length = 0;
		vi.setSystemTime(loadedAt + ttl - 1);
		await get();
		expect(f.calls).toHaveLength(0);
		expect(f.snapshots(family)[0].expiresAt).toBe(loadedAt + ttl);
		vi.setSystemTime(loadedAt + ttl);
		await get();
		expect(f.calls).toHaveLength(1);
	});

	it("negative and empty values are SHORT and scoped to the exact resource", async () => {
		await getPostRows(f.env, undefined, [90], 1);
		await getPostAttachments(f.env, undefined, [1], 1);
		expect(f.snapshots("post:entity")[0]).toMatchObject({
			tier: "SHORT",
			data: null,
			scope: "internal",
			params: { postId: 90, threadId: 1 },
		});
		expect(f.snapshots("post:attachments")[0]).toMatchObject({ tier: "SHORT", data: [] });
		f.post(90);
		f.calls.length = 0;
		expect((await getPostRows(f.env, undefined, [90], 1)).size).toBe(0);
		expect(f.calls).toHaveLength(0);
		vi.setSystemTime(Date.now() + 60_000);
		expect((await getPostRows(f.env, undefined, [90], 1)).get(90)?.content).toBe("Body 90");
	});

	it("batches over 100 IDs, only loads misses, and reserves the thread binding", async () => {
		for (let id = 2; id <= 205; id++) f.post(id);
		await getPostRows(f.env, undefined, [1], 1);
		f.calls.length = 0;
		const ids = Array.from({ length: 205 }, (_, i) => i + 1);
		expect((await getPostRows(f.env, undefined, [...ids, 1, 2, 0, NaN], 1)).size).toBe(205);
		expect(f.calls).toHaveLength(3);
		expect(
			f.calls.every((call) => call.params.length <= 100 && !call.params.slice(0, -1).includes(1)),
		).toBe(true);
		f.calls.length = 0;
		expect((await loadPostAccessBatch(f.env, ids.slice(0, 100), 1)).size).toBe(100);
		expect(f.calls.map((call) => call.params.length)).toEqual([100, 2]);
	});

	it("100 concurrent cold reads and a slow fill execute one D1 batch", async () => {
		f.post(2);
		const fill = deferred();
		const queried = deferred();
		f.state.writeGate = fill.promise;
		f.state.afterRead = async () => {
			queried.resolve();
		};
		const requests = Array.from({ length: 100 }, () => getPostRows(f.env, f.ctx, [1, 2], 1));
		await queried.promise;
		const later = getPostRows(f.env, f.ctx, [1, 2], 1);
		fill.resolve();
		expect((await Promise.all([...requests, later])).every((rows) => rows.size === 2)).toBe(true);
		expect(f.calls).toHaveLength(1);
	});

	it("cross-thread pages batch over 100 missing posts and verify captured thread associations", async () => {
		for (let id = 2; id <= 206; id++) {
			f.thread(id);
			f.post(id, { thread_id: id });
		}
		await getPostRows(f.env, undefined, [1], 1);
		f.calls.length = 0;
		const members = Array.from({ length: 205 }, (_, i) => ({ postId: i + 1, threadId: i + 1 }));
		members.push({ postId: 206, threadId: 205 });
		const rows = await getPostRowsBatch(f.env, undefined, members);
		expect(rows.size).toBe(205);
		expect([...rows.values()].every((row) => row.thread_id === row.id)).toBe(true);
		expect(rows.has(206)).toBe(false);
		expect(f.calls).toHaveLength(3);
		expect(f.calls.every((call) => call.params.length <= 100 && !call.params.includes(1))).toBe(
			true,
		);
		const absent = f.snapshots("post:entity").find((entry) => entry.params.postId === 206);
		expect(absent).toMatchObject({
			params: { postId: 206, threadId: 205 },
			tier: "SHORT",
			data: null,
		});
		f.calls.length = 0;
		await getPostRowsBatch(f.env, undefined, members);
		expect(f.calls).toHaveLength(0);
		expect(
			(await getPostRowsBatch(f.env, undefined, [{ postId: 206, threadId: 206 }])).get(206)
				?.content,
		).toBe("Body 206");
		expect(f.calls).toHaveLength(1);
		await bumpPostListGen(f.env, 100);
		f.calls.length = 0;
		await getPostRowsBatch(f.env, undefined, members);
		expect(f.calls.map((call) => call.params)).toEqual([[100]]);
	});

	it("a paused old load cannot fill the new resource generation", async () => {
		const paused = deferred();
		const release = deferred();
		let once = true;
		f.state.afterRead = async () => {
			if (once) {
				once = false;
				paused.resolve();
				await release.promise;
			}
		};
		const old = getPostRows(f.env, undefined, [1], 1);
		await paused.promise;
		f.sqlite.exec("UPDATE posts SET content = 'New body' WHERE id = 1");
		await bumpPostEntityGen(f.env, 1);
		expect((await getPostRows(f.env, undefined, [1], 1)).get(1)?.content).toBe("New body");
		release.resolve();
		expect((await old).get(1)?.content).toBe("Body 1");
		expect((await getPostRows(f.env, undefined, [1], 1)).get(1)?.content).toBe("New body");
	});

	it("KV read/write failures preserve D1 results and failures never become empty successes", async () => {
		f.state.readError = true;
		f.state.writeError = true;
		// Keep a genuinely pending origin separate from the zero-latency burst below.
		f.state.afterRead = () => new Promise((resolve) => setTimeout(resolve, 20));
		const results = await Promise.all(
			Array.from({ length: 100 }, () => getPostRows(f.env, undefined, [1], 1)),
		);
		expect(results[0].get(1)?.content).toBe("Body 1");
		expect(f.calls).toHaveLength(1);
		expect(f.values.size).toBe(0);
		f.state.readError = false;
		f.state.writeError = false;
		f.state.afterRead = async () => {
			throw new Error("D1 read failed");
		};
		await expect(getPostRows(f.env, undefined, [1], 1)).rejects.toThrow("D1 read failed");
		expect(f.snapshots("post:entity")).toEqual([]);
		f.state.afterRead = undefined;
		expect((await getPostRows(f.env, undefined, [1], 1)).get(1)?.content).toBe("Body 1");
	});

	it("budgets a zero-latency KV-failure burst separately from completed later requests", async () => {
		f.state.readError = true;
		f.state.writeError = true;
		// No added D1 latency. Canonical hashing and the active origin task
		// coalesce this same-isolate burst; neither retains completed results.
		const results = await Promise.all(
			Array.from({ length: 100 }, () => getPostRows(f.env, undefined, [1], 1)),
		);
		expect(results.every((rows) => rows.get(1)?.content === "Body 1")).toBe(true);
		expect(f.calls).toHaveLength(1);
		expect(f.values.size).toBe(0);
		await getPostRows(f.env, undefined, [1], 1);
		expect(f.calls).toHaveLength(2);
	});

	it.each(["entity", "page", "rating rows", "post gate", "announcements", "local membership"])(
		"rejects a false-success D1 result for %s without caching an empty success",
		async (kind) => {
			const read = () => {
				switch (kind) {
					case "entity":
						return getPostRows(f.env, undefined, [1], 1);
					case "page":
						return getPostPage(f.env, undefined, {
							threadId: 1,
							limit: 20,
							cursorPosition: null,
							last: false,
						});
					case "rating rows":
						return getRatingRows(f.env, undefined, 1);
					case "post gate":
						return loadPostAccessBatch(f.env, [1], 1);
					default:
						return getThreadListPage(f.env, undefined, {
							forumId: 1,
							limit: 20,
							page: 1,
							cursor: null,
							typeId: kind === "local membership" ? 1 : null,
						});
				}
			};
			f.state.queryError = true;
			await expect(read()).rejects.toThrow(/query failed/);
			expect([...f.values.keys()].filter((key) => key.startsWith("cache:v3:"))).toEqual([]);
			f.state.queryError = false;
			await expect(read()).resolves.toBeDefined();
		},
	);

	it("uses the same current key for live snapshots and KV-only management validation", async () => {
		await getThreadRows(f.env, undefined, [1]);
		await getPostRows(f.env, undefined, [1], 1);
		await getPostAttachments(f.env, undefined, [1], 1);
		await getPostComments(f.env, undefined, [1], 20);
		await getRatingAggregates(f.env, undefined, [1]);
		await getRatingRows(f.env, undefined, 1);
		await getPostPage(f.env, undefined, {
			threadId: 1,
			limit: 20,
			last: false,
			cursorPosition: null,
		});
		f.calls.length = 0;
		for (const [key, value] of f.values) {
			if (!key.startsWith("cache:v3:")) continue;
			const descriptor = JSON.parse(value) as CacheDescriptor;
			validateThreadCacheDescriptor(descriptor);
			expect(await readingCacheKey(f.env, descriptor)).toBe(key);
		}
		expect(f.calls).toHaveLength(0);
		expect(() =>
			validateThreadCacheDescriptor({
				family: "unknown",
				params: { postId: 1 },
				scope: "internal",
			}),
		).toThrow();
	});

	it("thread delete/restore generations replace child entities and attachments without per-post fanout", async () => {
		f.thread(2);
		f.insert("attachments", {
			id: 1,
			post_id: 1,
			thread_id: 1,
			author_id: 10,
			filename: "old.png",
			file_path: "/a.png",
		});
		await getPostRows(f.env, undefined, [1], 1);
		await getPostAttachments(f.env, undefined, [1], 1);
		const oldPostKey = f.snapshots("post:entity")[0].key;
		const oldAttachmentKey = f.snapshots("post:attachments")[0].key;
		f.sqlite.exec(
			"UPDATE posts SET content = 'Restored content' WHERE id = 1; UPDATE attachments SET filename = 'restored.png' WHERE id = 1",
		);
		await bumpPostListGen(f.env, 1);
		expect(await readingCacheKey(f.env, f.snapshots("post:entity")[0])).not.toBe(oldPostKey);
		expect(await readingCacheKey(f.env, f.snapshots("post:attachments")[0])).not.toBe(
			oldAttachmentKey,
		);
		expect((await getPostRows(f.env, undefined, [1], 1)).get(1)?.content).toBe("Restored content");
		expect((await getPostAttachments(f.env, undefined, [1], 1)).get(1)?.[0].filename).toBe(
			"restored.png",
		);
		// A valid but unrelated thread descriptor cannot load this post's data.
		expect((await getPostRows(f.env, undefined, [1], 2)).size).toBe(0);
		expect((await getPostAttachments(f.env, undefined, [1], 2)).get(1)).toEqual([]);
		expect(
			await rebuildThreadCache(f.env, undefined, {
				family: "post:entity",
				scope: "internal",
				params: { postId: 1, threadId: 2 },
			}),
		).toBeNull();
		f.sqlite.exec("UPDATE attachments SET filename = 'edited.png' WHERE id = 1");
		await bumpPostAttachmentsGen(f.env, 1);
		expect((await getPostAttachments(f.env, undefined, [1], 1)).get(1)?.[0].filename).toBe(
			"edited.png",
		);
	});

	it("related data uses SHORT snapshots without IPs or viewer permissions", async () => {
		f.insert("post_comments", {
			id: 1,
			thread_id: 1,
			post_id: 1,
			author_id: 20,
			content: "Comment",
			ip: "private-ip",
		});
		f.insert("post_ratings", {
			id: 1,
			thread_id: 1,
			post_id: 1,
			rater_id: 20,
			rater_name: "bob",
			dimension: 2,
			score: 5,
			reason: "Helpful",
			created_at: 1,
		});
		await getPostComments(f.env, undefined, [1], null);
		await getRatingRows(f.env, undefined, 1);
		expect((await getRatingAggregates(f.env, undefined, [1])).get(1)?.coins.sum).toBe(5);
		f.calls.length = 0;
		await getPostComments(f.env, undefined, [1], null);
		await getRatingRows(f.env, undefined, 1);
		await getRatingAggregates(f.env, undefined, [1]);
		expect(f.calls).toHaveLength(0);
		for (const family of ["post:comments", "post:ratings", "post:rating-rows"]) {
			expect(f.snapshots(family)[0].tier).toBe("SHORT");
			expect(JSON.stringify(f.snapshots(family))).not.toMatch(/private-ip|canRevoke/);
		}
	});

	it("rebuilds every family from validated params without cache I/O or side effects", async () => {
		const descriptors: CacheDescriptor[] = [
			{ family: "thread:list", scope: "internal", params: { kind: "announcements" } },
			...["thread:entity", "thread:stats"].map((family) => ({
				family,
				scope: "internal",
				params: { threadId: 1 },
			})),
			...["post:entity", "post:attachments"].map((family) => ({
				family,
				scope: "internal",
				params: { postId: 1, threadId: 1 },
			})),
			...["post:ratings", "post:rating-rows"].map((family) => ({
				family,
				scope: "internal",
				params: { postId: 1 },
			})),
			{ family: "post:comments", scope: "internal", params: { postId: 1, limit: 20 } },
			{
				family: "post:page",
				scope: "internal",
				params: { threadId: 1, limit: 20, cursorPosition: null, last: false },
			},
		];
		for (const descriptor of descriptors) {
			const value = await rebuildThreadCache(f.env, undefined, descriptor);
			expect(isThreadCacheData(descriptor, value), descriptor.family).toBe(true);
		}
		expect(f.values.size).toBe(0);
		expect(f.calls.every((call) => call.mode !== "run")).toBe(true);
		f.calls.length = 0;
		for (const descriptor of [
			{ family: "post:entity", scope: "admin", params: { postId: 1 } },
			{
				family: "post:comments",
				scope: "internal",
				params: { postId: 1, limit: "1; DELETE FROM posts" },
			},
			{ family: "post:entity", scope: "internal", params: { postId: 1, credential: "secret" } },
			{ family: "unknown", scope: "internal", params: { postId: 1 } },
		])
			await expect(rebuildThreadCache(f.env, undefined, descriptor)).rejects.toThrow();
		expect(f.calls).toHaveLength(0);
	});

	it("management validation rejects extra/inherited parameters and cross-resource rows without I/O", () => {
		const descriptor = (family: string, params: CacheDescriptor["params"]): CacheDescriptor => ({
			family,
			params,
			scope: "internal",
		});
		const cases: [CacheDescriptor, unknown][] = [
			[descriptor("thread:entity", { threadId: 1 }), { id: 2, subject: "Other thread" }],
			[descriptor("thread:stats", { threadId: 1 }), { id: 2, replies: 1, views: 2 }],
			[
				descriptor("post:entity", { postId: 1, threadId: 1 }),
				{ id: 1, thread_id: 2, content: "Other thread" },
			],
			[
				descriptor("post:entity", { postId: 1, threadId: 1 }),
				{ id: 2, thread_id: 1, content: "Other post" },
			],
			[
				descriptor("post:attachments", { postId: 1, threadId: 1 }),
				[{ id: 1, post_id: 1, thread_id: 2, filename: "other.png" }],
			],
			[
				descriptor("post:attachments", { postId: 1, threadId: 1 }),
				[{ id: 1, post_id: 2, thread_id: 1, filename: "other.png" }],
			],
			[
				descriptor("post:comments", { postId: 1, limit: 20 }),
				[{ id: 1, post_id: 2, content: "Other post" }],
			],
			[
				descriptor("post:rating-rows", { postId: 1 }),
				[{ id: 1, post_id: 2, reason: "Other post" }],
			],
			[
				descriptor("post:ratings", { postId: 1 }),
				{ total: 1, credits: { count: 1 }, coins: { count: 0, sum: 0 } },
			],
			[
				descriptor("post:page", { threadId: 1, limit: 20, last: false, cursorPosition: 10 }),
				[{ id: 1, position: 5 }],
			],
			[
				descriptor("thread:list", { kind: "announcements" }),
				{ items: [{ id: 1, sticky: 0, last_post_at: 1 }], total: 1 },
			],
		];
		for (const [d, value] of cases) expect(isThreadCacheData(d, value), d.family).toBe(false);
		for (const d of [
			descriptor("thread:entity", { threadId: 1, credential: "secret" }),
			descriptor("thread:entity", Object.assign(Object.create({ threadId: 1 }), { unused: 1 })),
			descriptor(
				"thread:list",
				Object.assign(Object.create({ kind: "announcements" }), { unused: 1 }),
			),
			descriptor("post:page", { threadId: 1, limit: 20, last: true, cursorPosition: 10 }),
			descriptor("post:comments", { postId: 1, limit: "20" }),
			{ ...descriptor("thread:entity", { threadId: 1 }), scope: "user:1" },
			descriptor("unknown", { threadId: 1 }),
		]) {
			expect(() => validateThreadCacheDescriptor(d)).toThrow();
			expect(isThreadCacheData(d, null)).toBe(false);
		}
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});

	it("live entity and attachment reads reject a valid envelope containing another thread's data", async () => {
		f.insert("attachments", {
			id: 1,
			post_id: 1,
			thread_id: 1,
			author_id: 10,
			filename: "original.png",
			file_path: "/a.png",
		});
		await getPostRows(f.env, undefined, [1], 1);
		await getPostAttachments(f.env, undefined, [1], 1);
		for (const family of ["post:entity", "post:attachments"]) {
			const { key, ...envelope } = f.snapshots(family)[0];
			const wrong =
				family === "post:entity"
					? { ...envelope.data, thread_id: 2, content: "secret" }
					: envelope.data.map((row: Record<string, unknown>) => ({
							...row,
							thread_id: 2,
							filename: "secret.png",
						}));
			f.values.set(key, JSON.stringify({ ...envelope, data: wrong }));
			expect(isThreadCacheData(envelope, wrong)).toBe(false);
		}
		f.calls.length = 0;
		expect(
			(await getPostRowsBatch(f.env, undefined, [{ postId: 1, threadId: 1 }])).get(1)?.content,
		).toBe("Body 1");
		expect((await getPostAttachments(f.env, undefined, [1], 1)).get(1)?.[0].filename).toBe(
			"original.png",
		);
		expect(f.calls).toHaveLength(2);
	});

	it("post pages cache independent cursors and last pages while bodies are shared", async () => {
		for (let id = 2; id <= 140; id++) f.post(id);
		const get = (cursorPosition: number | null, last = false) =>
			getPostPage(f.env, undefined, { threadId: 1, limit: 25, cursorPosition, last });
		expect((await get(null))[0].id).toBe(1);
		expect((await get(100))[0].id).toBe(101);
		expect((await get(null, true))[0].id).toBe(116);
		f.calls.length = 0;
		await get(100);
		await get(null, true);
		expect(f.calls).toHaveLength(0);
		expect(f.snapshots("post:page")).toHaveLength(3);
	});
});
