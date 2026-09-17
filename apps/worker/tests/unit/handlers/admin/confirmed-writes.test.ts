import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAttachment from "../../../../src/handlers/admin/attachment";
import * as adminForum from "../../../../src/handlers/admin/forum";
import * as adminPost from "../../../../src/handlers/admin/post";
import * as adminThread from "../../../../src/handlers/admin/thread";
import * as adminUser from "../../../../src/handlers/admin/user";
import * as moderation from "../../../../src/handlers/moderation";
import { editThreadSubject } from "../../../../src/handlers/thread-edit";
import { deleteMyPost, deleteMyThread, editMyPost } from "../../../../src/handlers/user-content";
import type { Env } from "../../../../src/lib/env";
import { createAdminRequest, createJwtForRole, createMockR2 } from "../../../helpers";
import { deferred, readingFixture } from "../../lib/cache/thread-cache-fixture";

type Mutation = {
	name: string;
	handler: (request: Request, env: Env) => Promise<Response>;
	method: string;
	path: string;
	body?: unknown;
	userId?: number;
	setup?: () => void;
	batch?: boolean;
};

let f: ReturnType<typeof readingFixture>;
let tokens: Record<number, string>;

beforeAll(async () => {
	tokens = { 1: await createJwtForRole(1, 1), 10: await createJwtForRole(0, 10) };
});

beforeEach(() => {
	f = readingFixture();
	f.env.R2 = createMockR2();
	f.thread(1, { replies: 1, digest: 1 });
	f.post(1);
	f.post(2);
	f.thread(2, { forum_id: 2, author_id: 20 });
	f.post(3, { thread_id: 2, forum_id: 2, author_id: 20, is_first: 1 });
	f.insert("attachments", {
		id: 1,
		post_id: 2,
		thread_id: 1,
		author_id: 10,
		filename: "asset.png",
		file_path: "assets/asset.png",
	});
	f.sqlite.exec("UPDATE users SET threads = 1, posts = 2, digest_posts = 1 WHERE id = 10");
	f.sqlite.exec("UPDATE forums SET threads = 1, posts = 2 WHERE id = 1");
	const batch = f.env.DB.batch.bind(f.env.DB);
	f.env.DB.batch = async <T>(statements: D1PreparedStatement[]) => {
		f.sqlite.exec("BEGIN");
		try {
			const results = await batch<T>(statements);
			f.sqlite.exec(results.some((row) => !row.success) ? "ROLLBACK" : "COMMIT");
			return results;
		} catch (error) {
			f.sqlite.exec("ROLLBACK");
			throw error;
		}
	};
});

afterEach(() => {
	expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
	f.close();
	vi.restoreAllMocks();
});

function snapshot() {
	return ["forums", "threads", "posts", "attachments", "users", "admin_logs"].map((table) =>
		f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
	);
}

function request(mutation: Mutation) {
	const req = createAdminRequest(mutation.method, mutation.path, mutation.body);
	req.headers.set("Authorization", `Bearer ${tokens[mutation.userId ?? 1]}`);
	return req;
}

function expectNoPublishedMutation() {
	expect(
		vi
			.mocked(f.env.KV.put)
			.mock.calls.map(([key]) => key)
			.filter((key) => /:gen(?::|$)/.test(key)),
	).toEqual([]);
	expect(f.env.KV.delete).not.toHaveBeenCalled();
	expect(f.env.R2.delete).not.toHaveBeenCalled();
	expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_logs").get()?.count).toBe(0);
}

async function expectFailure(mutation: Mutation) {
	const result = await mutation.handler(request(mutation), f.env).then(
		(response) => ({ response }),
		(error: unknown) => ({ error }),
	);
	if ("response" in result) expect(result.response.status).toBeGreaterThanOrEqual(500);
	else expect(result.error).toBeInstanceOf(Error);
	expectNoPublishedMutation();
}

/** Only selected D1 results fail; every other read/write still executes SQLite. */
function failStatements(matches: (sql: string) => boolean) {
	const prepare = f.env.DB.prepare.bind(f.env.DB);
	const failed = vi.fn();
	vi.spyOn(f.env.DB, "prepare").mockImplementation((sql) => {
		function wrap(statement: D1PreparedStatement): D1PreparedStatement {
			const failure = () => {
				failed(sql);
				return {
					success: false,
					results: [],
					error: "D1 rejected statement",
					meta: { changes: 0 },
				};
			};
			return {
				...statement,
				bind: (...values: unknown[]) => wrap(statement.bind(...values)),
				run: async <T>() =>
					matches(sql) ? (failure() as unknown as D1Result<T>) : statement.run<T>(),
				all: async <T>() =>
					matches(sql) ? (failure() as unknown as D1Result<T>) : statement.all<T>(),
			};
		}
		return wrap(prepare(sql));
	});
	return failed;
}

const globalThread = () => f.sqlite.exec("UPDATE threads SET sticky = 2 WHERE id = 2");
const hiddenThread = () => f.sqlite.exec("UPDATE threads SET sticky = -2 WHERE id = 1");
const bannedUser = () => f.sqlite.exec("UPDATE users SET status = -1 WHERE id = 10");
const mutedUser = () => f.sqlite.exec("UPDATE users SET status = -2 WHERE id = 10");

const mutations: Mutation[] = [
	{
		name: "admin thread update",
		handler: adminThread.update,
		method: "PATCH",
		path: "/api/admin/threads/1",
		body: { subject: "Renamed" },
	},
	{
		name: "admin thread delete",
		handler: adminThread.remove,
		method: "DELETE",
		path: "/api/admin/threads/1",
		batch: true,
	},
	{
		name: "admin thread batch-delete",
		handler: adminThread.batchDelete,
		method: "POST",
		path: "/api/admin/threads/batch-delete",
		body: { ids: [1] },
		batch: true,
	},
	{
		name: "admin thread batch-move",
		handler: adminThread.batchMove,
		method: "POST",
		path: "/api/admin/threads/batch-move",
		body: { ids: [1], forumId: 2 },
		batch: true,
	},
	{
		name: "admin post update",
		handler: adminPost.update,
		method: "PATCH",
		path: "/api/admin/posts/2",
		body: { content: "Edited" },
	},
	{
		name: "admin post delete",
		handler: adminPost.remove,
		method: "DELETE",
		path: "/api/admin/posts/2",
		batch: true,
	},
	{
		name: "admin post batch-delete",
		handler: adminPost.batchDelete,
		method: "POST",
		path: "/api/admin/posts/batch-delete",
		body: { ids: [2] },
		batch: true,
	},
	{
		name: "admin attachment delete",
		handler: adminAttachment.remove,
		method: "DELETE",
		path: "/api/admin/attachments/1",
	},
	{
		name: "admin attachment batch-delete RETURNING",
		handler: adminAttachment.batchDelete,
		method: "POST",
		path: "/api/admin/attachments/batch-delete",
		body: { ids: [1] },
	},
	{
		name: "admin forum create",
		handler: adminForum.create,
		method: "POST",
		path: "/api/admin/forums",
		body: { name: "Created" },
	},
	{
		name: "admin forum update",
		handler: adminForum.update,
		method: "PATCH",
		path: "/api/admin/forums/1",
		body: { visibility: "members" },
	},
	{
		name: "admin forum delete",
		handler: adminForum.remove,
		method: "DELETE",
		path: "/api/admin/forums/3",
	},
	{
		name: "admin forum merge",
		handler: adminForum.merge,
		method: "POST",
		path: "/api/admin/forums/1/merge",
		body: { targetForumId: 2 },
		batch: true,
	},
	{
		name: "admin forum reorder",
		handler: adminForum.reorder,
		method: "POST",
		path: "/api/admin/forums/reorder",
		body: { orders: [{ id: 1, displayOrder: 7 }] },
		batch: true,
	},
	{
		name: "admin user update",
		handler: adminUser.update,
		method: "PATCH",
		path: "/api/admin/users/10",
		body: { email: "changed@example.com" },
	},
	{
		name: "admin user ban",
		handler: adminUser.ban,
		method: "POST",
		path: "/api/admin/users/10/ban",
		body: {},
	},
	{
		name: "admin user unban",
		handler: adminUser.unban,
		method: "POST",
		path: "/api/admin/users/10/unban",
		setup: bannedUser,
	},
	{
		name: "admin user ban and delete",
		handler: adminUser.ban,
		method: "POST",
		path: "/api/admin/users/10/ban",
		body: { deleteContent: true },
		batch: true,
	},
	{
		name: "admin user nuke",
		handler: adminUser.nuke,
		method: "POST",
		path: "/api/admin/users/10/nuke",
		batch: true,
	},
	{
		name: "admin user purge",
		handler: adminUser.purge,
		method: "POST",
		path: "/api/admin/users/10/purge",
		body: { confirm: "ok" },
		batch: true,
	},
	{
		name: "admin user batch-status",
		handler: adminUser.batchStatus,
		method: "POST",
		path: "/api/admin/users/batch-status",
		body: { ids: [10], status: -1 },
	},
	{
		name: "admin user batch-role",
		handler: adminUser.batchRole,
		method: "POST",
		path: "/api/admin/users/batch-role",
		body: { ids: [10], role: 3 },
	},
	{
		name: "admin user counters",
		handler: adminUser.recalcCounters,
		method: "POST",
		path: "/api/admin/users/10/recalc-counters",
	},
	{
		name: "admin user batch-counters",
		handler: adminUser.batchRecalcCounters,
		method: "POST",
		path: "/api/admin/users/batch-recalc-counters",
		body: { ids: [10] },
		batch: true,
	},
	{
		name: "moderation sticky",
		handler: moderation.setSticky,
		method: "PATCH",
		path: "/api/v1/moderation/threads/1/sticky",
		body: { level: "forum" },
		batch: true,
	},
	{
		name: "moderation global sticky",
		handler: moderation.setSticky,
		method: "PATCH",
		path: "/api/v1/moderation/threads/1/sticky",
		body: { level: "global" },
		setup: globalThread,
		batch: true,
	},
	{
		name: "moderation restore",
		handler: moderation.setSticky,
		method: "PATCH",
		path: "/api/v1/moderation/threads/1/sticky",
		body: { level: "none" },
		setup: hiddenThread,
		batch: true,
	},
	{
		name: "moderation digest",
		handler: moderation.setDigest,
		method: "PATCH",
		path: "/api/v1/moderation/threads/1/digest",
		body: { level: 2 },
	},
	{
		name: "moderation close",
		handler: moderation.setClose,
		method: "PATCH",
		path: "/api/v1/moderation/threads/1/close",
		body: { closed: true },
	},
	{
		name: "moderation highlight",
		handler: moderation.setHighlight,
		method: "PATCH",
		path: "/api/v1/moderation/threads/1/highlight",
		body: { color: "#abc" },
	},
	{
		name: "moderation move",
		handler: moderation.moveThread,
		method: "PATCH",
		path: "/api/v1/moderation/threads/1/move",
		body: { targetForumId: 2 },
		batch: true,
	},
	{
		name: "moderation post delete",
		handler: moderation.deletePost,
		method: "DELETE",
		path: "/api/v1/moderation/posts/2",
		batch: true,
	},
	{
		name: "moderation thread delete",
		handler: moderation.deleteThread,
		method: "DELETE",
		path: "/api/v1/moderation/threads/1",
		batch: true,
	},
	{
		name: "moderation post edit",
		handler: moderation.editPost,
		method: "PATCH",
		path: "/api/v1/moderation/posts/2",
		body: { content: "Edited" },
	},
	{
		name: "moderation mute",
		handler: moderation.muteUser,
		method: "POST",
		path: "/api/v1/moderation/users/10/mute",
	},
	{
		name: "moderation unmute",
		handler: moderation.unmuteUser,
		method: "POST",
		path: "/api/v1/moderation/users/10/unmute",
		setup: mutedUser,
	},
	{
		name: "moderation ban",
		handler: moderation.banUser,
		method: "POST",
		path: "/api/v1/moderation/users/10/ban",
	},
	{
		name: "moderation unban",
		handler: moderation.unbanUser,
		method: "POST",
		path: "/api/v1/moderation/users/10/unban",
		setup: bannedUser,
	},
	{
		name: "moderation nuke",
		handler: moderation.nukeUser,
		method: "POST",
		path: "/api/v1/moderation/users/10/nuke",
		batch: true,
	},
	{
		name: "author thread subject",
		handler: editThreadSubject,
		method: "PATCH",
		path: "/api/v1/threads/1",
		body: { subject: "Renamed" },
		userId: 10,
	},
	{
		name: "author post delete",
		handler: deleteMyPost,
		method: "DELETE",
		path: "/api/v1/me/posts/2",
		userId: 10,
		batch: true,
	},
	{
		name: "author thread delete",
		handler: deleteMyThread,
		method: "DELETE",
		path: "/api/v1/me/threads/1",
		userId: 10,
		batch: true,
	},
	{
		name: "author post edit",
		handler: editMyPost,
		method: "PATCH",
		path: "/api/v1/me/posts/2",
		body: { content: "Edited" },
		userId: 10,
	},
];

describe("unconfirmed primary mutations", () => {
	it.each(mutations)(
		"$name refuses false-success without cache, audit or R2 side effects",
		async (mutation) => {
			mutation.setup?.();
			const before = snapshot();
			const failed = failStatements((sql) => !/^\s*SELECT\b/i.test(sql));
			await expectFailure(mutation);
			expect(failed).toHaveBeenCalled();
			expect(snapshot()).toEqual(before);
		},
	);

	it.each(mutations.filter((mutation) => mutation.batch))(
		"$name refuses an incomplete mutation batch",
		async (mutation) => {
			mutation.setup?.();
			const before = snapshot();
			const batch = f.env.DB.batch.bind(f.env.DB);
			const failed = vi.fn();
			vi.spyOn(f.env.DB, "batch").mockImplementation(async (statements) => {
				if (
					statements.every((statement) =>
						/^\s*SELECT\b/i.test((statement as unknown as { __sql: string }).__sql),
					)
				)
					return batch(statements);
				failed();
				return statements
					.slice(0, -1)
					.map(() => ({ success: true, results: [], meta: { changes: 0 } })) as D1Result[];
			});
			await expectFailure(mutation);
			expect(failed).toHaveBeenCalledTimes(1);
			expect(snapshot()).toEqual(before);
		},
	);
});

const mutation = (name: string) => {
	const found = mutations.find((item) => item.name === name);
	if (!found) throw new Error(`Unknown mutation ${name}`);
	return found;
};

const contentMutations = [
	"admin user ban and delete",
	"admin user nuke",
	"moderation nuke",
	"admin user purge",
];

describe("user deletion transaction confirmation", () => {
	beforeEach(() => {
		// Deleting Alice also repairs a surviving thread and Bob's reply count.
		f.post(4, { thread_id: 2, forum_id: 2, position: 2 });
		f.post(5, { author_id: 20, author_name: "bob", position: 3 });
		f.sqlite.exec("UPDATE threads SET replies = 2 WHERE id = 1");
		f.sqlite.exec("UPDATE threads SET replies = 1 WHERE id = 2");
		f.sqlite.exec("UPDATE users SET posts = 3, credits = 80, coins = 20 WHERE id = 10");
		f.sqlite.exec("UPDATE users SET threads = 1, posts = 2 WHERE id = 20");
	});

	it.each([
		...contentMutations.flatMap((name) => [
			{ name, stage: "survivor metadata", pattern: /^\s*WITH latest[\s\S]*UPDATE threads SET/ },
			{ name, stage: "forum metadata", pattern: /^\s*WITH latest[\s\S]*UPDATE forums SET/ },
			{ name, stage: "collateral counters", pattern: /UPDATE users SET posts = MAX/ },
			{
				name,
				stage: "final account write",
				pattern:
					name === "admin user purge"
						? /^UPDATE users SET username =/
						: /^UPDATE users SET status = -1, threads = 0/,
			},
		]),
		{ name: "admin user purge", stage: "transaction audit", pattern: /INSERT INTO admin_logs/ },
	])("$name rolls back earlier real deletions when $stage fails", async ({ name, pattern }) => {
		const before = snapshot();
		const failed = failStatements((sql) => {
			if (!pattern.test(sql)) return false;
			// These reads observe the transaction before rollback, proving that
			// successful earlier statements really ran before the late failure.
			expect(f.sqlite.prepare("SELECT id FROM threads WHERE id = 1").get()).toBeUndefined();
			expect(f.sqlite.prepare("SELECT id FROM posts WHERE id = 4").get()).toBeUndefined();
			return true;
		});
		await expectFailure(mutation(name));
		expect(failed).toHaveBeenCalledTimes(1);
		expect(snapshot()).toEqual(before);
	});

	it.each(contentMutations)(
		"%s rejects an incomplete ownership snapshot before writing",
		async (name) => {
			const before = snapshot();
			const batch = f.env.DB.batch.bind(f.env.DB);
			const calls = vi.spyOn(f.env.DB, "batch").mockImplementationOnce(async (statements) => {
				const results = await batch(statements);
				return results.slice(0, -1);
			});
			await expectFailure(mutation(name));
			expect(calls).toHaveBeenCalledTimes(1);
			expect(f.calls.some((call) => call.mode === "run")).toBe(false);
			expect(snapshot()).toEqual(before);
		},
	);

	it.each(["lost", "incomplete", "false-success"] as const)(
		"purge confirms a committed tombstone after a %s batch response",
		async (failure) => {
			const action = mutation("admin user purge");
			const batch = f.env.DB.batch.bind(f.env.DB);
			const calls = vi.spyOn(f.env.DB, "batch").mockImplementation(async (statements) => {
				const results = await batch(statements);
				if (f.sqlite.prepare("SELECT status FROM users WHERE id = 10").get()?.status !== -99)
					return results;
				if (failure === "lost") throw new Error("D1 response lost after commit");
				if (failure === "incomplete") return results.slice(0, -1);
				return results.map((result, index) =>
					index === results.length - 1
						? ({ ...result, success: false } as unknown as D1Result)
						: result,
				);
			});
			const response = await action.handler(request(action), f.env);
			expect(response.status).toBe(200);
			expect((await response.json()).data).toMatchObject({
				purged: true,
				deleted: { threads: 1, posts: 4 },
				r2: { deletedCount: 2, failed: [] },
			});
			expect(calls).toHaveBeenCalledTimes(2);
			expect(
				f.calls.filter((call) => call.sql === "SELECT status FROM users WHERE id = ?"),
			).toHaveLength(1);
			expect(f.sqlite.prepare("SELECT action FROM admin_logs").all()).toEqual([
				{ action: "user.purge" },
			]);
			expect(f.sqlite.prepare("SELECT posts FROM users WHERE id = 20").get()?.posts).toBe(1);
			expect(
				vi.mocked(f.env.KV.put).mock.calls.filter(([key]) => key === "thread:meta:gen:1"),
			).toHaveLength(1);
			expect(f.env.R2.delete).toHaveBeenCalledExactlyOnceWith(["assets/asset.png", "alice.jpg"]);
		},
	);
});

it.each([
	{ name: "admin thread update", pattern: /UPDATE forums SET last_thread_id/ },
	{ name: "admin forum merge", pattern: /UPDATE forums SET last_thread_id/ },
	{ name: "moderation move", pattern: /UPDATE forums SET last_thread_id/ },
	{ name: "author post delete", pattern: /UPDATE users SET posts = MAX/ },
	{ name: "author post delete", pattern: /UPDATE threads SET last_post_at/ },
	{ name: "author post delete", pattern: /UPDATE forums SET last_thread_id/ },
	{ name: "author thread delete", pattern: /UPDATE users SET threads = MAX/ },
	{ name: "author thread delete", pattern: /UPDATE users SET posts = MAX/ },
	{ name: "author thread delete", pattern: /UPDATE forums SET last_thread_id/ },
])("$name stops after an unconfirmed derived write ($pattern)", async ({ name, pattern }) => {
	const action = mutation(name);
	const before = snapshot();
	const failed = failStatements((sql) => pattern.test(sql));
	await expectFailure(action);
	expect(failed).toHaveBeenCalled();
	expect(snapshot()).not.toEqual(before);
});

it.each([
	{ body: { forumId: 2 }, pattern: /UPDATE posts SET forum_id/, setup: () => {} },
	{
		body: { sticky: 2 },
		pattern: /UPDATE threads SET sticky = 1 WHERE sticky = 2/,
		setup: globalThread,
	},
	{ body: { sticky: 0 }, pattern: /^\s*WITH latest/, setup: hiddenThread },
])(
	"admin thread update stops an unconfirmed afterUpdate write ($pattern)",
	async ({ body, pattern, setup }) => {
		setup();
		const before = snapshot();
		const failed = failStatements((sql) => pattern.test(sql));
		await expectFailure({ ...mutation("admin thread update"), body });
		expect(failed).toHaveBeenCalled();
		expect(snapshot()).not.toEqual(before);
	},
);

it.each([
	{ name: "admin thread delete", pattern: /SELECT author_id, COUNT/ },
	{ name: "admin thread batch-delete", pattern: /SELECT id, forum_id, author_id, digest, sticky/ },
	{ name: "admin thread batch-delete", pattern: /SELECT thread_id, author_id, COUNT/ },
	{ name: "admin thread batch-move", pattern: /SELECT id, forum_id, replies, sticky, digest/ },
	{
		name: "admin post batch-delete",
		pattern: /SELECT id, thread_id, forum_id, author_id, is_first/,
	},
	{ name: "admin post batch-delete", pattern: /SELECT id, sticky, digest FROM threads/ },
	{ name: "admin forum merge", pattern: /SELECT id, sticky FROM threads/ },
	{ name: "admin forum reorder", pattern: /SELECT id, display_order FROM forums/ },
	{ name: "admin user batch-status", pattern: /SELECT id FROM users WHERE id IN/ },
	{ name: "admin user batch-role", pattern: /SELECT id FROM users WHERE id IN/ },
	{ name: "admin user batch-counters", pattern: /SELECT id FROM users WHERE id IN/ },
	{
		name: "admin user ban and delete",
		pattern: /SELECT id, forum_id, digest, sticky FROM threads/,
	},
	{ name: "admin user nuke", pattern: /SELECT p.id, p.thread_id/ },
	{ name: "admin user purge", pattern: /SELECT DISTINCT file_path, post_id/ },
	{ name: "moderation global sticky", pattern: /SELECT id, forum_id FROM threads WHERE sticky/ },
	{ name: "moderation thread delete", pattern: /SELECT author_id FROM posts/ },
	{ name: "moderation nuke", pattern: /SELECT p.id, p.thread_id/ },
	{ name: "author thread delete", pattern: /SELECT author_id FROM posts/ },
])("$name rejects a failed mutation snapshot ($pattern)", async ({ name, pattern }) => {
	const action = mutation(name);
	action.setup?.();
	const before = snapshot();
	const failed = failStatements((sql) => pattern.test(sql));
	await expectFailure(action);
	expect(failed).toHaveBeenCalled();
	expect(snapshot()).toEqual(before);
});

it("implicit admin user counter recalc rejects a failed active-user enumeration", async () => {
	const before = snapshot();
	const failed = failStatements((sql) => /SELECT id FROM users WHERE status >= 0 LIMIT/.test(sql));
	await expectFailure({ ...mutation("admin user batch-counters"), body: {} });
	expect(failed).toHaveBeenCalledTimes(1);
	expect(snapshot()).toEqual(before);
});

it("thread deletion waits for batch confirmation before invalidating and auditing", async () => {
	const action = mutation("admin thread delete");
	const batch = f.env.DB.batch.bind(f.env.DB);
	const committed = deferred();
	const confirmation = deferred();
	vi.spyOn(f.env.DB, "batch").mockImplementationOnce(async (statements) => {
		const result = await batch(statements);
		committed.resolve();
		await confirmation.promise;
		return result;
	});
	const pending = action.handler(request(action), f.env);
	try {
		await committed.promise;
		expect(f.sqlite.prepare("SELECT id FROM threads WHERE id = 1").get()).toBeUndefined();
		expectNoPublishedMutation();
	} finally {
		confirmation.resolve();
	}
	expect((await pending).status).toBe(200);
	expect(f.sqlite.prepare("SELECT action FROM admin_logs").all()).toEqual([
		{ action: "thread.delete" },
	]);
	expect(vi.mocked(f.env.KV.put).mock.calls.some(([key]) => key === "thread:meta:gen:1")).toBe(
		true,
	);
});
