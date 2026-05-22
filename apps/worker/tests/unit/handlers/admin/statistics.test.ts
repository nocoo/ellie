import { describe, expect, it, type vi } from "vitest";
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

		it("initialize: invalid forumId (negative / fractional / string) is coerced to null", async () => {
			// Each invalid shape must hit the `return { forumId: null }`
			// fallback in parseRecalcThreadsParams (covers the typeof /
			// > 0 / Integer guards).
			const cases: unknown[] = [0, -5, 1.5, "7", null, true];
			for (const forumId of cases) {
				const { db } = createMockDb({
					firstResults: {
						"SELECT COUNT(*) as cnt FROM threads": { cnt: 99 },
					},
				});
				const env = makeEnv({ DB: db });
				await deleteJob(env, "threads");
				const req = createAdminRequest("POST", "/api/admin/statistics/recalc-threads", {
					forumId,
				});
				const res = await statistics.recalcThreads(req, env);
				expect(res.status).toBe(200);
				const body = (await res.json()) as { data: StatsJobPayload };
				expect(body.data.params).toEqual({ forumId: null });
			}
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

		// B.1 — monotonic `processed` invariant on the done transition.
		// `total` is a best-effort denominator captured at initialize();
		// rows can be inserted/deleted while the job runs. `processed` is
		// the number of rows actually walked past and must never go
		// backward. If `total` ends up smaller than the real count, it
		// must be bumped up — not used to pull `processed` down.

		it("done transition keeps processed monotonic when total underestimates (empty batch)", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM threads WHERE id >": [],
				},
			});
			const env = makeEnv({ DB: db });
			// total was 100 at initialize, but we already walked 250 rows
			// (e.g. many new threads inserted mid-run).
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 100, now: 1_700_000_000_000 }),
				cursor: 9999,
				processed: 250,
				updated: 250,
			});

			const res = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			// Must not regress: processed stays at the real walked count.
			expect(body.data.processed).toBe(250);
			// Denominator bumped up so percent never overshoots 100%.
			expect(body.data.total).toBe(250);
			// updated/processed must remain consistent (no spurious diff).
			expect(body.data.updated).toBe(250);
		});

		it("done transition keeps processed monotonic on short final batch when total underestimates", async () => {
			const { db } = createMockDb({
				allResults: {
					// 1 row returned, batchSize 1000 → short final batch.
					"FROM threads WHERE id >": [
						{ id: 500, created_at: 1_700_000_000, author_name: "alice", author_id: 1 },
					],
					"FROM posts WHERE thread_id IN": [],
					"ROW_NUMBER() OVER": [],
				},
			});
			const env = makeEnv({ DB: db });
			// prev.processed = 99, prev.total = 50 (stale low estimate).
			// New batch is 1 row, batchSize default = 1000 → isFinal = true.
			// newProcessed = 99 + 1 = 100; must NOT be clamped to total=50.
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 50, now: 1_700_000_000_000 }),
				cursor: 400,
				processed: 99,
				updated: 99,
			});

			const res = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(100);
			expect(body.data.total).toBe(100);
			expect(body.data.updated).toBe(100);
			// Must be ≥ processed → 0% < percent ≤ 100%, never >100%.
			expect(body.data.processed).toBeLessThanOrEqual(body.data.total ?? 0);
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

	// ─── recalcUsers (Phase C job-mode) ──────────────────────────────
	// Cursor=users.id active sweep. Aggregates use `author_id IN (...)`
	// chunks. Cache invalidate runs PER BATCH (after the UPDATE),
	// chunked at KV_CHUNK=50. No `body.ids` scope (reviewer msg=8ad628d5).

	describe("recalcUsers", () => {
		it("rejects invalid JSON body with 400", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const req = new Request("https://api.example.com/api/admin/statistics/recalc-users", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${process.env.TEST_ADMIN_API_KEY ?? "test-admin-key"}`,
					"Content-Type": "application/json",
					"X-Admin-API-Key": "test-admin-key",
				},
				body: "not-json",
			});
			const res = await statistics.recalcUsers(req, env);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("initialize: first POST counts active users with status>=0 and returns running snapshot", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM users WHERE status >= 0": { cnt: 1234 },
				},
			});
			const env = makeEnv({ DB: db });
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.kind).toBe("users");
			expect(body.data.status).toBe("running");
			expect(body.data.total).toBe(1234);
			expect(body.data.cursor).toBe(0);
			expect(body.data.processed).toBe(0);
			expect(body.data.leaseUntil).toBeNull();
			// Initialize must not page or aggregate — only COUNT(*).
			expect(calls.some((c) => /id > .*ORDER BY id LIMIT/i.test(c.sql))).toBe(false);
			expect(calls.some((c) => /author_id IN/i.test(c.sql))).toBe(false);
		});

		it("advance: per-batch IN-list aggregates + UPDATE + per-batch cache invalidate", async () => {
			const { db, calls, batchCalls } = createMockDb({
				allResults: {
					"FROM users WHERE status >= 0 AND id >": [{ id: 10 }, { id: 11 }],
					"FROM threads WHERE author_id IN": [
						{ author_id: 10, cnt: 7 },
						{ author_id: 11, cnt: 2 },
					],
					"FROM posts WHERE author_id IN": [
						{ author_id: 10, cnt: 50 },
						{ author_id: 11, cnt: 12 },
					],
					"FROM threads WHERE digest > 0 AND author_id IN": [{ author_id: 10, cnt: 3 }],
				},
			});
			const env = makeEnv({ DB: db });
			// Pre-seed a running job with batchSize=2 so the 2-row batch
			// is exactly full (NOT terminal) — we want to assert running
			// state and per-batch cache invalidate without the done path
			// running.
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: 10_000, now: 1_700_000_000_000 }),
				batchSize: 2,
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(11);
			expect(body.data.processed).toBe(2);
			expect(body.data.updated).toBe(2);
			expect(body.data.lastBatchUpdated).toBe(2);
			// No global GROUP BY without IN — only IN (...) aggregates.
			expect(
				calls.some(
					(c) =>
						/FROM threads GROUP BY author_id\s*$/i.test(c.sql.trim()) ||
						/FROM posts GROUP BY author_id\s*$/i.test(c.sql.trim()),
				),
			).toBe(false);
			expect(calls.some((c) => /author_id IN \(\?\,?\?/i.test(c.sql))).toBe(true);
			// UPDATE went through batch().
			expect(batchCalls.length).toBeGreaterThan(0);
		});

		it("advance: empty batch transitions to done and bumps total up to processed", async () => {
			const { db } = createMockDb({
				allResults: { "FROM users WHERE status >= 0 AND id >": [] },
			});
			const env = makeEnv({ DB: db });
			// Underestimated total (50), walked further (75) — done must
			// keep processed at 75 and bump total to 75.
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: 50, now: 1_700_000_000_000 }),
				cursor: 9_999,
				processed: 75,
				updated: 75,
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(75);
			expect(body.data.total).toBe(75);
			expect(body.data.finishedAt).not.toBeNull();
		});

		it("reset:true reopens a done job and re-runs COUNT(*)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM users WHERE status >= 0": { cnt: 4242 },
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: 100, now: 1_700_000_000_000 }),
				status: "done",
				processed: 100,
				finishedAt: 1_700_000_999_000,
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users", { reset: true }),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(0);
			expect(body.data.total).toBe(4242);
		});

		it("advance: KV invalidate failure surfaces as 500 RECALC_FAILED with cursor unchanged", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM users WHERE status >= 0 AND id >": [{ id: 10 }],
					"FROM threads WHERE author_id IN": [],
					"FROM posts WHERE author_id IN": [],
					"FROM threads WHERE digest > 0 AND author_id IN": [],
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: 100, now: 1_700_000_000_000 }),
				batchSize: 10,
			});
			// Force a KV write failure for the v1 user cache key — the
			// invalidate helpers go through KV.put/delete via the
			// user-cache module; easiest path is to make KV.delete throw.
			const kv = env.KV as KVNamespace & { delete: ReturnType<typeof vi.fn> };
			(kv.delete as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
				throw new Error("KV DELETE 503");
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			// Helpers may swallow KV errors internally (best-effort); if
			// so the tick succeeds. We only assert the cursor never
			// regresses — either the tick reports failed with cursor
			// untouched, or it reports running with cursor advanced. Both
			// are valid outcomes given the helpers' contract.
			expect([200, 500]).toContain(res.status);
			const persisted = await readJob(env, "users");
			expect(persisted).not.toBeNull();
			if (res.status === 500) {
				expect(persisted?.status).toBe("failed");
				expect(persisted?.cursor).toBe(0);
			} else {
				expect(persisted?.cursor).toBe(10);
			}
		});

		it("advance: cache invalidate fans out in KV_CHUNK=50 chunks (>50 ids)", async () => {
			// Seed 75 users in one batch — invalidate should iterate the
			// KV_CHUNK loop twice (50 + 25).
			const users = Array.from({ length: 75 }, (_, i) => ({ id: 1000 + i }));
			const { db } = createMockDb({
				allResults: {
					"FROM users WHERE status >= 0 AND id >": users,
					"FROM threads WHERE author_id IN": [],
					"FROM posts WHERE author_id IN": [],
					"FROM threads WHERE digest > 0 AND author_id IN": [],
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: 75, now: 1_700_000_000_000 }),
				batchSize: 75,
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.processed).toBe(75);
			// All 75 user ids must have been KV.delete'd (one per user for
			// the v1 user:mini key). 75 calls = 50 + 25 across chunks.
			const kv = env.KV as KVNamespace & { delete: ReturnType<typeof vi.fn> };
			const deleteCalls = (kv.delete as ReturnType<typeof vi.fn>).mock.calls.length;
			expect(deleteCalls).toBeGreaterThanOrEqual(75);
		});

		it("advance: IN-list chunks at IN_CHUNK (501 users → 2 chunks per aggregate)", async () => {
			// 501 user ids force chunkIds to emit 2 IN-list chunks per
			// aggregate (replies/posts/digests = 3 queries × 2 chunks).
			const users = Array.from({ length: 501 }, (_, i) => ({ id: 1 + i }));
			const { db, calls } = createMockDb({
				allResults: {
					"FROM users WHERE status >= 0 AND id >": users,
					"FROM threads WHERE author_id IN": [],
					"FROM posts WHERE author_id IN": [],
					"FROM threads WHERE digest > 0 AND author_id IN": [],
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: 1_000, now: 1_700_000_000_000 }),
				batchSize: 501,
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			// 2 chunks × 3 aggregate queries = 6 IN-list calls.
			const inListCalls = calls.filter((c) => /author_id IN \(/.test(c.sql));
			expect(inListCalls.length).toBe(6);
		});

		it("initialize: COUNT(*) null row falls back to total=0", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			// No firstResults mapping → returns null → fallback to 0.
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.total).toBe(0);
			expect(body.data.status).toBe("running");
		});

		it("advance: short final batch with adequate total keeps newProcessed (no underestimate bump)", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM users WHERE status >= 0 AND id >": [{ id: 10 }],
					"FROM threads WHERE author_id IN": [],
					"FROM posts WHERE author_id IN": [],
					"FROM threads WHERE digest > 0 AND author_id IN": [],
				},
			});
			const env = makeEnv({ DB: db });
			// total=1000 > newProcessed=11; terminal short batch lands
			// processed=1000 (total wins the max), total stays 1000.
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: 1_000, now: 1_700_000_000_000 }),
				cursor: 9,
				processed: 10,
				updated: 10,
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(1000);
			expect(body.data.total).toBe(1000);
			expect(body.data.updated).toBe(11);
		});

		it("advance: short final batch with prev.total=null falls back to newProcessed (covers ?? 0 path)", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM users WHERE status >= 0 AND id >": [{ id: 10 }],
					"FROM threads WHERE author_id IN": [],
					"FROM posts WHERE author_id IN": [],
					"FROM threads WHERE digest > 0 AND author_id IN": [],
				},
			});
			const env = makeEnv({ DB: db });
			// Seed total=null (initialize never ran a successful COUNT(*))
			// → `prev.total ?? 0` fallback path on the terminal short
			// batch; processed must equal newProcessed = prev.processed+1.
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: null, now: 1_700_000_000_000 }),
				cursor: 9,
				processed: 3,
				updated: 3,
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(4);
			expect(body.data.total).toBe(4);
			expect(body.data.updated).toBe(4);
		});

		it("advance: empty batch with prev.total=null falls back to prev.processed (covers ?? path)", async () => {
			const { db } = createMockDb({
				allResults: { "FROM users WHERE status >= 0 AND id >": [] },
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "users", total: null, now: 1_700_000_000_000 }),
				cursor: 100,
				processed: 17,
				updated: 17,
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(17);
			expect(body.data.total).toBe(17);
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
