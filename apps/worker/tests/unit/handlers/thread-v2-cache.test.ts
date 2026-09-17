// Reading-cache integration: real SQLite, real cache core, current authority gates.
import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as attachment from "../../../src/handlers/attachment";
import * as post from "../../../src/handlers/post";
import * as comment from "../../../src/handlers/post-comment";
import * as rating from "../../../src/handlers/post-rating";
import * as thread from "../../../src/handlers/thread";
import { editThreadSubject } from "../../../src/handlers/thread-edit";
import { deleteMyPost, deleteMyThread, editMyPost } from "../../../src/handlers/user-content";
import { bumpPostAttachmentsGen, bumpPostListGen } from "../../../src/lib/cache/invalidate";
import { readingCacheKey, rebuildThreadCache } from "../../../src/lib/cache/thread-loaders";
import * as threadViews from "../../../src/lib/thread-views";
import { createJwtForRole } from "../../helpers";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
let viewEvent: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	f.thread(1, { replies: 2, views: 10, last_post_at: 3 });
	f.post(1);
	f.post(2, { author_id: 20, author_name: "bob" });
	f.post(3);
	f.insert("attachments", {
		id: 1,
		thread_id: 1,
		post_id: 1,
		author_id: 10,
		filename: "a.png",
		file_path: "a.png",
	});
	f.insert("post_comments", {
		id: 1,
		thread_id: 1,
		post_id: 1,
		author_id: 20,
		author_name: "bob",
		content: "Comment",
		created_at: 1,
		ip: "private-ip",
	});
	f.insert("post_ratings", {
		id: 1,
		thread_id: 1,
		post_id: 1,
		rater_id: 20,
		rater_name: "bob",
		dimension: 2,
		score: 4,
		reason: "Helpful",
		created_at: 1,
	});
	viewEvent = vi
		.spyOn(threadViews, "scheduleThreadViewIncrement")
		.mockImplementation(() => undefined);
});
afterEach(async () => {
	await Promise.all(f.ctx._waitUntilPromises);
	f.close();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

async function request(path: string, userId?: number, init: RequestInit = {}): Promise<Request> {
	const headers = new Headers(init.headers);
	if (userId !== undefined) {
		const roles: Record<number, number> = { 1: 1, 2: 2, 30: 3 };
		headers.set("Authorization", `Bearer ${await createJwtForRole(roles[userId] ?? 0, userId)}`);
	}
	return new Request(`https://example.com/api/v1/${path}`, { ...init, headers });
}
const listThreads = async (query = "forumId=1&limit=20", userId?: number) =>
	thread.list(await request(`threads?${query}`, userId), f.env, f.ctx);
const detail = async (userId?: number, headers?: HeadersInit) =>
	thread.getById(await request("threads/1", userId, { headers }), f.env, f.ctx);
const posts = async (userId?: number) =>
	post.list(await request("posts?threadId=1&limit=20", userId), f.env, f.ctx);
const postDetail = async (userId?: number) =>
	post.getById(await request("posts/1", userId), f.env, f.ctx);
const attachments = async (userId?: number) =>
	attachment.listByPost(await request("posts/1/attachments", userId), f.env, f.ctx);
const comments = async (userId?: number) =>
	comment.list(await request("post-comments?postId=1", userId), f.env, f.ctx);
const ratings = async (userId?: number) =>
	rating.listByPost(await request("posts/1/ratings", userId), f.env, f.ctx);
const memberIds = (body: { data: { id: number }[] }) => body.data.map((row) => row.id);

async function batch(
	kind: "attachments" | "comments",
	threadId: number,
	postIds: number[],
	userId?: number,
) {
	const path = kind === "attachments" ? "posts/attachments/batch" : "post-comments/batch";
	const handler = kind === "attachments" ? attachment.batchByPostIds : comment.batchByPostIds;
	return handler(
		await request(path, userId, { method: "POST", body: JSON.stringify({ threadId, postIds }) }),
		f.env,
		f.ctx,
	);
}

function generationWrites() {
	return vi.mocked(f.env.KV.put).mock.calls.filter(([key]) => key.includes(":gen"));
}

describe("reading cache hot paths", () => {
	it("thread detail drops from 4 cold SELECTs to 1 current gate plus one logical view event", async () => {
		expect((await detail()).status).toBe(200);
		expect(f.calls).toHaveLength(4); // gate, entity, statistics, user minis
		expect(viewEvent).toHaveBeenCalledTimes(1);
		f.calls.length = 0;
		expect((await detail()).status).toBe(200);
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].sql).not.toMatch(/subject|content/);
		expect(viewEvent).toHaveBeenCalledTimes(2);
	});

	it("metadata and rebuild reuse data while only a normal detail emits a view event", async () => {
		await detail(undefined, { "X-Ellie-Read-Purpose": "metadata" });
		const descriptor = f.snapshots("thread:entity")[0] as CacheDescriptor;
		await rebuildThreadCache(f.env, undefined, descriptor);
		expect(viewEvent).not.toHaveBeenCalled();
		f.calls.length = 0;
		await detail();
		expect(f.calls).toHaveLength(1);
		expect(viewEvent).toHaveBeenCalledTimes(1);
	});

	it.each(["forumId=1&limit=20", "forumId=1&page=1&limit=25", "forumId=1&page=2&limit=1"])(
		"all thread-list shapes reuse data: %s",
		async (query) => {
			f.thread(2);
			const cold = await (await listThreads(query)).json();
			expect(f.calls).toHaveLength(8); // forum, globals, local count/page, gate, entity/stats, minis
			const entries = f.snapshots("thread:list");
			expect(
				entries.every(
					(entry) => entry.tier === "SHORT" && entry.expiresAt - entry.loadedAt === 60_000,
				),
			).toBe(true);
			f.calls.length = 0;
			const hot = await (await listThreads(query)).json();
			expect(hot.data).toEqual(cold.data);
			expect(f.calls).toHaveLength(2); // current forum + candidate thread/forum batch
			expect(
				f.calls.every((call) => !call.sql.includes("subject") && !call.sql.includes("COUNT(*)")),
			).toBe(true);
			expect(f.snapshots("thread:list")).toEqual(entries);
		},
	);

	it("keyset and offset page one share membership without losing meta.total or cursors", async () => {
		const first = await (await listThreads("forumId=1&limit=1")).json();
		f.calls.length = 0;
		const offset = await (await listThreads("forumId=1&limit=1&page=1")).json();
		expect(offset.data).toEqual(first.data);
		expect(offset.meta).toMatchObject({ total: 1, page: 1, limit: 1, pages: 1 });
		expect(first.meta.nextCursor).toEqual(expect.any(String));
		expect(f.calls).toHaveLength(2);
	});

	it.each([
		["posts", posts, 6, 2],
		["post detail", postDetail, 5, 2],
		["comments", comments, 3, 1],
		["ratings", ratings, 4, 1],
		["attachments", attachments, 3, 2],
	] as const)("%s drops from %i cold to %i hot SELECTs", async (_name, read, cold, hot) => {
		expect((await read()).status).toBe(200);
		expect(f.calls).toHaveLength(cold);
		f.calls.length = 0;
		expect((await read()).status).toBe(200);
		expect(f.calls).toHaveLength(hot);
		expect(
			f.calls.every(
				(call) =>
					!call.sql.includes("content") &&
					!call.sql.includes("filename") &&
					!call.sql.includes("COUNT(*)"),
			),
		).toBe(true);
		expect(viewEvent).not.toHaveBeenCalled();
	});

	it("never persists an HTTP response, request credentials, IP, or viewer permissions", async () => {
		await detail(1);
		await posts(1);
		await comments(1);
		await ratings(1);
		await attachments(1);
		await listThreads("forumId=1", 1);
		for (const [key, value] of f.values) {
			if (!key.startsWith("cache:v3:")) continue;
			expect(value).not.toMatch(/private-ip|Authorization|Bearer |canRevoke|password|requestId/);
			expect(JSON.parse(value).schemaVersion).toBe(3);
		}
	});
});

describe("current gates and audience projection over shared snapshots", () => {
	it("anonymous authors/last posters are projected for anon, self, other member and each staff role", async () => {
		f.sqlite.exec(
			"UPDATE threads SET anonymous_author=1,anonymous_last_poster=1,last_poster_id=20 WHERE id=1; UPDATE posts SET anonymous=1 WHERE id=1",
		);
		await detail(1); // warm raw entities using an admin before other viewers
		await posts(1);
		for (const userId of [undefined, 10, 20, 30, 2, 1]) {
			const data = (await (await detail(userId)).json()).data;
			const showAuthor = userId === 10 || userId === 30 || userId === 2 || userId === 1;
			const showLast = userId === 20 || userId === 30 || userId === 2 || userId === 1;
			expect(data.authorId).toBe(showAuthor ? 10 : 0);
			expect(data.authorAvatar).toBe(showAuthor ? "alice.png" : "");
			expect(data.lastPosterId).toBe(showLast ? 20 : 0);
			expect(data.lastPosterAvatar).toBe(showLast ? "bob.png" : "");
			const body = await (await posts(userId)).json();
			expect(body.data[0].authorId).toBe(showAuthor ? 10 : 0);
			const list = await (await listThreads("forumId=1", userId)).json();
			expect(list.data[0].authorId).toBe(showAuthor ? 10 : 0);
		}
		expect(f.snapshots("thread:entity")).toHaveLength(1);
		expect(f.snapshots("post:entity")).toHaveLength(3);
	});

	it("a changed anonymous/ownership flag takes effect before stale entity projection", async () => {
		await detail();
		await posts();
		f.sqlite.exec(
			"UPDATE threads SET anonymous_author=1,author_id=20,anonymous_last_poster=1 WHERE id=1; UPDATE posts SET anonymous=1,author_id=20 WHERE id=1",
		);
		expect((await (await detail(10)).json()).data.authorId).toBe(0);
		expect((await (await detail(20)).json()).data.authorId).toBe(20);
		expect((await (await postDetail(10)).json()).data.authorId).toBe(0);
		expect((await (await postDetail(20)).json()).data.authorName).toBe("bob");
	});

	it("moderated content uses current author, exact forum moderator membership and current role", async () => {
		await detail(1);
		await posts(1);
		f.sqlite.exec("UPDATE threads SET sticky=-2 WHERE id=1");
		const readers = [detail, posts, postDetail, attachments, comments, ratings];
		for (const userId of [undefined, 20, 10, 30, 2, 1]) {
			for (const read of readers)
				expect((await read(userId)).status).toBe(userId === undefined || userId === 20 ? 404 : 200);
		}
		f.sqlite.exec("UPDATE forums SET moderator_ids='' WHERE id=1");
		expect((await detail(30)).status).toBe(404);
		// JWT still claims admin, but current DB role was revoked.
		f.sqlite.exec("UPDATE users SET role=0 WHERE id=1");
		expect((await detail(1)).status).toBe(404);
		const before = viewEvent.mock.calls.length;
		await detail(10);
		expect(viewEvent.mock.calls.length).toBe(before);
	});

	it.each([
		["members", 1, [10, 30, 2, 1]],
		["staff", 1, [30, 2, 1]],
		["admin", 1, [1]],
		["public", 3, []],
		["public", 0, []],
		["public", -1, []],
		["public", 2, []],
	] as const)(
		"moderated reads require current forum visibility=%s and status=%i before author/staff exceptions",
		async (visibility, status, allowed) => {
			const readers = [detail, posts, postDetail, attachments, comments, ratings];
			for (const read of readers) expect((await read(10)).status).toBe(200);
			for (const kind of ["attachments", "comments"] as const) await batch(kind, 1, [1], 10);
			f.sqlite.exec("UPDATE threads SET sticky=-2 WHERE id=1");
			f.sqlite
				.prepare("UPDATE forums SET visibility=?,status=? WHERE id=1")
				.run(visibility, status);
			for (const userId of [undefined, 20, 10, 30, 2, 1]) {
				const expected = (allowed as readonly number[]).includes(userId ?? 0) ? 200 : 404;
				for (const read of readers) {
					const response = await read(userId);
					expect(response.status).toBe(expected);
					if (expected === 404) expect((await response.json()).data).toBeUndefined();
				}
				for (const kind of ["attachments", "comments"] as const)
					expect((await batch(kind, 1, [1], userId)).status).toBe(expected);
			}
		},
	);

	it("global announcements retain the read exception while inactive forums stay hidden", async () => {
		f.sqlite.exec(
			"UPDATE threads SET sticky=2 WHERE id=1; UPDATE forums SET visibility='admin' WHERE id=1",
		);
		const readers = [detail, posts, postDetail, attachments, comments, ratings];
		for (const read of readers) expect((await read()).status).toBe(200);
		for (const kind of ["attachments", "comments"] as const)
			expect((await batch(kind, 1, [1])).status).toBe(200);
		f.sqlite.exec("UPDATE forums SET status=0 WHERE id=1");
		for (const read of readers) expect((await read(1)).status).toBe(404);
		for (const kind of ["attachments", "comments"] as const)
			expect((await batch(kind, 1, [1], 1)).status).toBe(404);
	});

	it.each([
		["UPDATE threads SET sticky=-1 WHERE id=1", 404],
		["UPDATE forums SET status=2 WHERE id=1", 404],
		["UPDATE forums SET visibility='staff' WHERE id=1", 403],
		["UPDATE threads SET forum_id=2 WHERE id=1", 403],
	])("warm content never bypasses %s", async (sql, status) => {
		const readers = [detail, posts, postDetail, attachments, comments, ratings];
		for (const read of readers) await read();
		f.sqlite.exec(sql);
		for (const read of readers) {
			const response = await read();
			expect(response.status).toBe(status);
			expect((await response.json()).data).toBeUndefined();
		}
	});

	it("banned former staff cannot use cached projections to enter restricted content", async () => {
		f.sqlite.exec("UPDATE threads SET forum_id=2 WHERE id=1");
		expect((await detail(1)).status).toBe(200);
		f.sqlite.exec("UPDATE users SET status=-1 WHERE id=1");
		expect((await detail(1)).status).toBe(403);
	});

	it("current rating revoke permission never comes from cached rows or a JWT role", async () => {
		for (const [userId, canRevoke] of [
			[1, true],
			[2, true],
			[30, false],
			[20, false],
			[undefined, false],
		] as const) {
			const body = await (await ratings(userId)).json();
			expect(body.data.items).toHaveLength(1);
			expect(body.data.items[0].canRevoke).toBe(canRevoke);
		}
		f.sqlite.exec("UPDATE users SET role=0 WHERE id=1");
		expect((await (await ratings(1)).json()).data.items[0].canRevoke).toBe(false);
		f.sqlite.exec("UPDATE posts SET anonymous=1 WHERE id=1");
		expect((await ratings(1)).status).toBe(404);
	});

	it("a removed global announcement cannot leak its source title, identity or count", async () => {
		f.thread(2, { forum_id: 2, sticky: 2, subject: "Private title" });
		expect(memberIds(await (await listThreads("forumId=1&page=1&limit=20")).json())).toEqual([
			2, 1,
		]);
		f.sqlite.exec("UPDATE threads SET sticky=0 WHERE id=2");
		const body = await (await listThreads("forumId=1&page=1&limit=20")).json();
		expect(memberIds(body)).toEqual([1]);
		expect(body.meta.total).toBe(1);
		expect(JSON.stringify(body)).not.toContain("Private title");
	});

	it.each(["UPDATE threads SET sticky=-1 WHERE id=2", "UPDATE threads SET forum_id=2 WHERE id=2"])(
		"a stale local candidate is replaced after %s",
		async (sql) => {
			f.thread(2, { last_post_at: 5 });
			await listThreads("forumId=1&page=1&limit=1");
			f.sqlite.exec(sql);
			const body = await (await listThreads("forumId=1&page=1&limit=1")).json();
			expect(memberIds(body)).toEqual([1]);
			expect(body.meta.total).toBe(1);
		},
	);

	it.each(["attachments", "comments"] as const)(
		"%s batches recheck current post ownership/deletion at the 100-ID boundary",
		async (kind) => {
			for (let id = 4; id <= 100; id++) f.post(id);
			const ids = Array.from({ length: 100 }, (_, i) => i + 1);
			expect((await batch(kind, 1, ids)).status).toBe(200);
			expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
			f.calls.length = 0;
			expect((await batch(kind, 1, ids)).status).toBe(200);
			expect(f.calls).toHaveLength(3); // thread + 99-post gate + one-post gate
			f.thread(2, { forum_id: 2 });
			f.post(101, { thread_id: 2, forum_id: 2 });
			f.insert("attachments", {
				id: 2,
				post_id: 101,
				thread_id: 2,
				author_id: 10,
				filename: "private.png",
				file_path: "private.png",
			});
			f.insert("post_comments", {
				id: 2,
				post_id: 101,
				thread_id: 2,
				author_id: 10,
				content: "private comment",
			});
			await batch(kind, 2, [101], 1); // authorized warming of another thread's raw cache
			f.sqlite.exec("UPDATE posts SET invisible=1 WHERE id=1");
			const response = await batch(kind, 1, [1, 101]);
			expect(response.status).toBe(200);
			expect((await response.json()).data).toEqual([]);
		},
	);
});

describe("writes and fixed snapshots", () => {
	it("ordinary create/reply returns committed data and does not bump list/stat/entity generations", async () => {
		const initialList = (await (await listThreads()).json()).data;
		const initialPosts = (await (await posts()).json()).data;
		const initialStats = (await (await detail()).json()).data;
		const snapshots = f.snapshots("thread:list");
		vi.mocked(f.env.KV.put).mockClear();
		const created = await thread.create(
			await request("threads", 10, {
				method: "POST",
				body: JSON.stringify({ forumId: 1, subject: "Fresh thread", content: "First body" }),
			}),
			f.env,
		);
		expect(created.status).toBe(201);
		expect((await created.json()).data.subject).toBe("Fresh thread");
		const reply = await post.create(
			await request("posts", 10, {
				method: "POST",
				body: JSON.stringify({ threadId: 1, content: "Fresh reply" }),
			}),
			f.env,
		);
		expect(reply.status).toBe(201);
		expect((await reply.json()).data.content).toBe("Fresh reply");
		expect(generationWrites()).toHaveLength(0);
		expect(f.snapshots("thread:list")).toEqual(snapshots);
		vi.setSystemTime(Date.now() + 59_999);
		expect((await (await listThreads()).json()).data).toEqual(initialList);
		expect((await (await posts()).json()).data).toEqual(initialPosts);
		expect((await (await detail()).json()).data.replies).toBe(initialStats.replies);
		vi.setSystemTime(Date.now() + 1);
		expect((await (await listThreads()).json()).data).toHaveLength(2);
		expect((await (await posts()).json()).data).toHaveLength(4);
		expect((await (await detail()).json()).data.replies).toBe(3);
	});

	it("subject and post edits refresh only their reusable entities", async () => {
		await listThreads();
		await posts();
		const membership = f.snapshots("thread:list");
		const page = f.snapshots("post:page");
		vi.mocked(f.env.KV.put).mockClear();
		expect(
			(
				await editThreadSubject(
					await request("threads/1", 10, {
						method: "PATCH",
						body: JSON.stringify({ subject: "Edited title" }),
					}),
					f.env,
				)
			).status,
		).toBe(200);
		expect(
			(
				await editMyPost(
					await request("me/posts/1", 10, {
						method: "PATCH",
						body: JSON.stringify({ content: "Edited body" }),
					}),
					f.env,
				)
			).status,
		).toBe(200);
		expect(
			generationWrites()
				.map(([key]) => key)
				.sort(),
		).toEqual(["post:entity:gen:1", "thread:meta:gen:1"]);
		expect(f.snapshots("thread:list")).toEqual(membership);
		expect(f.snapshots("post:page")).toEqual(page);
		expect((await (await listThreads()).json()).data[0].subject).toBe("Edited title");
		expect((await (await postDetail()).json()).data.content).toBe("Edited body");
	});

	it("post deletion invalidates body, attachments and page after recomputing current metadata", async () => {
		f.insert("attachments", {
			id: 2,
			thread_id: 1,
			post_id: 3,
			author_id: 10,
			filename: "remove.png",
			file_path: "remove.png",
		});
		await posts();
		await batch("attachments", 1, [3]);
		await detail();
		expect(
			(await deleteMyPost(await request("me/posts/3", 10, { method: "DELETE" }), f.env)).status,
		).toBe(200);
		expect(memberIds(await (await posts()).json())).toEqual([1, 2]);
		expect((await (await detail()).json()).data.replies).toBe(1);
		expect(
			(await attachment.listByPost(await request("posts/3/attachments"), f.env, f.ctx)).status,
		).toBe(404);
		const gens = generationWrites().map(([key]) => key);
		for (const key of [
			"post:entity:gen:3",
			"post:attachments:gen:3",
			"post:list:gen:1",
			"thread:meta:gen:1",
			"thread:list:gen:1",
		])
			expect(gens).toContain(key);
	});

	it("thread deletion and restore cannot re-expose old child bodies or LONG metadata", async () => {
		await detail();
		await posts();
		await attachments();
		const before = f.snapshots("post:entity").find((entry) => entry.params.postId === 1);
		expect(before).toBeDefined();
		expect(
			(await deleteMyThread(await request("me/threads/1", 10, { method: "DELETE" }), f.env)).status,
		).toBe(200);
		expect((await detail()).status).toBe(404);
		expect((await postDetail()).status).toBe(404);
		expect((await attachments()).status).toBe(404);
		expect(memberIds(await (await listThreads()).json())).toEqual([]);
		expect(await readingCacheKey(f.env, before)).not.toBe(before.key);
		f.thread(1, { subject: "Restored title" });
		f.post(1, { content: "Restored body" });
		f.insert("attachments", {
			id: 2,
			thread_id: 1,
			post_id: 1,
			author_id: 10,
			filename: "restored.png",
			file_path: "restored.png",
		});
		// Mirrors the parent-owned restore mutation's one thread-scoped bump.
		await bumpPostListGen(f.env, 1);
		expect((await (await postDetail()).json()).data.content).toBe("Restored body");
		expect((await (await attachments()).json()).data[0].filename).toBe("restored.png");
	});

	it("attachment replace/delete invalidates just that post's metadata", async () => {
		await attachments();
		await posts();
		const entity = f.snapshots("post:entity");
		f.sqlite.exec("UPDATE attachments SET filename='changed.png' WHERE id=1");
		await bumpPostAttachmentsGen(f.env, 1);
		expect((await (await attachments()).json()).data[0].filename).toBe("changed.png");
		f.sqlite.exec("DELETE FROM attachments WHERE id=1");
		await bumpPostAttachmentsGen(f.env, 1);
		expect((await (await attachments()).json()).data).toEqual([]);
		expect(f.snapshots("post:entity")).toEqual(entity);
	});

	it("comment/rating writes keep public SHORT snapshots while returning fresh writer data", async () => {
		await comments();
		await ratings();
		const commentResult = await comment.create(
			await request("post-comments", 10, {
				method: "POST",
				body: JSON.stringify({ postId: 1, content: "New comment" }),
			}),
			f.env,
		);
		expect(commentResult.status).toBe(201);
		expect((await commentResult.json()).data.content).toBe("New comment");
		const ratingResult = await rating.create(
			await request("posts/1/rate", 30, {
				method: "POST",
				body: JSON.stringify({
					dimension: "credits",
					score: 5,
					reason: "Thanks",
					notifyAuthor: false,
				}),
			}),
			f.env,
		);
		expect(ratingResult.status).toBe(201);
		expect((await ratingResult.json()).data.aggregate.total).toBe(2);
		expect((await (await comments()).json()).data).toHaveLength(1);
		expect((await (await ratings()).json()).data.aggregate.total).toBe(1);
		vi.setSystemTime(Date.now() + 60_000);
		expect((await (await comments()).json()).data).toHaveLength(2);
		expect((await (await ratings()).json()).data.aggregate.total).toBe(2);
	});
});
