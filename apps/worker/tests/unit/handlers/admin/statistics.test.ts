import { describe, expect, it, type vi } from "vitest";
import * as statistics from "../../../../src/handlers/admin/statistics";
import {
	deleteJob,
	makeInitialPayload,
	readJob,
	type StatsJobPayload,
	writeJob,
} from "../../../../src/lib/stats-job";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

describe("admin statistics handlers", () => {
	// ─── recalcForums (job-mode) ────────────────────────────────────
	//
	// Handler is a thin wrapper around `tickJob` + `forumsTicker`.
	// Each POST drives exactly one phase of the state machine:
	//   - first POST (no payload) → initialize (count total, no advance)
	//   - subsequent POSTs        → advance one batch of forums
	//   - empty / short batch     → mark done + finalize cache bump
	// Tests assert the snapshot returned in the response body and the
	// SQL shape (no global self-join, scoped `IN (...)` aggregates).
	// Replaces the legacy one-shot `{updated:N}` handler — line-protocol
	// regression for msg=b7eda60a (production-detected: legacy shape
	// crashed the new admin parser with "返回数据格式无效").

	describe("recalcForums (job-mode)", () => {
		it("rejects invalid JSON body with 400", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			await deleteJob(env, "forums");
			const request = new Request("https://api.example.com/api/admin/statistics/recalc-forums", {
				method: "POST",
				headers: {
					"X-API-Key": "test-admin-api-key",
					"Content-Type": "application/json",
				},
				body: "invalid json",
			});
			const response = await statistics.recalcForums(request, env);
			expect(response.status).toBe(400);
		});

		it("initialize: first POST counts total and returns running snapshot (no advance)", async () => {
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM forums": { cnt: 12 },
				},
			});
			const env = makeEnv({ DB: db });
			await deleteJob(env, "forums");
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-forums");
			const response = await statistics.recalcForums(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			// Job-mode snapshot — NOT the legacy {updated:N} shape that
			// triggered msg=b7eda60a in production.
			expect(body.data.v).toBe(1);
			expect(body.data.kind).toBe("forums");
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(0);
			expect(body.data.processed).toBe(0);
			expect(body.data.updated).toBe(0);
			expect(body.data.total).toBe(12);
			expect(body.data.params).toEqual({});
			// Initialize must NOT run any UPDATE batches.
			expect(batchCalls.length).toBe(0);
			// Lease is null on idle running (Phase A.1 invariant).
			expect(body.data.leaseUntil).toBeNull();
		});

		it("initialize on empty forums table records total=0 and stays running", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM forums": { cnt: 0 },
				},
			});
			const env = makeEnv({ DB: db });
			await deleteJob(env, "forums");
			const response = await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.total).toBe(0);
			expect(body.data.processed).toBe(0);
		});

		it("advance: processes one batch of forums and moves cursor", async () => {
			const { db, batchCalls, calls } = createMockDb({
				allResults: {
					"FROM forums WHERE id >": [{ id: 1 }, { id: 2 }],
					"FROM threads WHERE forum_id IN": [
						{ forum_id: 1, cnt: 10 },
						{ forum_id: 2, cnt: 5 },
					],
					"FROM posts WHERE forum_id IN": [
						{ forum_id: 1, cnt: 100 },
						{ forum_id: 2, cnt: 50 },
					],
					"ROW_NUMBER() OVER": [
						{
							forum_id: 1,
							id: 42,
							subject: "Latest",
							last_post_at: 1_711_544_400,
							last_poster: "bob",
							last_poster_id: 20,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			// Seed: total 10 forums, cursor 0, batchSize 2 → batch is the
			// 2 mock rows, batch.length (2) < batchSize (2) is false →
			// non-terminal so we can assert mid-run shape.
			await writeJob(env, {
				...makeInitialPayload({ kind: "forums", total: 10, now: 1_700_000_000_000 }),
				batchSize: 2,
			});

			const response = await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(2); // last id in batch
			expect(body.data.processed).toBe(2);
			expect(body.data.updated).toBe(2);
			expect(body.data.lastBatchUpdated).toBe(2);
			expect(body.data.total).toBe(10); // unchanged on non-final tick
			expect(body.data.leaseUntil).toBeNull();

			// We must have run at least one D1 UPDATE batch.
			expect(batchCalls.length).toBeGreaterThan(0);

			// SQL plan invariants: no global GROUP BY scan, no global
			// self-join. Aggregates must be IN (...) batch-scoped.
			const sawGlobalThreadsGroupBy = calls.some(
				(c) => c.sql.includes("FROM threads GROUP BY forum_id") && !c.sql.includes("forum_id IN"),
			);
			expect(sawGlobalThreadsGroupBy).toBe(false);
			const sawGlobalPostsGroupBy = calls.some(
				(c) => c.sql.includes("FROM posts GROUP BY forum_id") && !c.sql.includes("forum_id IN"),
			);
			expect(sawGlobalPostsGroupBy).toBe(false);
			const sawWindow = calls.some(
				(c) => c.sql.includes("ROW_NUMBER()") && c.sql.includes("WHERE forum_id IN"),
			);
			expect(sawWindow).toBe(true);

			// UPDATE bind order must match the column order in the SQL:
			// threads, posts, last_thread_id, last_post_at, last_poster,
			// last_poster_id, last_thread_subject, id.
			const updateForum1 = calls.find(
				(c) => c.sql.includes("UPDATE forums SET") && c.params[c.params.length - 1] === 1,
			);
			expect(updateForum1?.params).toEqual([10, 100, 42, 1_711_544_400, "bob", 20, "Latest", 1]);

			// Forum 2 has no last-thread row → fallback zeros / empty.
			const updateForum2 = calls.find(
				(c) => c.sql.includes("UPDATE forums SET") && c.params[c.params.length - 1] === 2,
			);
			expect(updateForum2?.params).toEqual([5, 50, 0, 0, "", 0, "", 2]);
		});

		it("advance: empty batch transitions to done and renormalizes total to processed", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM forums WHERE id >": [],
				},
			});
			const env = makeEnv({ DB: db });
			// total=999 (initialize estimate); only 7 forums actually walked
			// (most deleted between initialize and tick). Phase C.1: processed
			// stays at 7, total renormalises down to 7.
			await writeJob(env, {
				...makeInitialPayload({ kind: "forums", total: 999, now: 1_700_000_000_000 }),
				cursor: 7,
				processed: 7,
				updated: 7,
			});

			const tick1 = await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			expect(tick1.status).toBe(200);
			const body1 = (await tick1.json()) as { data: StatsJobPayload };
			expect(body1.data.status).toBe("done");
			expect(body1.data.processed).toBe(7);
			expect(body1.data.total).toBe(7);
			expect(body1.data.finishedAt).not.toBeNull();
			expect(body1.data.leaseUntil).toBeNull();

			// Second POST on the same done job returns the snapshot unchanged.
			const tick2 = await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			expect(tick2.status).toBe(200);
			const body2 = (await tick2.json()) as { data: StatsJobPayload };
			expect(body2.data.status).toBe("done");
			expect(body2.data.finishedAt).toBe(body1.data.finishedAt);
		});

		it("advance: short final batch transitions to done with renormalised total", async () => {
			const { db } = createMockDb({
				allResults: {
					// 1 row returned, batchSize 1000 → short final batch.
					"FROM forums WHERE id >": [{ id: 9 }],
					"FROM threads WHERE forum_id IN": [{ forum_id: 9, cnt: 3 }],
					"FROM posts WHERE forum_id IN": [{ forum_id: 9, cnt: 30 }],
					"ROW_NUMBER() OVER": [],
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({ kind: "forums", total: 50, now: 1_700_000_000_000 }),
				cursor: 8,
				processed: 8,
				updated: 8,
			});

			const res = await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(9);
			expect(body.data.total).toBe(9);
			expect(body.data.updated).toBe(9);
			expect(body.data.lastBatchUpdated).toBe(1);
		});

		it("finalize bumps forum:summary:gen only when updated > 0", async () => {
			// Initialize on an empty forums table → advance hits empty batch
			// immediately → status=done with updated=0 → finalize must NOT
			// touch forum:summary:gen (no churn for no-op sweeps).
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM forums": { cnt: 0 },
				},
				allResults: {
					"FROM forums WHERE id >": [],
				},
			});
			const env = makeEnv({ DB: db });
			await deleteJob(env, "forums");

			// Tick 1 — initialize, running snapshot.
			await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			const initialGen = await env.KV.get("forum:summary:gen");

			// Tick 2 — advance hits empty batch, done with updated=0.
			const res = await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.updated).toBe(0);

			// forum:summary:gen must be unchanged (no bump for no-op sweep).
			const finalGen = await env.KV.get("forum:summary:gen");
			expect(finalGen).toBe(initialGen);
		});

		it("finalize bumps forum:summary:gen when updated > 0 on done transition", async () => {
			// Initialize (total=1) → advance walks 1 forum → short final
			// batch → done with updated=1 → finalize MUST bump
			// forum:summary:gen exactly once (outside the lease).
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM forums": { cnt: 1 },
				},
				allResults: {
					"FROM forums WHERE id >": [{ id: 1 }],
					"FROM threads WHERE forum_id IN": [{ forum_id: 1, cnt: 0 }],
					"FROM posts WHERE forum_id IN": [{ forum_id: 1, cnt: 0 }],
					"ROW_NUMBER() OVER": [],
				},
			});
			const env = makeEnv({ DB: db });
			await deleteJob(env, "forums");

			// Tick 1 — initialize (no bump yet).
			await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			const genBeforeBatch = await env.KV.get("forum:summary:gen");

			// Tick 2 — advance writes 1 forum → done → finalize bumps.
			const res = await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.updated).toBe(1);

			const genAfter = await env.KV.get("forum:summary:gen");
			expect(genAfter).not.toBe(genBeforeBatch);
		});

		it("response body is StatsJobPayload, NOT the legacy {updated:N} shape", async () => {
			// Regression line-pin for msg=b7eda60a (production: legacy
			// `{data:{updated:178}}` shape crashed admin parser with
			// "返回数据格式无效"). Every 2xx response from this endpoint
			// must now be a full StatsJobPayload with v/kind/status fields.
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM forums": { cnt: 5 },
				},
			});
			const env = makeEnv({ DB: db });
			await deleteJob(env, "forums");
			const res = await statistics.recalcForums(
				createAdminRequest("POST", "/api/admin/statistics/recalc-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: Record<string, unknown> };
			// New required fields present.
			expect(body.data.v).toBe(1);
			expect(body.data.kind).toBe("forums");
			expect(body.data.status).toBe("running");
			// Legacy keys must NOT be the response's primary shape — they
			// can appear as job-snapshot fields, but never as the only key.
			expect(Object.keys(body.data)).toContain("cursor");
			expect(Object.keys(body.data)).toContain("processed");
			expect(Object.keys(body.data)).toContain("batchSize");
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

		it("propagates posts.anonymous onto threads.anonymous_last_poster (mig 0048)", async () => {
			// Without this propagation, every recalc would silently reset the
			// anonymous_last_poster denorm to 0, and the next forum-index hit
			// would leak the original author of an anonymous reply.
			const { db, calls } = createMockDb({
				allResults: {
					"FROM threads WHERE id >": [
						{
							id: 10,
							created_at: 1_700_000_000,
							author_name: "alice",
							author_id: 1,
							anonymous_author: 0,
						},
					],
					"FROM posts WHERE thread_id IN": [{ thread_id: 10, cnt: 3 }],
					"ROW_NUMBER() OVER": [
						{
							thread_id: 10,
							created_at: 1_700_000_500,
							author_name: "carol",
							author_id: 3,
							anonymous: 1,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });

			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 100, now: 1_700_000_000_000 }),
				batchSize: 5,
			});

			const response = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(response.status).toBe(200);

			// Bound params for the UPDATE land in `calls`. anonymous_last_poster
			// (5th param) must be 1 because the latest post is anonymous.
			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET replies"));
			expect(updateCall?.params).toEqual([3, 1_700_000_500, "carol", 3, 1, 10]);
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
			// Phase C.1: processed is the real walked count (unchanged),
			// total is renormalized to processed on done.
			expect(body1.data.processed).toBe(4999);
			expect(body1.data.total).toBe(4999);
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

		// C.1 regression — `processed` must NOT be inflated when `total`
		// turns out to be an overestimate (e.g. rows deleted mid-run). The
		// previous Phase B.1 logic clamped `processed` up to `total` on
		// done, locking in the wrong reading. Phase C.1 (reviewer
		// msg=b43a2bc9) keeps `processed` as the real walked count and
		// renormalizes `total` down to processed on the terminal tick.

		it("C.1: threads empty terminal with OVERESTIMATED total normalizes total down to processed", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM threads WHERE id >": [],
				},
			});
			const env = makeEnv({ DB: db });
			// total=10_000 (initialize estimate), but only 11 rows actually
			// walked (most threads deleted between initialize and tick).
			// `processed` must stay at 11, NOT inflate to 10_000.
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 10_000, now: 1_700_000_000_000 }),
				cursor: 9_999,
				processed: 11,
				updated: 11,
			});

			const res = await statistics.recalcThreads(
				createAdminRequest("POST", "/api/admin/statistics/recalc-threads"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(11);
			expect(body.data.total).toBe(11);
			expect(body.data.updated).toBe(11);
		});

		it("C.1: threads short final with OVERESTIMATED total normalizes total down to processed", async () => {
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
			// total=10_000 (overestimate). newProcessed = 99 + 1 = 100.
			// On the terminal short batch, `processed` must NOT be
			// inflated to 10_000; `total` must be renormalized to 100.
			await writeJob(env, {
				...makeInitialPayload({ kind: "threads", total: 10_000, now: 1_700_000_000_000 }),
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
			// bind order: replies=0, last_post_at, last_poster, last_poster_id,
			// anonymous_last_poster (fallback to thread.anonymous_author=0), id.
			expect(updateCall?.params).toEqual([0, 1_700_000_001, "alice", 1, 0, 100]);
		});

		it("chunkIds chunks IN-list batches at IN_CHUNK (91 ids → 2 chunks)", async () => {
			// IN_CHUNK = 90 (D1 caps a prepared statement at 100 bound
			// vars). A 91-row batch must produce 2 IN (...) calls per
			// aggregate (replies, lastPost). We don't care about terminal
			// status here — only the SQL plan.
			const rows = Array.from({ length: 91 }, (_, i) => ({
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
				batchSize: 91,
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
			// First chunk: 90 params; second: 1 param.
			expect(replyCalls[0]?.params.length).toBe(90);
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
			expect(calls.some((c) => /author_id IN \(\?,?\?/i.test(c.sql))).toBe(true);
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

		// Phase C.1 (msg=b43a2bc9) — the v1/v2 KV invalidate contracts
		// differ: `invalidateUserCache` (v1, user-cache.ts:147) is a raw
		// `await env.KV.delete(...)` that propagates KV errors, while
		// `deleteUserMini` / `deleteUserPublicVariants` (v2,
		// cache/invalidate.ts) wrap KV.delete in try/catch + console.warn
		// and swallow failures. So only v1 errors should fail the tick.
		// We assert each side explicitly instead of accepting both 200/500.

		it("advance: v1 KV invalidate failure surfaces as 500 RECALC_FAILED with cursor unchanged", async () => {
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
			// Fail only the v1 `user:mini:<id>` key. v1's helper does a
			// raw `await env.KV.delete(...)` so the error propagates →
			// advance throws → tickJob marks the job `failed` with the
			// cursor unchanged for the next POST to retry (idempotent
			// UPDATE).
			const kv = env.KV as KVNamespace & { delete: ReturnType<typeof vi.fn> };
			(kv.delete as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
				if (
					typeof key === "string" &&
					key.startsWith("user:mini:") &&
					!key.startsWith("user:mini:v2:")
				) {
					throw new Error("KV DELETE 503 (v1)");
				}
				// other keys (v2 user:mini:v2 / user:public:v2) succeed.
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(500);
			const persisted = await readJob(env, "users");
			expect(persisted?.status).toBe("failed");
			expect(persisted?.cursor).toBe(0);
		});

		it("advance: v2-only KV invalidate failure is swallowed and tick still succeeds", async () => {
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
			// Fail ONLY the v2 keys (`user:mini:v2:<id>` /
			// `user:public:v2:<id>:*`). Per cache/invalidate.ts these
			// helpers swallow KV errors and log via console.warn. The
			// tick must still succeed and the cursor must advance.
			const kv = env.KV as KVNamespace & { delete: ReturnType<typeof vi.fn> };
			(kv.delete as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
				if (
					typeof key === "string" &&
					(key.startsWith("user:mini:v2:") || key.startsWith("user:public:v2:"))
				) {
					throw new Error("KV DELETE 503 (v2)");
				}
				// v1 user:mini:<id> succeeds.
			});
			const res = await statistics.recalcUsers(
				createAdminRequest("POST", "/api/admin/statistics/recalc-users"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			// 1 row, batchSize=10 → short final batch → done.
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(1);
			const persisted = await readJob(env, "users");
			expect(persisted?.cursor).toBe(10);
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

		it("advance: IN-list chunks at IN_CHUNK (91 users → 2 chunks per aggregate)", async () => {
			// 91 user ids force chunkIds to emit 2 IN-list chunks per
			// aggregate (replies/posts/digests = 3 queries × 2 chunks).
			const users = Array.from({ length: 91 }, (_, i) => ({ id: 1 + i }));
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
				batchSize: 91,
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

		it("C.1: users short final with OVERESTIMATED total normalizes total down to processed", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM users WHERE status >= 0 AND id >": [{ id: 10 }],
					"FROM threads WHERE author_id IN": [],
					"FROM posts WHERE author_id IN": [],
					"FROM threads WHERE digest > 0 AND author_id IN": [],
				},
			});
			const env = makeEnv({ DB: db });
			// total=1000 (overestimate; e.g. many users deleted mid-run).
			// newProcessed = prev.processed (10) + 1 = 11. On the terminal
			// short batch, `processed` must NOT be inflated to 1000 just
			// because total said so — `processed` is the real walked
			// count. `total` is renormalized to processed on done so the
			// UI denominator equals the numerator.
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
			expect(body.data.processed).toBe(11);
			expect(body.data.total).toBe(11);
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

	// ─── recalcPostForumIds (job-mode, Phase D) ────────────────────────
	// Cursor=posts.id active sweep. Each tick pulls a slab of posts via
	// `id > cursor`, looks up canonical `threads.forum_id` for the batch
	// thread-ids via `IN (...)`, and writes only mismatched rows. Cursor
	// advances by SCANNED posts, not mismatched posts. `bumpForumSummaryGen`
	// fires from finalize only when `updated > 0` (Phase D, msg=376c0bee).

	describe("recalcPostForumIds (job-mode)", () => {
		it("rejects invalid JSON body with 400", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			await deleteJob(env, "post-forums");
			const request = new Request(
				"https://api.example.com/api/admin/statistics/recalc-post-forums",
				{
					method: "POST",
					headers: {
						"X-API-Key": "test-admin-api-key",
						"Content-Type": "application/json",
					},
					body: "not-json",
				},
			);
			const response = await statistics.recalcPostForumIds(request, env);
			expect(response.status).toBe(400);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("initialize: first POST counts posts.COUNT(*) and returns running snapshot", async () => {
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM posts": { cnt: 12_345 },
				},
			});
			const env = makeEnv({ DB: db });
			await deleteJob(env, "post-forums");
			const res = await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.kind).toBe("post-forums");
			expect(body.data.status).toBe("running");
			expect(body.data.total).toBe(12_345);
			expect(body.data.cursor).toBe(0);
			expect(body.data.processed).toBe(0);
			expect(body.data.updated).toBe(0);
			// Initialize must NOT run any UPDATE batches.
			expect(batchCalls.length).toBe(0);
			expect(body.data.leaseUntil).toBeNull();
		});

		it("advance: scans posts, computes mismatch in JS, only mismatched posts hit UPDATE", async () => {
			const { db, batchCalls, calls } = createMockDb({
				allResults: {
					// 3 posts scanned in this batch.
					"FROM posts WHERE id >": [
						{ id: 100, thread_id: 1, forum_id: 5 },
						{ id: 101, thread_id: 1, forum_id: 5 },
						{ id: 102, thread_id: 2, forum_id: 9 }, // already correct
					],
					// Canonical forum for these threads.
					"SELECT id, forum_id FROM threads WHERE id IN": [
						{ id: 1, forum_id: 7 }, // posts 100, 101 mismatch (5 → 7)
						{ id: 2, forum_id: 9 }, // post 102 OK
					],
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({
					kind: "post-forums",
					total: 100,
					now: 1_700_000_000_000,
				}),
				batchSize: 3, // 3-row batch == batchSize → NOT terminal.
			});
			const res = await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(102); // last scanned id
			// processed = SCANNED posts (3); updated = MISMATCHED (2).
			expect(body.data.processed).toBe(3);
			expect(body.data.updated).toBe(2);
			expect(body.data.lastBatchUpdated).toBe(2);
			// UPDATE went through batch(). Verify ONLY mismatched ids hit
			// the statement list (not the already-correct id=102).
			expect(batchCalls.length).toBe(1);
			const stmts = batchCalls[0] as unknown[];
			expect(stmts.length).toBe(2);
			// And the SELECT plan: no `JOIN threads ON p.forum_id !=` —
			// only the cursor SELECT and the `WHERE id IN (...)` lookup.
			const sawJoinMismatchSql = calls.some(
				(c) => c.sql.includes("JOIN threads") && c.sql.includes("forum_id !="),
			);
			expect(sawJoinMismatchSql).toBe(false);
			const sawBatchLookup = calls.some(
				(c) => c.sql.includes("FROM threads WHERE id IN") && c.sql.includes("id, forum_id"),
			);
			expect(sawBatchLookup).toBe(true);
		});

		it("advance: orphaned posts (thread missing) are skipped, cursor still advances", async () => {
			const { db, batchCalls } = createMockDb({
				allResults: {
					"FROM posts WHERE id >": [
						{ id: 200, thread_id: 999, forum_id: 5 }, // thread 999 missing
					],
					"SELECT id, forum_id FROM threads WHERE id IN": [], // not found
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({
					kind: "post-forums",
					total: 100,
					now: 1_700_000_000_000,
				}),
				batchSize: 10, // 1 < 10 → short final → done.
			});
			const res = await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			// scanned 1, updated 0 (orphan skipped).
			expect(body.data.processed).toBe(1);
			expect(body.data.updated).toBe(0);
			expect(body.data.lastBatchUpdated).toBe(0);
			// No UPDATE batch issued (nothing mismatched).
			expect(batchCalls.length).toBe(0);
		});

		it("advance: empty batch transitions to done and renormalizes total down to processed", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM posts WHERE id >": [],
				},
			});
			const env = makeEnv({ DB: db });
			// total was 5000 at initialize; only 17 posts actually walked
			// before the next batch came up empty (many posts deleted
			// mid-run). Done snapshot must keep processed=17 and pull
			// total down to 17.
			await writeJob(env, {
				...makeInitialPayload({
					kind: "post-forums",
					total: 5_000,
					now: 1_700_000_000_000,
				}),
				cursor: 999,
				processed: 17,
				updated: 2,
			});
			const res = await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			expect(body.data.processed).toBe(17);
			expect(body.data.total).toBe(17);
			// updated/lastBatchUpdated carry through from the previous tick.
			expect(body.data.updated).toBe(2);
			expect(body.data.lastBatchUpdated).toBe(0);
		});

		it("advance: short final batch with OVERESTIMATED total normalizes total down to processed (C.1)", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM posts WHERE id >": [{ id: 500, thread_id: 1, forum_id: 7 }],
					"SELECT id, forum_id FROM threads WHERE id IN": [{ id: 1, forum_id: 7 }],
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({
					kind: "post-forums",
					total: 10_000,
					now: 1_700_000_000_000,
				}),
				cursor: 400,
				processed: 99,
				updated: 0,
				batchSize: 10, // 1 < 10 → short final → done.
			});
			const res = await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("done");
			// processed = 99 + 1 = 100 (real walked); total renormalized.
			expect(body.data.processed).toBe(100);
			expect(body.data.total).toBe(100);
		});

		it("finalize: bumpForumSummaryGen fires only when updated > 0", async () => {
			// Path A: full sweep, no mismatches → finalize must NOT bump.
			const { db: dbA } = createMockDb({
				allResults: {
					"FROM posts WHERE id >": [{ id: 1, thread_id: 1, forum_id: 7 }],
					"SELECT id, forum_id FROM threads WHERE id IN": [{ id: 1, forum_id: 7 }],
				},
			});
			const envA = makeEnv({ DB: dbA });
			await writeJob(envA, {
				...makeInitialPayload({
					kind: "post-forums",
					total: 1,
					now: 1_700_000_000_000,
				}),
				batchSize: 10, // short final → done in one tick.
			});
			await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums"),
				envA,
			);
			const persistedA = await readJob(envA, "post-forums");
			expect(persistedA?.status).toBe("done");
			expect(persistedA?.updated).toBe(0);
			// forum:summary:gen key must NOT have been written. The mock
			// KV exposes a put fn; check that no `forum:summary:gen:*`
			// write happened.
			const kvA = envA.KV as KVNamespace & { put: ReturnType<typeof vi.fn> };
			const summaryWritesA = (kvA.put as ReturnType<typeof vi.fn>).mock.calls.filter(
				(c) => typeof c[0] === "string" && c[0].includes("forum:summary:gen"),
			);
			expect(summaryWritesA.length).toBe(0);

			// Path B: full sweep, 1 mismatch → finalize MUST bump.
			const { db: dbB } = createMockDb({
				allResults: {
					"FROM posts WHERE id >": [{ id: 2, thread_id: 1, forum_id: 5 }],
					"SELECT id, forum_id FROM threads WHERE id IN": [{ id: 1, forum_id: 7 }],
				},
			});
			const envB = makeEnv({ DB: dbB });
			await writeJob(envB, {
				...makeInitialPayload({
					kind: "post-forums",
					total: 1,
					now: 1_700_000_000_000,
				}),
				batchSize: 10,
			});
			await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums"),
				envB,
			);
			const persistedB = await readJob(envB, "post-forums");
			expect(persistedB?.status).toBe("done");
			expect(persistedB?.updated).toBe(1);
			const kvB = envB.KV as KVNamespace & { put: ReturnType<typeof vi.fn> };
			const summaryWritesB = (kvB.put as ReturnType<typeof vi.fn>).mock.calls.filter(
				(c) => typeof c[0] === "string" && c[0].includes("forum:summary:gen"),
			);
			expect(summaryWritesB.length).toBeGreaterThan(0);
		});

		it("reset:true reopens a done job and re-runs posts.COUNT(*)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) as cnt FROM posts": { cnt: 8_888 },
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({
					kind: "post-forums",
					total: 100,
					now: 1_700_000_000_000,
				}),
				status: "done",
				processed: 100,
				finishedAt: 1_700_000_999_000,
			});
			const res = await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums", { reset: true }),
				env,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: StatsJobPayload };
			expect(body.data.status).toBe("running");
			expect(body.data.cursor).toBe(0);
			expect(body.data.total).toBe(8_888);
		});

		it("advance: IN-list chunks at IN_CHUNK (91 distinct thread ids → 2 chunks)", async () => {
			// 91 posts each with a unique thread_id → 91 distinct thread
			// ids → 2 IN-list lookups against threads (IN_CHUNK=90).
			const posts = Array.from({ length: 91 }, (_, i) => ({
				id: 1000 + i,
				thread_id: 1 + i,
				forum_id: 7,
			}));
			const threads = Array.from({ length: 91 }, (_, i) => ({ id: 1 + i, forum_id: 7 }));
			const { db, calls } = createMockDb({
				allResults: {
					"FROM posts WHERE id >": posts,
					"SELECT id, forum_id FROM threads WHERE id IN": threads,
				},
			});
			const env = makeEnv({ DB: db });
			await writeJob(env, {
				...makeInitialPayload({
					kind: "post-forums",
					total: 1_000,
					now: 1_700_000_000_000,
				}),
				batchSize: 91,
			});
			const res = await statistics.recalcPostForumIds(
				createAdminRequest("POST", "/api/admin/statistics/recalc-post-forums"),
				env,
			);
			expect(res.status).toBe(200);
			const inListCalls = calls.filter((c) => /FROM threads WHERE id IN \(/.test(c.sql));
			expect(inListCalls.length).toBe(2);
			// First chunk: 90 params; second: 1.
			expect(inListCalls[0]?.params.length).toBe(90);
			expect(inListCalls[1]?.params.length).toBe(1);
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
