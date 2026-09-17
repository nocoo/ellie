import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAttachment from "../../../../src/handlers/admin/attachment";
import * as adminForum from "../../../../src/handlers/admin/forum";
import * as adminPost from "../../../../src/handlers/admin/post";
import * as adminThread from "../../../../src/handlers/admin/thread";
import * as adminUser from "../../../../src/handlers/admin/user";
import * as moderation from "../../../../src/handlers/moderation";
import { getById as readPost } from "../../../../src/handlers/post";
import {
	adminEntityGenKey,
	digestGenKey,
	forumSummaryGenKey,
	forumTreeGenKey,
	postAttachmentsGenKey,
	postEntityGenKey,
	postListGenKey,
	recommendedGenKey,
	threadListGenAllKey,
	threadListGenKey,
	threadMetaGenKey,
} from "../../../../src/lib/cache/keys";
import {
	getPostAttachments,
	getPostPage,
	getPostRows,
	getPostRowsBatch,
	getThreadRows,
	readingCacheKey,
} from "../../../../src/lib/cache/thread-loaders";
import { buildContentRecalcStatements } from "../../../../src/lib/recalcMetadata";
import { getUserProfiles, userMiniCacheKey } from "../../../../src/lib/user-cache";
import { deleteUserContent } from "../../../../src/lib/userContentDelete";
import { STICKY_FORUM, STICKY_GLOBAL, STICKY_MODERATED } from "../../../../src/lib/visibility";
import { createAdminRequest, createJwtForRole, createMockR2 } from "../../../helpers";
import { deferred, readingFixture } from "../../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
let token: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	f.env.R2 = createMockR2();
	// The reading fixture shares real SQLite statements; this mutation suite
	// also enforces D1's atomic batch commit/rollback semantics.
	const batch = f.env.DB.batch.bind(f.env.DB);
	f.env.DB.batch = async <T>(statements: D1PreparedStatement[]) => {
		f.sqlite.exec("BEGIN");
		try {
			const results = await batch<T>(statements);
			f.sqlite.exec("COMMIT");
			return results;
		} catch (error) {
			f.sqlite.exec("ROLLBACK");
			throw error;
		}
	};
	token = await createJwtForRole(1, 1);
	f.thread(1);
	f.post(1);
});

afterEach(() => {
	expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
	f.close();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function request(method: string, path: string, body?: unknown) {
	const req = createAdminRequest(method, path, body);
	req.headers.set("Authorization", `Bearer ${token}`);
	return req;
}

function attachment(id: number, postId: number, threadId = 1, authorId = 10) {
	f.insert("attachments", {
		id,
		post_id: postId,
		thread_id: threadId,
		author_id: authorId,
		filename: `asset-${id}.png`,
		file_path: `assets/${id}.png`,
	});
}

function key(family: string, params: CacheDescriptor["params"]) {
	return readingCacheKey(f.env, { family, params, scope: "internal" });
}

function generations() {
	return vi
		.mocked(f.env.KV.put)
		.mock.calls.map(([k]) => k)
		.filter((k) => /:gen(?::|$)/.test(k));
}

function expectBumps(keys: string[]) {
	expect(generations().sort()).toEqual(keys.sort());
}

function clearWrites() {
	vi.mocked(f.env.KV.put).mockClear();
	vi.mocked(f.env.KV.delete).mockClear();
}

async function warm(threadId = 1, ids = [1]) {
	await Promise.all([
		getThreadRows(f.env, undefined, [threadId]),
		getPostPage(f.env, undefined, { threadId, limit: 100, cursorPosition: null, last: false }),
		getPostRows(f.env, undefined, ids, threadId),
		getPostAttachments(f.env, undefined, ids, threadId),
	]);
	clearWrites();
}

describe("real SQL mutation invalidation", () => {
	it.each([
		["admin", adminPost.update, "/api/admin/posts/2"],
		["moderation", moderation.editPost, "/api/v1/moderation/posts/2"],
	] as const)(
		"%s content edits replace only the edited post entity",
		async (_name, handler, path) => {
			f.post(2);
			attachment(1, 2);
			await warm(1, [1, 2]);
			const unchanged = await Promise.all([
				key("post:entity", { postId: 1, threadId: 1 }),
				key("post:attachments", { postId: 2, threadId: 1 }),
				key("post:page", { threadId: 1, limit: 100, cursorPosition: null, last: false }),
			]);
			const response = await handler(request("PATCH", path, { content: "Edited body" }), f.env);
			expect(response.status).toBe(200);
			expectBumps([postEntityGenKey(2), adminEntityGenKey("posts")]);
			expect((await getPostRows(f.env, undefined, [2], 1)).get(2)?.content).toBe("Edited body");
			expect(
				await Promise.all([
					key("post:entity", { postId: 1, threadId: 1 }),
					key("post:attachments", { postId: 2, threadId: 1 }),
					key("post:page", { threadId: 1, limit: 100, cursorPosition: null, last: false }),
				]),
			).toEqual(unchanged);
		},
	);

	it.each([
		[
			"admin subject",
			adminThread.update,
			"/api/admin/threads/1",
			{ subject: "Renamed" },
			"subject",
			"Renamed",
		],
		["admin digest", adminThread.update, "/api/admin/threads/1", { digest: 2 }, "digest", 2],
		["admin close", adminThread.update, "/api/admin/threads/1", { closed: 1 }, "closed", 1],
		[
			"admin highlight",
			adminThread.update,
			"/api/admin/threads/1",
			{ highlight: 123 },
			"highlight",
			123,
		],
		[
			"mod digest",
			moderation.setDigest,
			"/api/v1/moderation/threads/1/digest",
			{ level: 2 },
			"digest",
			2,
		],
		[
			"mod close",
			moderation.setClose,
			"/api/v1/moderation/threads/1/close",
			{ closed: true },
			"closed",
			1,
		],
		[
			"mod highlight",
			moderation.setHighlight,
			"/api/v1/moderation/threads/1/highlight",
			{ color: "#abc" },
			"highlight",
			0xaabbcc,
		],
	] as const)(
		"%s refreshes shared fields without discarding list membership",
		async (_name, handler, path, body, field, value) => {
			await warm();
			const membership = await key("thread:list", {
				kind: "local",
				forumId: 1,
				typeId: null,
				limit: 17,
				offset: 170,
				cursorSticky: null,
				cursorTime: null,
				cursorId: null,
			});
			const response = await handler(request("PATCH", path, body), f.env);
			expect(response.status).toBe(200);
			expectBumps([
				adminEntityGenKey("threads"),
				threadMetaGenKey(1),
				recommendedGenKey(1),
				...(field === "digest" ? [digestGenKey(), adminEntityGenKey("users")] : []),
				...(field === "subject" ? [forumSummaryGenKey(), adminEntityGenKey("forums")] : []),
			]);
			expect((await getThreadRows(f.env, undefined, [1])).get(1)?.[field]).toBe(value);
			expect(
				await key("thread:list", {
					kind: "local",
					forumId: 1,
					typeId: null,
					limit: 17,
					offset: 170,
					cursorSticky: null,
					cursorTime: null,
					cursorId: null,
				}),
			).toBe(membership);
			if (field === "subject") {
				expect(
					f.sqlite.prepare("SELECT last_thread_subject FROM forums WHERE id = 1").get(),
				).toMatchObject({ last_thread_subject: "Renamed" });
			}
		},
	);

	it.each(["admin", "moderation"] as const)(
		"%s promotion invalidates demoted entities and deduplicates source forums",
		async (surface) => {
			f.thread(2, { forum_id: 2, sticky: STICKY_GLOBAL, digest: 1 });
			f.thread(3, { sticky: STICKY_GLOBAL });
			await getThreadRows(f.env, undefined, [1, 2, 3]);
			clearWrites();
			const response =
				surface === "admin"
					? await adminThread.update(
							request("PATCH", "/api/admin/threads/1", { sticky: STICKY_GLOBAL }),
							f.env,
						)
					: await moderation.setSticky(
							request("PATCH", "/api/v1/moderation/threads/1/sticky", { level: "global" }),
							f.env,
						);
			expect(response.status).toBe(200);
			expectBumps([
				adminEntityGenKey("threads"),
				threadMetaGenKey(1),
				threadMetaGenKey(2),
				threadMetaGenKey(3),
				threadListGenKey(1),
				threadListGenKey(2),
				threadListGenAllKey(),
				recommendedGenKey(1),
				recommendedGenKey(2),
				digestGenKey(),
			]);
			const rows = await getThreadRows(f.env, undefined, [1, 2, 3]);
			expect([rows.get(1)?.sticky, rows.get(2)?.sticky, rows.get(3)?.sticky]).toEqual([
				STICKY_GLOBAL,
				STICKY_FORUM,
				STICKY_FORUM,
			]);
		},
	);

	it.each([
		["admin", false],
		["moderation", false],
		["admin", true],
		["moderation", true],
	] as const)(
		"%s restore (global=%s) replaces child body and LONG asset generations",
		async (surface, global) => {
			attachment(1, 1);
			await warm();
			const before = await key("post:entity", { postId: 1, threadId: 1 });
			const assetBefore = await key("post:attachments", { postId: 1, threadId: 1 });
			f.sqlite
				.prepare("UPDATE threads SET sticky = ?, replies = 999 WHERE id = 1")
				.run(STICKY_MODERATED);
			f.sqlite.exec("UPDATE posts SET content = 'Restored body' WHERE id = 1");
			f.sqlite.exec("UPDATE attachments SET filename = 'restored.png' WHERE id = 1");
			expect(
				(await readPost(new Request("https://api.example.com/api/v1/posts/1"), f.env)).status,
			).toBe(404);
			const response =
				surface === "admin"
					? await adminThread.update(
							request("PATCH", "/api/admin/threads/1", { sticky: global ? STICKY_GLOBAL : 0 }),
							f.env,
						)
					: await moderation.setSticky(
							request("PATCH", "/api/v1/moderation/threads/1/sticky", {
								level: global ? "global" : "none",
							}),
							f.env,
						);
			expect(response.status).toBe(200);
			expectBumps([
				adminEntityGenKey("threads"),
				adminEntityGenKey("posts"),
				adminEntityGenKey("forums"),
				threadMetaGenKey(1),
				postListGenKey(1),
				threadListGenKey(1),
				forumSummaryGenKey(),
				recommendedGenKey(1),
				...(global ? [threadListGenAllKey()] : []),
			]);
			expect(await key("post:entity", { postId: 1, threadId: 1 })).not.toBe(before);
			expect(await key("post:attachments", { postId: 1, threadId: 1 })).not.toBe(assetBefore);
			expect(
				(await readPost(new Request("https://api.example.com/api/v1/posts/1"), f.env)).status,
			).toBe(200);
			expect((await getPostRows(f.env, undefined, [1], 1)).get(1)?.content).toBe("Restored body");
			expect((await getPostAttachments(f.env, undefined, [1], 1)).get(1)?.[0].filename).toBe(
				"restored.png",
			);
			expect((await getThreadRows(f.env, undefined, [1])).get(1)?.replies).toBe(0);
		},
	);

	it.each([
		["admin", adminThread.remove, "DELETE", "/api/admin/threads/1", undefined],
		[
			"admin batch",
			adminThread.batchDelete,
			"POST",
			"/api/admin/threads/batch-delete",
			{ ids: [1, 1, 999] },
		],
		["moderation", moderation.deleteThread, "DELETE", "/api/v1/moderation/threads/1", undefined],
	] as const)(
		"%s thread deletion blocks old cached children and invalidates global membership",
		async (_name, handler, method, path, body) => {
			f.sqlite.prepare("UPDATE threads SET sticky = ?, digest = 1 WHERE id = 1").run(STICKY_GLOBAL);
			f.post(2, { author_id: 20 });
			attachment(1, 2);
			f.insert("post_comments", {
				id: 1,
				post_id: 2,
				thread_id: 1,
				author_id: 20,
				content: "comment",
			});
			await warm(1, [1, 2]);
			const bodyBefore = await key("post:entity", { postId: 2, threadId: 1 });
			const response = await handler(request(method, path, body), f.env);
			expect(response.status).toBe(200);
			expectBumps([
				adminEntityGenKey("threads"),
				adminEntityGenKey("posts"),
				adminEntityGenKey("forums"),
				adminEntityGenKey("users"),
				adminEntityGenKey("attachments"),
				threadMetaGenKey(1),
				postListGenKey(1),
				threadListGenKey(1),
				forumSummaryGenKey(),
				recommendedGenKey(1),
				digestGenKey(),
				threadListGenAllKey(),
			]);
			expect(await key("post:entity", { postId: 2, threadId: 1 })).not.toBe(bodyBefore);
			expect(
				(await readPost(new Request("https://api.example.com/api/v1/posts/2"), f.env)).status,
			).toBe(404);
			expect((await getPostRows(f.env, undefined, [1, 2], 1)).size).toBe(0);
			expect((await getPostAttachments(f.env, undefined, [2], 1)).get(2)).toEqual([]);
			expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM post_comments").get()).toMatchObject({
				n: 0,
			});
		},
	);

	it("bulk deletion accepts 100 threads and replaces all child keys with no per-post epoch fan-out", async () => {
		const ids = Array.from({ length: 100 }, (_, i) => i + 1);
		for (const id of ids.slice(1)) {
			const forumId = id % 2 ? 1 : 2;
			f.thread(id, { forum_id: forumId });
			f.post(id, { thread_id: id, forum_id: forumId, is_first: 1 });
		}
		await getPostRowsBatch(
			f.env,
			undefined,
			ids.map((id) => ({ postId: id, threadId: id })),
		);
		const before = await key("post:entity", { postId: 100, threadId: 100 });
		clearWrites();
		const response = await adminThread.batchDelete(
			request("POST", "/api/admin/threads/batch-delete", { ids }),
			f.env,
		);
		expect((await response.json()).data.count).toBe(100);
		expectBumps([
			adminEntityGenKey("threads"),
			adminEntityGenKey("posts"),
			adminEntityGenKey("forums"),
			adminEntityGenKey("users"),
			adminEntityGenKey("attachments"),
			...ids.flatMap((id) => [threadMetaGenKey(id), postListGenKey(id)]),
			threadListGenKey(1),
			threadListGenKey(2),
			forumSummaryGenKey(),
			recommendedGenKey(1),
			recommendedGenKey(2),
		]);
		expect(await key("post:entity", { postId: 100, threadId: 100 })).not.toBe(before);
		expect((await getPostRowsBatch(f.env, undefined, [{ postId: 100, threadId: 100 }])).size).toBe(
			0,
		);
	});

	it.each([
		["admin", adminPost.remove, "DELETE", "/api/admin/posts/2", undefined],
		[
			"admin batch",
			adminPost.batchDelete,
			"POST",
			"/api/admin/posts/batch-delete",
			{ ids: [1, 2, 2] },
		],
		["moderation", moderation.deletePost, "DELETE", "/api/v1/moderation/posts/2", undefined],
	] as const)(
		"%s reply deletion repairs stats before refreshing page, entity, digest and global caches",
		async (_name, handler, method, path, body) => {
			f.sqlite
				.prepare(
					"UPDATE threads SET sticky = ?, digest = 1, replies = 1, last_post_at = 2 WHERE id = 1",
				)
				.run(STICKY_GLOBAL);
			f.post(2, { author_id: 20 });
			attachment(1, 2);
			await warm(1, [1, 2]);
			const response = await handler(request(method, path, body), f.env);
			expect(response.status).toBe(200);
			expectBumps([
				adminEntityGenKey("posts"),
				adminEntityGenKey("threads"),
				adminEntityGenKey("forums"),
				adminEntityGenKey("users"),
				adminEntityGenKey("attachments"),
				postEntityGenKey(2),
				postAttachmentsGenKey(2),
				threadMetaGenKey(1),
				postListGenKey(1),
				threadListGenKey(1),
				forumSummaryGenKey(),
				recommendedGenKey(1),
				digestGenKey(),
				threadListGenAllKey(),
			]);
			expect((await getThreadRows(f.env, undefined, [1])).get(1)).toMatchObject({
				replies: 0,
				last_post_at: 1,
			});
			expect(
				await getPostPage(f.env, undefined, {
					threadId: 1,
					limit: 100,
					cursorPosition: null,
					last: false,
				}),
			).toEqual([{ id: 1, position: 1 }]);
			expect((await getPostRows(f.env, undefined, [2], 1)).size).toBe(0);
		},
	);

	it.each([false, true])(
		"attachment deletion (batch=%s) bumps the owning post once after all removals",
		async (batch) => {
			f.post(2);
			attachment(1, 2);
			attachment(2, 2);
			attachment(3, 1);
			await warm(1, [1, 2]);
			const response = batch
				? await adminAttachment.batchDelete(
						request("POST", "/api/admin/attachments/batch-delete", { ids: [1, 2, 2, 999] }),
						f.env,
					)
				: await adminAttachment.remove(request("DELETE", "/api/admin/attachments/1"), f.env);
			expect(response.status).toBe(200);
			if (batch) expect((await response.json()).data.count).toBe(2);
			expectBumps([
				postAttachmentsGenKey(2),
				adminEntityGenKey("attachments"),
				adminEntityGenKey("users"),
			]);
			expect(
				(await getPostAttachments(f.env, undefined, [1, 2], 1)).get(2)?.map((row) => row.id),
			).toEqual(batch ? [] : [2]);
			expect((await getPostAttachments(f.env, undefined, [1], 1)).get(1)?.[0].id).toBe(3);
		},
	);

	it.each([
		["admin", adminThread.update, "/api/admin/threads/1", { forumId: 2 }],
		[
			"admin batch",
			adminThread.batchMove,
			"/api/admin/threads/batch-move",
			{ ids: [1, 1], forumId: 2 },
		],
		[
			"moderation",
			moderation.moveThread,
			"/api/v1/moderation/threads/1/move",
			{ targetForumId: 2 },
		],
	] as const)(
		"%s move refreshes source and target exactly once and enforces the destination gate",
		async (name, handler, path, body) => {
			f.sqlite.exec("UPDATE threads SET digest = 1 WHERE id = 1");
			f.insert("forum_recommended_threads", {
				forum_id: 1,
				thread_id: 1,
				recommended_by: 1,
				recommended_at: 1,
			});
			await warm();
			const response = await handler(
				request(name === "admin batch" ? "POST" : "PATCH", path, body),
				f.env,
			);
			expect(response.status).toBe(200);
			expectBumps([
				adminEntityGenKey("threads"),
				adminEntityGenKey("posts"),
				adminEntityGenKey("forums"),
				threadMetaGenKey(1),
				postListGenKey(1),
				threadListGenKey(1),
				threadListGenKey(2),
				forumSummaryGenKey(),
				recommendedGenKey(1),
				recommendedGenKey(2),
				digestGenKey(),
			]);
			expect((await getPostRows(f.env, undefined, [1], 1)).get(1)?.forum_id).toBe(2);
			expect((await getThreadRows(f.env, undefined, [1])).get(1)?.is_recommended).toBe(0);
			expect(
				(await readPost(new Request("https://api.example.com/api/v1/posts/1"), f.env)).status,
			).toBe(403);
		},
	);

	it("forum merge waits for metadata repair before all epoch changes", async () => {
		f.sqlite.prepare("UPDATE threads SET sticky = ? WHERE id = 1").run(STICKY_GLOBAL);
		f.thread(2);
		f.post(2, { thread_id: 2, is_first: 1 });
		f.insert("forum_recommended_threads", {
			forum_id: 1,
			thread_id: 1,
			recommended_by: 1,
			recommended_at: 1,
		});
		await warm();
		const entered = deferred();
		const release = deferred();
		f.state.beforeWrite = async (sql) => {
			if (sql.startsWith("UPDATE forums SET last_thread_id")) {
				entered.resolve();
				await release.promise;
			}
		};
		const merging = adminForum.merge(
			request("POST", "/api/admin/forums/1/merge", { targetForumId: 2 }),
			f.env,
		);
		await entered.promise;
		try {
			expectBumps([]);
			expect(f.sqlite.prepare("SELECT id FROM forums WHERE id = 1").get()).toBeUndefined();
		} finally {
			release.resolve();
		}
		expect((await merging).status).toBe(200);
		expectBumps([
			adminEntityGenKey("forums"),
			adminEntityGenKey("threads"),
			adminEntityGenKey("posts"),
			adminEntityGenKey("forum_thread_types"),
			threadMetaGenKey(1),
			postListGenKey(1),
			threadMetaGenKey(2),
			postListGenKey(2),
			threadListGenKey(1),
			threadListGenKey(2),
			threadListGenAllKey(),
			forumTreeGenKey(),
			forumSummaryGenKey(),
			digestGenKey(),
			recommendedGenKey(1),
			recommendedGenKey(2),
		]);
		expect(f.sqlite.prepare("SELECT last_thread_id FROM forums WHERE id = 2").get()).toMatchObject({
			last_thread_id: 2,
		});
		expect((await getThreadRows(f.env, undefined, [1])).get(1)).toMatchObject({
			forum_id: 2,
			is_recommended: 0,
		});
	});

	it.each([false, true])(
		"forum visibility/status updates (global=%s) invalidate scoped lists and keep fresh gates",
		async (global) => {
			if (global) f.sqlite.prepare("UPDATE threads SET sticky = ? WHERE id = 1").run(STICKY_GLOBAL);
			await warm();
			const response = await adminForum.update(
				request("PATCH", "/api/admin/forums/1", global ? { status: 0 } : { visibility: "staff" }),
				f.env,
			);
			expect(response.status).toBe(200);
			expectBumps([
				adminEntityGenKey("forums"),
				forumTreeGenKey(),
				forumSummaryGenKey(),
				digestGenKey(),
				threadListGenKey(1),
				recommendedGenKey(1),
				...(global ? [threadListGenAllKey()] : []),
			]);
			expect(
				(await readPost(new Request("https://api.example.com/api/v1/posts/1"), f.env)).status,
			).toBe(global ? 404 : 403);
		},
	);

	it("reorders all 200 legal items using at most 100 bindings per statement", async () => {
		for (let id = 4; id <= 200; id++) f.insert("forums", { id, name: `Forum ${id}` });
		const orders = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, displayOrder: 200 - i }));
		const response = await adminForum.reorder(
			request("POST", "/api/admin/forums/reorder", { orders }),
			f.env,
		);
		expect(response.status).toBe(200);
		expect((await response.json()).data.count).toBe(200);
		expect(f.sqlite.prepare("SELECT display_order FROM forums WHERE id = 200").get()).toMatchObject(
			{ display_order: 1 },
		);
		expectBumps([forumTreeGenKey(), forumSummaryGenKey(), adminEntityGenKey("forums")]);
	});

	it("a failed deletion transaction neither removes content nor bumps generations", async () => {
		f.post(2);
		attachment(1, 2);
		await warm(1, [1, 2]);
		f.state.beforeWrite = async (sql) => {
			if (sql.startsWith("DELETE FROM posts")) throw new Error("D1 write failed");
		};
		await expect(adminPost.remove(request("DELETE", "/api/admin/posts/2"), f.env)).rejects.toThrow(
			"D1 write failed",
		);
		expectBumps([]);
		expect(f.sqlite.prepare("SELECT id FROM posts WHERE id = 2").get()).toMatchObject({ id: 2 });
		expect(f.sqlite.prepare("SELECT id FROM attachments WHERE id = 1").get()).toMatchObject({
			id: 1,
		});
	});

	it("failed epoch writes do not reject an already committed mutation", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		f.post(2);
		await warm(1, [1, 2]);
		f.state.writeError = true;
		const response = await adminPost.remove(request("DELETE", "/api/admin/posts/2"), f.env);
		expect(response.status).toBe(200);
		expect(f.sqlite.prepare("SELECT id FROM posts WHERE id = 2").get()).toBeUndefined();
	});
});

function userContent() {
	f.thread(2, { author_id: 20, forum_id: 2, sticky: STICKY_GLOBAL, digest: 1 });
	f.thread(3, { author_id: 20 });
	f.post(2, { author_id: 20 });
	f.post(3, { author_id: 20, thread_id: 2, forum_id: 2, is_first: 1 });
	f.post(4, { thread_id: 2, forum_id: 2 });
	f.post(5, { author_id: 20, thread_id: 3, is_first: 1 });
	attachment(1, 2, 1, 20);
	attachment(2, 4, 2, 10);
	attachment(3, 5, 3, 10);
	attachment(4, 5, 3, 20);
}

describe("user content invalidation uses the deletion snapshot", () => {
	it("reports owned and surviving thread flags plus attachment post IDs without another snapshot SELECT", async () => {
		userContent();
		const result = await deleteUserContent(f.env, 10, { deleteOwnAttachments: true });
		expect(result).toMatchObject({
			threadsDeleted: 1,
			postsDeleted: 3,
			affectedThreadIds: [1, 2],
			affectedForumIds: [1, 2],
			hadGlobalThread: true,
			hadDigestThread: true,
			attachmentPostIds: [4, 5],
			collateralAuthorIds: [20],
		});
		expect(f.calls.filter((call) => /^\s*SELECT\b/i.test(call.sql))).toHaveLength(3);
	});

	it.each([
		["ban-delete", adminUser.ban, "/api/admin/users/10/ban", { deleteContent: true }, false],
		["nuke", adminUser.nuke, "/api/admin/users/10/nuke", undefined, false],
		["moderation nuke", moderation.nukeUser, "/api/v1/moderation/users/10/nuke", undefined, true],
		["purge", adminUser.purge, "/api/admin/users/10/purge", { confirm: "ok" }, true],
	] as const)(
		"%s refreshes survivor stats/global order and removes LONG uploads when requested",
		async (_name, handler, path, body, ownUploads) => {
			userContent();
			await f.env.DB.batch(buildContentRecalcStatements(f.env, [1, 2, 3], [1, 2]));
			await warm(1, [1, 2]);
			await warm(2, [3, 4]);
			await warm(3, [5]);
			await getUserProfiles(f.env, undefined, [10, 20]);
			const unrelatedBody = await key("post:entity", { postId: 5, threadId: 3 });
			clearWrites();
			const response = await handler(request("POST", path, body), f.env);
			expect(response.status).toBe(200);
			const bumped = generations();
			for (const k of [
				adminEntityGenKey("users"),
				adminEntityGenKey("threads"),
				adminEntityGenKey("posts"),
				adminEntityGenKey("forums"),
				adminEntityGenKey("attachments"),
				threadMetaGenKey(1),
				postListGenKey(1),
				threadMetaGenKey(2),
				postListGenKey(2),
				threadListGenKey(1),
				threadListGenKey(2),
				threadListGenAllKey(),
				digestGenKey(),
				forumSummaryGenKey(),
				recommendedGenKey(1),
				recommendedGenKey(2),
			])
				expect(bumped.filter((value) => value === k)).toHaveLength(1);
			expect(bumped).not.toContain(threadMetaGenKey(3));
			expect(bumped).not.toContain(postListGenKey(3));
			expect(bumped.includes(postAttachmentsGenKey(5))).toBe(ownUploads);
			expect(await key("post:entity", { postId: 5, threadId: 3 })).toBe(unrelatedBody);
			expect((await getThreadRows(f.env, undefined, [2])).get(2)).toMatchObject({
				replies: 0,
				last_post_at: 3,
			});
			expect(
				(
					await getPostRowsBatch(f.env, undefined, [
						{ postId: 1, threadId: 1 },
						{ postId: 2, threadId: 1 },
						{ postId: 4, threadId: 2 },
					])
				).size,
			).toBe(0);
			expect(
				(await getPostAttachments(f.env, undefined, [5], 3)).get(5)?.map((row) => row.id),
			).toEqual(ownUploads ? [4] : [3, 4]);
			expect(vi.mocked(f.env.KV.delete).mock.calls.map(([k]) => k)).toEqual(
				expect.arrayContaining([userMiniCacheKey(10), userMiniCacheKey(20)]),
			);
		},
	);

	it.each([
		["admin ban", adminUser.ban, "/api/admin/users/10/ban", 0, -1],
		["admin unban", adminUser.unban, "/api/admin/users/10/unban", -1, 0],
		["mod mute", moderation.muteUser, "/api/v1/moderation/users/10/mute", 0, -2],
		["mod unmute", moderation.unmuteUser, "/api/v1/moderation/users/10/unmute", -2, 0],
		["mod ban", moderation.banUser, "/api/v1/moderation/users/10/ban", 0, -1],
		["mod unban", moderation.unbanUser, "/api/v1/moderation/users/10/unban", -1, 0],
	] as const)(
		"%s evicts the user profile only after the status write",
		async (_name, handler, path, from, to) => {
			f.sqlite.prepare("UPDATE users SET status = ? WHERE id = 10").run(from);
			await getUserProfiles(f.env, undefined, [10]);
			const entered = deferred();
			const release = deferred();
			f.state.beforeWrite = async (sql) => {
				if (sql.startsWith("UPDATE users SET status")) {
					entered.resolve();
					await release.promise;
				}
			};
			clearWrites();
			const updating = handler(request("POST", path), f.env);
			await entered.promise;
			try {
				expect(f.values.has(userMiniCacheKey(10))).toBe(true);
				expect(f.env.KV.delete).not.toHaveBeenCalled();
			} finally {
				release.resolve();
			}
			expect((await updating).status).toBe(200);
			expect(f.values.has(userMiniCacheKey(10))).toBe(false);
			expect(f.sqlite.prepare("SELECT status FROM users WHERE id = 10").get()).toMatchObject({
				status: to,
			});
			expectBumps([adminEntityGenKey("users")]);
		},
	);

	it.each([
		["single", adminUser.recalcCounters, "/api/admin/users/10/recalc-counters", undefined],
		[
			"batch",
			adminUser.batchRecalcCounters,
			"/api/admin/users/batch-recalc-counters",
			{ ids: [10, 10] },
		],
	] as const)(
		"%s user recalc finishes before profile invalidation and deduplicates IDs",
		async (_name, handler, path, body) => {
			await getUserProfiles(f.env, undefined, [10]);
			const entered = deferred();
			const release = deferred();
			f.state.beforeWrite = async (sql) => {
				if (/UPDATE users SET\s+threads/.test(sql)) {
					entered.resolve();
					await release.promise;
				}
			};
			clearWrites();
			const updating = handler(request("POST", path, body), f.env);
			await entered.promise;
			try {
				expect(f.env.KV.delete).not.toHaveBeenCalled();
			} finally {
				release.resolve();
			}
			expect((await updating).status).toBe(200);
			expect(
				vi.mocked(f.env.KV.delete).mock.calls.filter(([k]) => k === userMiniCacheKey(10)),
			).toHaveLength(1);
			expect(
				f.sqlite.prepare("SELECT threads, posts FROM users WHERE id = 10").get(),
			).toMatchObject({ threads: 1, posts: 1 });
			expectBumps([adminEntityGenKey("users")]);
		},
	);
});
