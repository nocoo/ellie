import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	forumsTicker,
	postForumsTicker,
	threadsTicker,
	usersTicker,
} from "../../../../src/handlers/admin/statistics";
import { readAdminEntity } from "../../../../src/lib/cache/admin-entity-read";
import {
	adminEntityGenKey,
	forumSummaryGenKey,
	postListGenKey,
	statsReportsGenKey,
	threadListGenAllKey,
	threadListGenKey,
	threadMetaGenKey,
} from "../../../../src/lib/cache/keys";
import { readJob, type StatsJobTicker, tickJob, writeJob } from "../../../../src/lib/stats-job";
import { deferred, readingFixture } from "../../lib/cache/thread-cache-fixture";

const tickers = [threadsTicker, usersTicker, forumsTicker, postForumsTicker];
let f: ReturnType<typeof readingFixture>;

beforeEach(() => {
	f = readingFixture();
	// Each D1 batch commits atomically; separate batches remain separate commits.
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
});

afterEach(() => {
	expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
	f.close();
	vi.restoreAllMocks();
});

function seedWork() {
	f.thread(1, { replies: 99, last_post_at: 900, digest: 1 });
	f.thread(2, { replies: 99, last_post_at: 900 });
	f.post(1, { forum_id: 2 });
	f.post(2, { forum_id: 2, author_id: 20, author_name: "bob", created_at: 200 });
	f.post(3, { thread_id: 2, forum_id: 2, is_first: 1 });
	f.sqlite.exec("UPDATE forums SET threads = 99, posts = 99");
	f.sqlite.exec("UPDATE users SET threads = 99, posts = 99, digest_posts = 99");
}

function orphanPost(id: number) {
	// Simulate a legacy orphan, then restore FK enforcement for the actual job.
	f.sqlite.exec("PRAGMA foreign_keys = OFF");
	try {
		f.post(id, { thread_id: 999, forum_id: 2 });
	} finally {
		f.sqlite.exec("PRAGMA foreign_keys = ON");
	}
}

function derivedRows() {
	return {
		threads: f.sqlite
			.prepare("SELECT id, replies, last_post_at, last_poster_id FROM threads ORDER BY id")
			.all(),
		users: f.sqlite.prepare("SELECT id, threads, posts, digest_posts FROM users ORDER BY id").all(),
		forums: f.sqlite
			.prepare("SELECT id, threads, posts, last_thread_id FROM forums ORDER BY id")
			.all(),
		posts: f.sqlite.prepare("SELECT id, thread_id, forum_id FROM posts ORDER BY id").all(),
	};
}

function generations() {
	return vi
		.mocked(f.env.KV.put)
		.mock.calls.map(([key]) => key)
		.filter((key) => /:gen(?::|$)/.test(key));
}

function deletions() {
	return vi.mocked(f.env.KV.delete).mock.calls.map(([key]) => key);
}

function expectEffects(puts: string[] = [], deletes: string[] = []) {
	expect(generations().sort()).toEqual([...puts].sort());
	expect(deletions().sort()).toEqual([...deletes].sort());
}

function clearEffects() {
	vi.mocked(f.env.KV.put).mockClear();
	vi.mocked(f.env.KV.delete).mockClear();
}

async function start(ticker: StatsJobTicker, batchSize = 1000, body: Record<string, unknown> = {}) {
	const initial = await tickJob(f.env, ticker, body);
	expect(initial).toMatchObject({
		code: "ok",
		advanced: false,
		payload: { status: "running", updated: 0 },
	});
	expectEffects();
	await writeJob(f.env, { ...initial.payload, batchSize });
	return initial.payload;
}

async function expectFailed(ticker: StatsJobTicker, before: ReturnType<typeof derivedRows>) {
	const result = await tickJob(f.env, ticker, {});
	expect(result).toMatchObject({
		code: "error",
		payload: {
			status: "failed",
			cursor: 0,
			processed: 0,
			updated: 0,
			lastBatchUpdated: 0,
			leaseUntil: null,
		},
	});
	expect(await readJob(f.env, ticker.kind)).toEqual(result.payload);
	expect(derivedRows()).toEqual(before);
	expectEffects();
}

function failRead(pattern: RegExp) {
	const prepare = f.env.DB.prepare.bind(f.env.DB);
	const all = vi.fn(async () => ({
		success: false,
		results: [],
		error: "D1 read failed",
		meta: {},
	}));
	function failing(statement: D1PreparedStatement): D1PreparedStatement {
		return {
			...statement,
			bind: (...values: unknown[]) => failing(statement.bind(...values)),
			all,
		} as unknown as D1PreparedStatement;
	}
	vi.spyOn(f.env.DB, "prepare").mockImplementation((sql) => {
		const statement = prepare(sql);
		return pattern.test(sql) ? failing(statement) : statement;
	});
	return all;
}

describe.each(tickers)("real SQL $kind job cache invalidation", (ticker) => {
	it("waits for confirmed derived writes before invalidating or advancing", async () => {
		seedWork();
		const before = derivedRows();
		await start(ticker);
		const batch = f.env.DB.batch.bind(f.env.DB);
		const committed = deferred();
		const confirmed = deferred();
		vi.spyOn(f.env.DB, "batch").mockImplementationOnce(async (statements) => {
			const result = await batch(statements);
			committed.resolve();
			await confirmed.promise;
			return result;
		});
		const pending = tickJob(f.env, ticker, {});
		try {
			await committed.promise;
			expect(derivedRows()).not.toEqual(before);
			expectEffects();
			expect(await readJob(f.env, ticker.kind)).toMatchObject({
				status: "running",
				cursor: 0,
				processed: 0,
				updated: 0,
			});
		} finally {
			confirmed.resolve();
		}
		const result = await pending;
		expect(result).toMatchObject({ code: "ok", advanced: true, payload: { status: "done" } });
		expect(result.payload.updated).toBeGreaterThan(0);
		expect(generations().filter((key) => key === statsReportsGenKey())).toHaveLength(1);
	});

	it("bumps reports only once at completion after multiple ticks", async () => {
		seedWork();
		await start(ticker, 1);
		let done = false;
		for (let count = 0; count < 8; count++) {
			const result = await tickJob(f.env, ticker, {});
			expect(result.code).toBe("ok");
			done = result.payload.status === "done";
			expect(generations().filter((key) => key === statsReportsGenKey())).toHaveLength(
				done ? 1 : 0,
			);
			if (done) break;
		}
		expect(done).toBe(true);
		const effects = [generations(), deletions()];
		const queries = f.calls.length;
		expect(await tickJob(f.env, ticker, {})).toMatchObject({
			code: "ok",
			advanced: false,
			payload: { status: "done" },
		});
		expect(f.calls).toHaveLength(queries);
		expect([generations(), deletions()]).toEqual(effects);
	});

	it("does not invalidate an empty sweep with no confirmed updates", async () => {
		f.sqlite.exec("DELETE FROM forums");
		f.sqlite.exec("UPDATE users SET status = -1");
		await start(ticker);
		const batch = vi.spyOn(f.env.DB, "batch");
		expect(await tickJob(f.env, ticker, {})).toMatchObject({
			code: "ok",
			payload: { status: "done", processed: 0, updated: 0 },
		});
		expect(batch).not.toHaveBeenCalled();
		expectEffects();
	});

	it.each(["false-success", "missing result", "rollback"])(
		"does not advance, invalidate or report success after a %s write batch",
		async (failure) => {
			seedWork();
			const before = derivedRows();
			await start(ticker);
			if (failure === "rollback") {
				let writes = 0;
				f.state.beforeWrite = async () => {
					if (++writes === 2) throw new Error("D1 batch rolled back");
				};
			} else {
				vi.spyOn(f.env.DB, "batch").mockImplementation(
					async (statements) =>
						statements.slice(0, failure === "missing result" ? -1 : undefined).map(() => ({
							success: failure !== "false-success",
							results: [],
							meta: { changes: 0 },
						})) as unknown as D1Result[],
				);
			}
			await expectFailed(ticker, before);
		},
	);

	it("rejects a false-success enumeration instead of completing an empty sweep", async () => {
		seedWork();
		const before = derivedRows();
		await start(ticker);
		f.state.queryError = true;
		await expectFailed(ticker, before);
	});
});

it.each([
	{ ticker: threadsTicker, label: "reply counts", pattern: /SELECT thread_id, COUNT\(\*\) - 1/ },
	{ ticker: threadsTicker, label: "last posts", pattern: /ROW_NUMBER\(\)[\s\S]*FROM posts/ },
	{
		ticker: usersTicker,
		label: "thread counts",
		pattern: /SELECT author_id, COUNT\(\*\).*FROM threads WHERE author_id/,
	},
	{
		ticker: usersTicker,
		label: "post counts",
		pattern: /SELECT author_id, COUNT\(\*\).*FROM posts/,
	},
	{
		ticker: usersTicker,
		label: "digest counts",
		pattern: /SELECT author_id, COUNT\(\*\).*FROM threads WHERE digest/,
	},
	{
		ticker: forumsTicker,
		label: "thread counts",
		pattern: /SELECT forum_id, COUNT\(\*\).*FROM threads/,
	},
	{
		ticker: forumsTicker,
		label: "post counts",
		pattern: /SELECT forum_id, COUNT\(\*\).*FROM posts/,
	},
	{ ticker: forumsTicker, label: "last threads", pattern: /ROW_NUMBER\(\)[\s\S]*FROM threads/ },
	{
		ticker: postForumsTicker,
		label: "canonical thread forums",
		pattern: /SELECT id, forum_id FROM threads WHERE id IN/,
	},
])(
	"$ticker.kind rejects false-success $label without overwriting counters or completing",
	async ({ ticker, pattern }) => {
		seedWork();
		const before = derivedRows();
		await start(ticker);
		const failedRead = failRead(pattern);
		await expectFailed(ticker, before);
		expect(failedRead).toHaveBeenCalled();
	},
);

describe("derived values and precise invalidation scopes", () => {
	it.each([
		{
			ticker: forumsTicker,
			entity: "forums",
			before: { threads: 99, posts: 99 },
			after: { threads: 3, posts: 1 },
		},
		{ ticker: postForumsTicker, entity: "posts", before: { forumId: 2 }, after: { forumId: 1 } },
	])(
		"completed $entity repair replaces a warm admin detail without waiting for TTL",
		async (test) => {
			seedWork();
			const descriptor: CacheDescriptor = {
				family: "admin:entity:detail",
				params: { entity: test.entity, id: 1 },
				scope: "admin",
			};
			expect(await readAdminEntity(f.env, undefined, descriptor)).toMatchObject(test.before);
			const warmCalls = f.calls.length;
			await readAdminEntity(f.env, undefined, descriptor);
			expect(f.calls).toHaveLength(warmCalls);
			if (test.entity === "forums") {
				// Imported content can arrive while the admin display is still warm.
				f.thread(4);
				f.post(4, { thread_id: 4, is_first: 1 });
				expect(await readAdminEntity(f.env, undefined, descriptor)).toMatchObject(test.before);
			}
			await start(test.ticker);
			expect(await tickJob(f.env, test.ticker, {})).toMatchObject({
				code: "ok",
				payload: { status: "done" },
			});
			expect(await readAdminEntity(f.env, undefined, descriptor)).toMatchObject(test.after);
			const refreshedCalls = f.calls.length;
			await readAdminEntity(f.env, undefined, descriptor);
			expect(f.calls).toHaveLength(refreshedCalls);
			expect(generations().filter((key) => key === adminEntityGenKey(test.entity))).toHaveLength(1);
		},
	);

	it.each([1, null])(
		"thread recalc preserves its captured forum scope %s and invalidates only confirmed batches",
		async (forumId) => {
			seedWork();
			f.thread(3, { forum_id: 2, replies: 99 });
			await start(threadsTicker, 2, { forumId });
			// The persisted job scope, not a later request body, owns the sweep.
			const first = await tickJob(f.env, threadsTicker, { forumId: 2 });
			expect(first).toMatchObject({
				code: "ok",
				payload: { status: "running", cursor: 2, processed: 2, updated: 2 },
			});
			expectEffects([threadMetaGenKey(1), threadMetaGenKey(2)]);
			expect(
				f.sqlite
					.prepare("SELECT id, replies, last_post_at, last_poster_id FROM threads ORDER BY id")
					.all(),
			).toEqual([
				{ id: 1, replies: 1, last_post_at: 200, last_poster_id: 20 },
				{ id: 2, replies: 0, last_post_at: 3, last_poster_id: 10 },
				{ id: 3, replies: 99, last_post_at: 3, last_poster_id: 20 },
			]);
			clearEffects();
			const done = await tickJob(f.env, threadsTicker, {});
			expect(done).toMatchObject({
				code: "ok",
				payload: { status: "done", updated: forumId === null ? 3 : 2 },
			});
			expectEffects([
				adminEntityGenKey("threads"),
				forumSummaryGenKey(),
				statsReportsGenKey(),
				...(forumId === null
					? [threadMetaGenKey(3), threadListGenAllKey()]
					: [threadListGenKey(1)]),
			]);
			expect(f.sqlite.prepare("SELECT replies FROM threads WHERE id = 3").get()?.replies).toBe(
				forumId === null ? 0 : 99,
			);
		},
	);

	it("user recalc evicts only each active batch's stats and self after updating their counters", async () => {
		seedWork();
		f.sqlite.exec("UPDATE users SET status = -1 WHERE id NOT IN (10, 20)");
		for (const id of [10, 20, 30]) {
			f.values.set(`user:stats:${id}`, "old counters");
			f.values.set(`user:self:${id}`, "old self");
		}
		await start(usersTicker, 1);
		expect(await tickJob(f.env, usersTicker, {})).toMatchObject({
			code: "ok",
			payload: { status: "running", cursor: 10, updated: 1 },
		});
		expectEffects([], ["user:stats:10", "user:self:10"]);
		expect(
			f.sqlite.prepare("SELECT threads, posts, digest_posts FROM users WHERE id = 10").get(),
		).toEqual({ threads: 2, posts: 2, digest_posts: 1 });
		for (const id of [20, 30]) expect(f.values.get(`user:stats:${id}`)).toBe("old counters");
		clearEffects();
		expect(await tickJob(f.env, usersTicker, {})).toMatchObject({
			code: "ok",
			payload: { status: "running", cursor: 20, updated: 2 },
		});
		expectEffects([], ["user:stats:20", "user:self:20"]);
		expect(
			f.sqlite.prepare("SELECT threads, posts, digest_posts FROM users WHERE id = 20").get(),
		).toEqual({ threads: 0, posts: 1, digest_posts: 0 });
		expect(
			f.sqlite.prepare("SELECT threads, posts, digest_posts FROM users WHERE id = 30").get(),
		).toEqual({ threads: 99, posts: 99, digest_posts: 99 });
		clearEffects();
		expect(await tickJob(f.env, usersTicker, {})).toMatchObject({
			code: "ok",
			payload: { status: "done", updated: 2, lastBatchUpdated: 0 },
		});
		expectEffects([statsReportsGenKey(), adminEntityGenKey("users")]);
		expect(f.values.get("user:self:30")).toBe("old self");
	});

	it("forum recalc updates real counters and last-thread ties, then publishes summary, reports and admin forums", async () => {
		seedWork();
		await start(forumsTicker, 2);
		expect(await tickJob(f.env, forumsTicker, {})).toMatchObject({
			code: "ok",
			payload: { status: "running", cursor: 2, updated: 2 },
		});
		expectEffects();
		expect(
			f.sqlite
				.prepare(
					"SELECT id, threads, posts, last_thread_id, last_thread_subject FROM forums ORDER BY id",
				)
				.all(),
		).toEqual([
			{ id: 1, threads: 2, posts: 0, last_thread_id: 2, last_thread_subject: "Thread 2" },
			{ id: 2, threads: 0, posts: 3, last_thread_id: 0, last_thread_subject: "" },
			{ id: 3, threads: 99, posts: 99, last_thread_id: 0, last_thread_subject: "" },
		]);
		expect(await tickJob(f.env, forumsTicker, {})).toMatchObject({
			code: "ok",
			payload: { status: "done", updated: 3 },
		});
		expect(f.sqlite.prepare("SELECT threads, posts FROM forums WHERE id = 3").get()).toEqual({
			threads: 0,
			posts: 0,
		});
		expectEffects([forumSummaryGenKey(), statsReportsGenKey(), adminEntityGenKey("forums")]);
	});

	it("post-forum repair deduplicates affected threads and their post epochs, preserving matched and orphan rows", async () => {
		seedWork();
		f.thread(3, { forum_id: 2 });
		f.post(4, { thread_id: 3, forum_id: 2 });
		orphanPost(5);
		await start(postForumsTicker);
		expect(await tickJob(f.env, postForumsTicker, {})).toMatchObject({
			code: "ok",
			payload: { status: "done", cursor: 5, processed: 5, updated: 3 },
		});
		expect(f.sqlite.prepare("SELECT id, forum_id FROM posts ORDER BY id").all()).toEqual([
			{ id: 1, forum_id: 1 },
			{ id: 2, forum_id: 1 },
			{ id: 3, forum_id: 1 },
			{ id: 4, forum_id: 2 },
			{ id: 5, forum_id: 2 },
		]);
		expect(f.calls.filter((call) => call.mode === "run").map((call) => call.params)).toEqual([
			[1, 1],
			[1, 2],
			[1, 3],
		]);
		expectEffects([
			adminEntityGenKey("posts"),
			threadMetaGenKey(1),
			postListGenKey(1),
			threadMetaGenKey(2),
			postListGenKey(2),
			forumSummaryGenKey(),
			statsReportsGenKey(),
		]);
	});

	it("post-forum scans with only matched or orphan posts perform no writes or bumps", async () => {
		f.thread(1);
		f.post(1);
		orphanPost(2);
		await start(postForumsTicker, 1);
		const batch = vi.spyOn(f.env.DB, "batch");
		await tickJob(f.env, postForumsTicker, {});
		await tickJob(f.env, postForumsTicker, {});
		expect(await tickJob(f.env, postForumsTicker, {})).toMatchObject({
			code: "ok",
			payload: { status: "done", processed: 2, updated: 0 },
		});
		expect(batch).not.toHaveBeenCalled();
		expectEffects();
	});
});

it.each(tickers)(
	"$kind handles more than 100 real entities with bounded SQL and precise cache fanout",
	async (ticker) => {
		f.sqlite.exec("UPDATE users SET status = -1");
		const ids = Array.from({ length: 205 }, (_, index) => 1000 + index);
		for (const id of ids) {
			f.insert("forums", { id, name: `Forum ${id}` });
			f.insert("users", { id, username: `author${id}` });
			f.thread(id, { forum_id: id, author_id: id });
			f.post(id, { thread_id: id, forum_id: 1, author_id: id, is_first: 1 });
		}
		await start(ticker);
		const batch = vi.spyOn(f.env.DB, "batch");
		const updated = ticker.kind === "forums" ? 208 : 205;
		expect(await tickJob(f.env, ticker, {})).toMatchObject({
			code: "ok",
			payload: { status: "done", processed: updated, updated },
		});
		expect(batch.mock.calls.map(([statements]) => statements.length)).toEqual([
			90,
			90,
			updated - 180,
		]);
		expect(f.calls.some((call) => call.params.length === 90)).toBe(true);
		switch (ticker.kind) {
			case "threads":
				expectEffects([
					adminEntityGenKey("threads"),
					...ids.map(threadMetaGenKey),
					threadListGenAllKey(),
					forumSummaryGenKey(),
					statsReportsGenKey(),
				]);
				break;
			case "users":
				expectEffects(
					[statsReportsGenKey(), adminEntityGenKey("users")],
					ids.flatMap((id) => [`user:stats:${id}`, `user:self:${id}`]),
				);
				break;
			case "forums":
				expectEffects([forumSummaryGenKey(), statsReportsGenKey(), adminEntityGenKey("forums")]);
				break;
			case "post-forums":
				expectEffects([
					adminEntityGenKey("posts"),
					...ids.flatMap((id) => [threadMetaGenKey(id), postListGenKey(id)]),
					forumSummaryGenKey(),
					statsReportsGenKey(),
				]);
				break;
		}
	},
);
