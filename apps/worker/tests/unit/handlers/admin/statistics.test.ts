import { describe, expect, it } from "vitest";
import * as statistics from "../../../../src/handlers/admin/statistics";
import {
	type StatsJobPayload,
	deleteJob,
	makeInitialPayload,
	readJob,
	writeJob,
} from "../../../../src/lib/stats-job";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

describe("admin statistics handlers", () => {
	// ─── recalcForums ───────────────────────────────────────────────

	describe("recalcForums", () => {
		it("should return updated=0 when no forums exist", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM forums": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-forums");
			const response = await statistics.recalcForums(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(0);
		});

		it("should recalculate forum counters", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM forums": [{ id: 1 }, { id: 2 }],
					"SELECT forum_id, COUNT(*) as cnt FROM threads": [
						{ forum_id: 1, cnt: 10 },
						{ forum_id: 2, cnt: 5 },
					],
					"SELECT forum_id, COUNT(*) as cnt FROM posts": [
						{ forum_id: 1, cnt: 100 },
						{ forum_id: 2, cnt: 50 },
					],
					"SELECT t1.forum_id": [
						{
							forum_id: 1,
							id: 42,
							subject: "Latest",
							last_post_at: 1711544400,
							last_poster: "bob",
							last_poster_id: 20,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-forums");
			const response = await statistics.recalcForums(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(2);
		});
	});

	// ─── recalcThreads (job-mode, Phase B) ──────────────────────────
	//
	// The handler is a thin wrapper around `tickJob` + `threadsTicker`.
	// Each POST drives exactly one phase of the state machine:
	//   - first POST (no payload) → initialize (count total, no advance)
	//   - subsequent POSTs        → advance one batch
	//   - empty batch             → mark done + finalize cache bump
	// Tests assert the snapshot returned in the response body and the
	// SQL shape (no global self-join, scoped `IN (...)` aggregates).

	describe("recalcThreads (job-mode)", () => {
		it("rejects invalid JSON body with 400", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			await deleteJob(env, "threads");
			const request = new Request("https://api.example.com/api/admin/statistics/recalc-threads", {
				method: "POST",
				headers: {
					"X-API-Key": "test-admin-api-key",
					"Content-Type": "application/json",
				},
				body: "invalid json",
			});
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(400);
		});

		it("initialize: first POST counts total and returns running snapshot (no advance)", async () => {
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 2500 },
				},
			});
			const env = makeEnv({ DB: db });
			await deleteJob(env, "threads");
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-threads");
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(0);
			expect(body.data.processed).toBe(0);
			expect(body.data.total).toBe(2500);
			expect(body.data.params).toEqual({ forumId: null });
			// Initialize must NOT run any UPDATE batches.
			expect(batchCalls.length).toBe(0);
			// Lease is null on idle running (Phase A.1 invariant).
			expect(body.data.leaseUntil).toBeNull();
		});

		it("initialize: forumId is captured into params and used to scope COUNT(*)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM threads WHERE forum_id": { cnt: 150 },
				},
			});
			const env = makeEnv({ DB: db });
			await deleteJob(env, "threads");
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-threads", {
				forumId: 7,
			});
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			expect(body.data.total).toBe(150);
			expect(body.data.params).toEqual({ forumId: 7 });
		});

		it("advance: second POST processes one batch and moves cursor", async () => {
			const { db, batchCalls, calls } = createMockDb({
				allResults: {
					// Batch of threads (cursor > 0 LIMIT batchSize)
					"FROM threads WHERE id >": [
						{ id: 10, created_at: 1_700_000_000, author_name: "alice", author_id: 1 },
						{ id: 11, created_at: 1_700_000_100, author_name: "bob", author_id: 2 },
					],
					// Batch-scoped reply counts via IN (...)
					"FROM posts WHERE thread_id IN": [
						{ thread_id: 10, cnt: 5 },
						{ thread_id: 11, cnt: 2 },
					],
					// Batch-scoped last post via ROW_NUMBER window
					"ROW_NUMBER() OVER": [
						{ thread_id: 10, created_at: 1_700_000_500, author_name: "carol", author_id: 3 },
					],
				},
			});
			const env = makeEnv({ DB: db });

			// Seed an existing job snapshot — total 10k, cursor 0,
			// batchSize 2 (smaller than mock row count so the tick is
			// definitively NOT terminal — we can assert mid-run state).
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 10_000, now: 1_700_000_000_000 }),
				batchSize: 2,
			});

			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-threads");
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(11); // last id in batch
			expect(body.data.processed).toBe(2);
			expect(body.data.updated).toBe(2);
			expect(body.data.lastBatchUpdated).toBe(2);
			expect(body.data.leaseUntil).toBeNull();

			// We must have run at least one D1 UPDATE batch.
			expect(batchCalls.length).toBeGreaterThan(0);

			// Reviewer pin (Phase B SQL plan): NO global self-join on
			// posts; the last-post query is window-function-scoped to
			// the IN-list batch.
			const sawGlobalJoin = calls.some(
				(c) =>
					c.sql.includes("FROM posts p1") &&
					c.sql.includes("INNER JOIN") &&
					!c.sql.includes("thread_id IN"),
			);
			expect(sawGlobalJoin).toBe(false);
			// We did see a ROW_NUMBER + IN (...) scoped query.
			const sawWindow = calls.some(
				(c) => c.sql.includes("ROW_NUMBER()") && c.sql.includes("WHERE thread_id IN"),
			);
			expect(sawWindow).toBe(true);
		});

		it("advance: empty batch transitions to done and the next POST returns the terminal snapshot", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM threads WHERE id >": [], // nothing left
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 5000, now: 1_700_000_000_000 }),
				cursor: 50_000,
				processed: 4_999,
			});

			const tick1 = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(tick1.status).toBe(200);
			const body1 = (await tick1.json()) as { data: StatsJobPayload };
			expect(body1.data.status).toBe("done");
			// Processed pinned to total on terminal transition.
			expect(body1.data.processed).toBe(5000);
			expect(body1.data.finishedAt).not.toBeNull();
			expect(body1.data.leaseUntil).toBeNull();

			// A second POST on the same `done` job returns the snapshot
			// unchanged (no advance, framework short-circuits).
			const tick2 = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(tick2.status).toBe(200);
			const body2 = (await tick2.json()) as { data: StatsJobPayload };
			expect(body2.data.status).toBe("done");
			expect(body2.data.finishedAt).toBe(body1.data.finishedAt);
		});

		it("reset:true reopens a done job and re-initializes total", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 7777 },
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 100, now: 1_700_000_000_000 }),
				status: "done",
				processed: 100,
				finishedAt: 1_700_000_999_000,
			});

			const response = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads", { reset: true }),
				env,
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(0);
			expect(body.data.total).toBe(7777);
		});

		it("reset:true on a running job is refused with 409 RUNNING_JOB_EXISTS", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			await writeJob(
				env,
				makeInitialPayload({ kind: "threads", total: 1000, now: 1_700_000_000_000 }),
			);

			const response = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads", { reset: true }),
				env,
			);
			expect(response.status).toBe(409);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("RUNNING_JOB_EXISTS");

			// The KV snapshot must NOT have been replaced by the refused reset.
			const persisted = await readJob(env, "threads");
			expect(persisted?.status).toBe("running");
			expect(persisted?.cursor).toBe(0);
		});

		it("concurrent in-flight advance is reported as 409 CONCURRENT_TICK", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const now = Date.now();
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 1000, now }),
				leaseUntil: now + 30_000, // another tick holding the lease
			});

			const response = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(response.status).toBe(409);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("CONCURRENT_TICK");
		});

		it("non-object JSON body (array / primitive) yields 400 INVALID_BODY", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			await deleteJob(env, "threads");
			// JSON parses cleanly but isn't an object — the ticker can't
			// read params off an array, so the handler rejects with 400
			// rather than silently treating it as `{}`.
			const request = new Request("https://api.example.com/api/admin/statistics/recalc-threads", {
				method: "POST",
				headers: {
					"X-API-Key": "test-admin-api-key",
					"Content-Type": "application/json",
				},
				body: JSON.stringify([1, 2, 3]),
			});
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(400);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("advance throw is surfaced as 500 RECALC_FAILED with payload.status=failed", async () => {
			// Force the SELECT (next batch) to throw — `advance` propagates,
			// framing marks the job failed, response carries the payload.
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			await writeJob(
				env,
				makeInitialPayload({ kind: "threads", total: 1000, now: 1_700_000_000_000 }),
			);
			// Override prepare to throw on the SELECT-batch query.
			const realPrepare = env.DB.prepare;
			env.DB.prepare = ((sql: string) => {
				if (sql.includes("FROM threads WHERE id >")) {
					throw new Error("D1 timeout");
				}
				return realPrepare.call(env.DB, sql);
			}) as typeof env.DB.prepare;

			const response = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(response.status).toBe(500);
			const body = (await response.json()) as {
				error: { code: string; details: { error: string; payload: { status: string } } };
			};
			expect(body.error.code).toBe("RECALC_FAILED");
			expect(body.error.details.error).toBe("D1 timeout");
			expect(body.error.details.payload.status).toBe("failed");

			// And the KV snapshot reflects the failed terminal state.
			const persisted = await readJob(env, "threads");
			expect(persisted?.status).toBe("failed");
			expect(persisted?.error).toBe("D1 timeout");
		});

		it("advance: forumId-scoped batch + missing reply/lastPost rows fall back to thread author", async () => {
			// Covers (a) the `forum_id = ?` filtered SELECT in advance,
			// (b) the `?? thread.created_at / ?? thread.author_name` fallbacks
			//     when posts has no row for a thread (e.g. brand-new
			//     thread with first post not yet replicated to the
			//     last-post window).
			const { db, calls } = createMockDb({
				allResults: {
					"FROM threads WHERE forum_id = ? AND id >": [
						{ id: 100, created_at: 1_700_000_001, author_name: "alice", author_id: 1 },
					],
					// Empty -> ?? 0 fallback for replies
					"FROM posts WHERE thread_id IN": [],
					// Empty -> falls back to thread's own author/created_at
					"ROW_NUMBER() OVER": [],
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 1, now: 1_700_000_000_000 }),
				batchSize: 5,
				params: { forumId: 7 },
			});

			const response = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads", { forumId: 7 }),
				env,
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			// batch.length (1) < batchSize (5) ⇒ final
			expect(body.data.status).toBe("done");
			expect(body.data.cursor).toBe(100);

			// The forumId-scoped SELECT must have been issued.
			const sawForumScoped = calls.some(
				(c) => c.sql.includes("FROM threads WHERE forum_id = ? AND id >") && c.params[0] === 7,
			);
			expect(sawForumScoped).toBe(true);

			// And the UPDATE used the thread's own created_at / author
			// since lastPost was empty (4-arg fallback path).
			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET replies"));
			expect(updateCall).toBeDefined();
			// bind order: replies=0, last_post_at=1_700_000_001, last_poster="alice", last_poster_id=1, id=100
			expect(updateCall?.params).toEqual([0, 1_700_000_001, "alice", 1, 100]);
		});

		it("chunkIds chunks IN-list batches at IN_CHUNK (501 ids → 2 chunks)", async () => {
			// IN_CHUNK = 500; a 501-row batch must produce 2 IN (...) calls
			// per aggregate (replies, lastPost). We don't care about
			// terminal status here — only the SQL plan.
			const rows = Array.from({ length: 501 }, (_, i) => ({
				id: i + 1,
				created_at: 1_700_000_000,
				author_name: "x",
				author_id: 1,
			}));
			const { db, calls } = createMockDb({
				allResults: {
					"FROM threads WHERE id >": rows,
					"FROM posts WHERE thread_id IN": [],
					"ROW_NUMBER() OVER": [],
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 1000, now: 1_700_000_000_000 }),
				batchSize: 501,
			});
			const response = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(response.status).toBe(200);
			const replyCalls = calls.filter((c) => c.sql.includes("FROM posts WHERE thread_id IN"));
			const windowCalls = calls.filter(
				(c) => c.sql.includes("ROW_NUMBER()") && c.sql.includes("WHERE thread_id IN"),
			);
			expect(replyCalls.length).toBe(2);
			expect(windowCalls.length).toBe(2);
			// First chunk: 500 params; second: 1 param.
			expect(replyCalls[0]?.params.length).toBe(500);
			expect(replyCalls[1]?.params.length).toBe(1);
		});
	});

	// ─── recalcUsers ────────────────────────────────────────────────

	describe("recalcUsers", () => {
		it("should return updated=0 when no users found", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-users");
			const response = await statistics.recalcUsers(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(0);
		});

		it("should recalculate user counters for all users", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users": [{ id: 1 }, { id: 2 }, { id: 3 }],
					"SELECT author_id, COUNT(*) as cnt FROM threads GROUP": [
						{ author_id: 1, cnt: 10 },
						{ author_id: 2, cnt: 5 },
					],
					"SELECT author_id, COUNT(*) as cnt FROM posts GROUP": [
						{ author_id: 1, cnt: 50 },
						{ author_id: 2, cnt: 30 },
						{ author_id: 3, cnt: 10 },
					],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest": [{ author_id: 1, cnt: 2 }],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-users");
			const response = await statistics.recalcUsers(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(3);
		});

		it("should recalculate specific user ids when provided", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT author_id, COUNT(*) as cnt FROM threads GROUP": [{ author_id: 5, cnt: 3 }],
					"SELECT author_id, COUNT(*) as cnt FROM posts GROUP": [{ author_id: 5, cnt: 20 }],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-users", {
				ids: [5],
			});
			const response = await statistics.recalcUsers(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(1);
		});

		it("should handle empty body gracefully", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users": [{ id: 1 }],
					"SELECT author_id, COUNT(*) as cnt FROM threads GROUP": [],
					"SELECT author_id, COUNT(*) as cnt FROM posts GROUP": [],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-users");
			const response = await statistics.recalcUsers(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ─── recalcPostForumIds ────────────────────────────────────

	describe("recalcPostForumIds", () => {
		it("should return updated=0 and remaining=0 when no mismatches", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT p.id, t.forum_id": [],
				},
				firstResults: {
					"SELECT COUNT(*) as cnt": { cnt: 0 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums");
			const response = await statistics.recalcPostForumIds(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number; remaining: number } };
			expect(body.data.updated).toBe(0);
			expect(body.data.remaining).toBe(0);
		});

		it("should fix mismatched posts and report remaining", async () => {
			const { db, batchCalls } = createMockDb({
				allResults: {
					"SELECT p.id, t.forum_id": [
						{ id: 101, forum_id: 5 },
						{ id: 102, forum_id: 5 },
						{ id: 103, forum_id: 7 },
					],
				},
				firstResults: {
					"SELECT COUNT(*) as cnt": { cnt: 1200 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums");
			const response = await statistics.recalcPostForumIds(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number; remaining: number } };
			expect(body.data.updated).toBe(3);
			expect(body.data.remaining).toBe(1200);
			expect(batchCalls.length).toBeGreaterThan(0);
		});
	});

	// ─── getStatsJob — GET /api/admin/statistics/job/:kind ─────────────
	// Read-only snapshot of the per-kind recalc job (Phase A).
	// POST endpoints drive the state machine; this handler only reads.

	describe("getStatsJob", () => {
		it("returns 400 INVALID_KIND for an unknown kind segment", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/statistics/job/bogus");
			const response = await statistics.getStatsJob(request, env);
			expect(response.status).toBe(400);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("INVALID_KIND");
		});

		it("returns 400 INVALID_KIND when the path has no kind segment", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			// Trailing slash produces "" as the last segment after filter(Boolean).
			const request = createAdminRequest("GET", "/api/admin/statistics/job/");
			const response = await statistics.getStatsJob(request, env);
			expect(response.status).toBe(400);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("INVALID_KIND");
		});

		it("returns null payload when no job has ever been started for the kind", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/statistics/job/threads");
			const response = await statistics.getStatsJob(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload | null };
			expect(body.data).toBeNull();
		});

		it("returns the stored payload when a job exists in KV", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const seed = makeInitialPayload({ kind: "users", total: 7, params: {} });
			await writeJob(env, seed);
			const request = createAdminRequest("GET", "/api/admin/statistics/job/users");
			const response = await statistics.getStatsJob(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			expect(body.data.kind).toBe("users");
			expect(body.data.total).toBe(7);
			expect(body.data.status).toBe("running");
			await deleteJob(env, "users");
		});

		it("returns a non-null payload for every supported kind", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			for (const kind of ["forums", "threads", "users", "post-forums"] as const) {
				const seed = makeInitialPayload({ kind, total: 1, params: {} });
				await writeJob(env, seed);
				const request = createAdminRequest("GET", `/api/admin/statistics/job/${kind}`);
				const response = await statistics.getStatsJob(request, env);
				expect(response.status).toBe(200);
				const body = (await response.json()) as { data: StatsJobPayload };
				expect(body.data.kind).toBe(kind);
				await deleteJob(env, kind);
			}
		});
	});
});
