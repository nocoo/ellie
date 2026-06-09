// Stats recalc-job state machine tests.
//
// Reviewer guard rails (msg=d646977b, msg=92086575) under test:
//   - per-kind singleton:        readJob / writeJob target `stats:recalc-job:<kind>`
//                                and never read across kinds.
//   - schema version pinned:     v1 payload only; future versions read back as
//                                null so a corrupt write can't block all jobs.
//   - lease ≠ running marker:    `leaseUntil` is non-null ONLY while a single
//                                `advance` call is mid-flight. An idle running
//                                job persists with leaseUntil:null so the very
//                                next POST can advance immediately (no 60s wait).
//                                A concurrent in-flight tick (lease > now) is
//                                what returns `code:"locked"`; a stale lease
//                                past `now` is reclaimed (503-survival path).
//   - reset gate:                `reset:true` reopens `done`/`failed` only.
//                                Running jobs return `code:"running"` (→ 409)
//                                so a live tick is never silently torn down.
//   - writeJob never silent:     a dropped checkpoint would replay the same
//                                cursor on the next tick; KV write failures
//                                propagate up through `tickJob`.
//   - finalize on done:          framing invokes ticker.finalize exactly once
//                                on the `running → done` transition, and a
//                                throw from finalize does NOT roll the job
//                                back to `failed`.

import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_BATCH_SIZE,
	JOB_LEASE_SECONDS,
	makeInitialPayload,
	readJob,
	STATS_JOB_PAYLOAD_VERSION,
	type StatsJobPayload,
	type StatsJobTicker,
	statsJobKey,
	tickJob,
	writeJob,
} from "../../../src/lib/stats-job";
import { makeEnv } from "../../helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshot(overrides: Partial<StatsJobPayload> = {}): StatsJobPayload {
	return {
		v: STATS_JOB_PAYLOAD_VERSION,
		kind: "threads",
		status: "running",
		cursor: 0,
		processed: 0,
		total: 10_000,
		updated: 0,
		lastBatchUpdated: 0,
		batchSize: DEFAULT_BATCH_SIZE,
		startedAt: 1_700_000_000_000,
		lastTickAt: 1_700_000_000_000,
		finishedAt: null,
		leaseUntil: null,
		error: null,
		params: {},
		...overrides,
	};
}

// Minimal ticker — initialize/advance just shuffle counters so we can
// assert which one was invoked. The framework now strips leaseUntil
// after advance, so ticker doesn't need to think about it.
function makeTicker(
	overrides: Partial<StatsJobTicker> = {},
): StatsJobTicker & { initSpy: ReturnType<typeof vi.fn>; advanceSpy: ReturnType<typeof vi.fn> } {
	const initSpy = vi.fn(async () =>
		makeInitialPayload({ kind: "threads", total: 5_000, now: 1_700_000_000_000 }),
	);
	const advanceSpy = vi.fn(async (_env, prev: StatsJobPayload) => {
		const newProcessed = prev.processed + DEFAULT_BATCH_SIZE;
		const isDone = prev.total !== null && newProcessed >= prev.total;
		return {
			...prev,
			cursor: prev.cursor + DEFAULT_BATCH_SIZE,
			processed: newProcessed,
			updated: prev.updated + 42,
			lastBatchUpdated: 42,
			status: isDone ? ("done" as const) : ("running" as const),
			finishedAt: isDone ? 1_700_000_000_999 : null,
		};
	});
	return {
		kind: "threads",
		initialize: initSpy,
		advance: advanceSpy,
		initSpy,
		advanceSpy,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// KV CRUD + schema
// ---------------------------------------------------------------------------

describe("stats-job KV CRUD", () => {
	it("statsJobKey is per-kind and matches the documented prefix", () => {
		expect(statsJobKey("forums")).toBe("stats:recalc-job:forums");
		expect(statsJobKey("threads")).toBe("stats:recalc-job:threads");
		expect(statsJobKey("users")).toBe("stats:recalc-job:users");
		expect(statsJobKey("post-forums")).toBe("stats:recalc-job:post-forums");
	});

	it("readJob returns null when KV is empty", async () => {
		const env = makeEnv();
		expect(await readJob(env, "threads")).toBeNull();
	});

	it("readJob round-trips a valid v1 payload", async () => {
		const env = makeEnv();
		const payload = snapshot({ processed: 1000 });
		await writeJob(env, payload);
		const got = await readJob(env, "threads");
		expect(got).not.toBeNull();
		expect(got?.processed).toBe(1000);
		expect(got?.kind).toBe("threads");
	});

	it("readJob rejects cross-kind reads (kind field mismatch)", async () => {
		const env = makeEnv();
		await env.KV.put(statsJobKey("threads"), JSON.stringify(snapshot({ kind: "users" })));
		expect(await readJob(env, "threads")).toBeNull();
	});

	it("readJob rejects unknown schema versions", async () => {
		const env = makeEnv();
		await env.KV.put(
			statsJobKey("threads"),
			JSON.stringify(snapshot({ v: STATS_JOB_PAYLOAD_VERSION + 1 })),
		);
		expect(await readJob(env, "threads")).toBeNull();
	});

	it("readJob rejects malformed payloads (missing required field)", async () => {
		const env = makeEnv();
		// Drop `cursor` via destructure to break the type guard. Using
		// rest-spread instead of `delete` keeps biome's noDelete happy.
		const { cursor: _cursor, ...bad } = snapshot();
		await env.KV.put(statsJobKey("threads"), JSON.stringify(bad));
		expect(await readJob(env, "threads")).toBeNull();
	});

	it("writeJob propagates KV errors (no silent swallow)", async () => {
		// A dropped checkpoint would cause the next tick to replay the
		// same cursor and double-update — `writeJob` must throw so the
		// caller can surface it (reviewer pin msg=92086575).
		const env = makeEnv();
		const boom = new Error("KV PUT 503");
		(env.KV.put as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
			throw boom;
		});
		await expect(writeJob(env, snapshot())).rejects.toThrow("KV PUT 503");
	});
});

// ---------------------------------------------------------------------------
// tickJob — start
// ---------------------------------------------------------------------------

describe("tickJob — start", () => {
	it("initializes when KV is empty and DOES NOT advance on the first POST", async () => {
		const env = makeEnv();
		const ticker = makeTicker();
		const now = 1_700_000_000_000;

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.advanced).toBe(false);
		expect(result.payload.cursor).toBe(0);
		expect(result.payload.status).toBe("running");
		// Reviewer pin (msg=92086575): no preset lease on initialize —
		// the very next POST must be able to advance immediately.
		expect(result.payload.leaseUntil).toBeNull();
		expect(ticker.initSpy).toHaveBeenCalledTimes(1);
		expect(ticker.advanceSpy).not.toHaveBeenCalled();

		const persisted = await readJob(env, "threads");
		expect(persisted?.cursor).toBe(0);
		expect(persisted?.leaseUntil).toBeNull();
	});

	it("forwards the request body to initialize so per-kind params land in payload.params", async () => {
		const env = makeEnv();
		const ticker = makeTicker({
			initialize: vi.fn(async (_env, body) =>
				makeInitialPayload({
					kind: "threads",
					total: null,
					params: { forumId: (body.forumId as number) ?? null },
				}),
			),
		});

		const result = await tickJob(env, ticker, { forumId: 7 });
		if (result.code !== "ok") throw new Error("expected ok");
		expect(result.payload.params).toEqual({ forumId: 7 });
	});

	it("second POST immediately after initialize advances (no 60s lease wait)", async () => {
		// This is the core regression test for the A.1 fix: previously
		// `makeInitialPayload` pre-stamped a 60s lease which made the
		// next POST hit `locked`. The driver only advances "1 batch per
		// POST", so the UI must be able to issue back-to-back POSTs.
		const env = makeEnv();
		const ticker = makeTicker();
		const now = 1_700_000_000_000;

		const first = await tickJob(env, ticker, {}, now);
		if (first.code !== "ok") throw new Error("expected ok");
		expect(first.advanced).toBe(false);

		const second = await tickJob(env, ticker, {}, now + 100); // 100ms later
		if (second.code !== "ok") throw new Error("expected ok on second POST");
		expect(second.advanced).toBe(true);
		expect(second.payload.cursor).toBe(DEFAULT_BATCH_SIZE);
		// Idle running job has no lease after advance returns.
		expect(second.payload.leaseUntil).toBeNull();
	});

	it("third POST immediately after advance advances again (lease cleared each tick)", async () => {
		const env = makeEnv();
		const ticker = makeTicker();
		const now = 1_700_000_000_000;

		await tickJob(env, ticker, {}, now); // initialize
		const second = await tickJob(env, ticker, {}, now + 100);
		if (second.code !== "ok") throw new Error("expected ok");

		const third = await tickJob(env, ticker, {}, now + 200);
		if (third.code !== "ok") throw new Error("expected ok on third POST");
		expect(third.advanced).toBe(true);
		expect(third.payload.cursor).toBe(DEFAULT_BATCH_SIZE * 2);
		expect(third.payload.leaseUntil).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// tickJob — concurrency guard
// ---------------------------------------------------------------------------

describe("tickJob — concurrent in-flight advance", () => {
	it("returns code:'locked' when another tick has staked the lease and is still mid-call", async () => {
		// Simulate the in-flight state directly: a payload whose
		// leaseUntil is set in the future represents a tick currently
		// inside `ticker.advance(...)`. The lease is staked + persisted
		// BEFORE advance runs, so any concurrent POST observes it.
		const env = makeEnv();
		const ticker = makeTicker();
		const now = 1_700_000_000_000;

		await writeJob(env, snapshot({ leaseUntil: now + 30_000, lastTickAt: now }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("locked");
		expect(ticker.initSpy).not.toHaveBeenCalled();
		expect(ticker.advanceSpy).not.toHaveBeenCalled();
	});

	it("reclaims and advances when a stale lease has passed (worker died mid-advance)", async () => {
		const env = makeEnv();
		const ticker = makeTicker();
		const now = 1_700_000_000_000;

		// leaseUntil is in the past → previous tick crashed without
		// clearing the lease. We must take over.
		await writeJob(env, snapshot({ leaseUntil: now - 1, lastTickAt: now - 60_000 }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.advanced).toBe(true);
		expect(ticker.advanceSpy).toHaveBeenCalledTimes(1);

		// The payload passed to advance carries a fresh stake; the
		// persisted post-advance snapshot has it cleared.
		const passed = ticker.advanceSpy.mock.calls[0][1] as StatsJobPayload;
		expect(passed.leaseUntil).toBe(now + JOB_LEASE_SECONDS * 1000);
		expect(passed.lastTickAt).toBe(now);
		expect(result.payload.leaseUntil).toBeNull();
	});

	it("persists the lease stake to KV BEFORE advance runs (so a concurrent POST sees `locked`)", async () => {
		const env = makeEnv();
		const now = 1_700_000_000_000;
		let observedLeaseDuringAdvance: number | null | undefined;

		// Inside `advance`, peek at what KV currently holds — that's
		// what a hypothetical second POST would see at this moment.
		const ticker: StatsJobTicker = {
			kind: "threads",
			initialize: vi.fn(),
			advance: vi.fn(async (envInner, prev) => {
				const persisted = await readJob(envInner, "threads");
				observedLeaseDuringAdvance = persisted?.leaseUntil;
				return { ...prev, cursor: prev.cursor + 1, processed: prev.processed + 1 };
			}),
		};

		await writeJob(env, snapshot({ leaseUntil: null }));
		await tickJob(env, ticker, {}, now);

		expect(observedLeaseDuringAdvance).toBe(now + JOB_LEASE_SECONDS * 1000);
	});
});

// ---------------------------------------------------------------------------
// tickJob — terminal states + reset
// ---------------------------------------------------------------------------

describe("tickJob — terminal states", () => {
	it("returns the snapshot without advancing when status is 'done' and reset is absent", async () => {
		const env = makeEnv();
		const ticker = makeTicker();

		await writeJob(env, snapshot({ status: "done", leaseUntil: null, finishedAt: 1 }));

		const result = await tickJob(env, ticker, {});

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.advanced).toBe(false);
		expect(result.payload.status).toBe("done");
		expect(ticker.advanceSpy).not.toHaveBeenCalled();
		expect(ticker.initSpy).not.toHaveBeenCalled();
	});

	it("returns the snapshot without advancing when status is 'failed' and reset is absent", async () => {
		const env = makeEnv();
		const ticker = makeTicker();

		await writeJob(
			env,
			snapshot({ status: "failed", leaseUntil: null, error: "boom", finishedAt: 1 }),
		);

		const result = await tickJob(env, ticker, {});

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.advanced).toBe(false);
		expect(result.payload.status).toBe("failed");
		expect(result.payload.error).toBe("boom");
	});

	it("reset:true reopens a done job by calling initialize again (advance NOT called)", async () => {
		const env = makeEnv();
		const ticker = makeTicker();

		await writeJob(env, snapshot({ status: "done", leaseUntil: null, finishedAt: 1 }));

		const result = await tickJob(env, ticker, { reset: true });

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.advanced).toBe(false);
		expect(result.payload.status).toBe("running");
		expect(result.payload.cursor).toBe(0);
		expect(result.payload.leaseUntil).toBeNull();
		expect(ticker.initSpy).toHaveBeenCalledTimes(1);
		expect(ticker.advanceSpy).not.toHaveBeenCalled();
	});

	it("reset:true also reopens a failed job", async () => {
		const env = makeEnv();
		const ticker = makeTicker();

		await writeJob(env, snapshot({ status: "failed", error: "old", leaseUntil: null }));

		const result = await tickJob(env, ticker, { reset: true });

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.payload.status).toBe("running");
		expect(result.payload.error).toBeNull();
	});
});

describe("tickJob — running + reset:true refusal", () => {
	it("refuses to tear down a live running job: returns code:'running' (→ 409)", async () => {
		// Reviewer pin (msg=92086575): the previous `!current || reset`
		// branch silently overwrote a running job. That's a footgun if a
		// dialog auto-sends reset:true on retry. We now require running
		// to land or fail before reset is accepted.
		const env = makeEnv();
		const ticker = makeTicker();
		const now = 1_700_000_000_000;

		await writeJob(env, snapshot({ status: "running", leaseUntil: null }));

		const result = await tickJob(env, ticker, { reset: true }, now);

		expect(result.code).toBe("running");
		expect(ticker.initSpy).not.toHaveBeenCalled();
		expect(ticker.advanceSpy).not.toHaveBeenCalled();

		// State is unchanged on disk.
		const persisted = await readJob(env, "threads");
		expect(persisted?.status).toBe("running");
		expect(persisted?.cursor).toBe(0);
	});

	it("refuses even when the running job has a stale lease (operator must wait or let it die)", async () => {
		const env = makeEnv();
		const ticker = makeTicker();
		const now = 1_700_000_000_000;

		await writeJob(env, snapshot({ status: "running", leaseUntil: now - 1 }));

		const result = await tickJob(env, ticker, { reset: true }, now);

		expect(result.code).toBe("running");
		expect(ticker.initSpy).not.toHaveBeenCalled();
		expect(ticker.advanceSpy).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// tickJob — error path (advance throws / writeJob throws)
// ---------------------------------------------------------------------------

describe("tickJob — advance throw → failed", () => {
	it("captures the error message and persists status=failed with leaseUntil cleared", async () => {
		const env = makeEnv();
		const now = 1_700_000_000_000;
		const ticker = makeTicker({
			advance: vi.fn(async () => {
				throw new Error("D1 timeout");
			}),
		});

		await writeJob(env, snapshot({ leaseUntil: null }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("error");
		if (result.code !== "error") throw new Error("unreachable");
		expect(result.error).toBe("D1 timeout");
		expect(result.payload.status).toBe("failed");
		expect(result.payload.leaseUntil).toBeNull();
		expect(result.payload.finishedAt).toBe(now);

		const persisted = await readJob(env, "threads");
		expect(persisted?.status).toBe("failed");
		expect(persisted?.error).toBe("D1 timeout");
	});

	it("normalizes non-Error throws into the error string", async () => {
		const env = makeEnv();
		const now = 1_700_000_000_000;
		const ticker = makeTicker({
			advance: vi.fn(async () => {
				// Deliberately throw a string (not an Error) to exercise
				// errMessage's non-Error branch.
				throw "plain string";
			}),
		});

		await writeJob(env, snapshot({ leaseUntil: null }));

		const result = await tickJob(env, ticker, {}, now);
		if (result.code !== "error") throw new Error("expected error");
		expect(result.error).toBe("plain string");
	});
});

describe("tickJob — writeJob throws", () => {
	it("propagates KV write failure during the post-advance checkpoint (no silent success)", async () => {
		const env = makeEnv();
		const now = 1_700_000_000_000;
		const ticker = makeTicker();

		// Pre-seed an idle running job so we go through the advance path.
		await writeJob(env, snapshot({ leaseUntil: null }));

		// First put = lease stake (no-op is fine; tickJob carries the
		// staked snapshot in memory). Second put = post-advance
		// checkpoint (must propagate). We don't recreate the in-memory
		// store impl because no other code in this test path reads it.
		const putMock = env.KV.put as ReturnType<typeof vi.fn>;
		putMock.mockImplementationOnce(async () => {
			// lease stake — allow
		});
		putMock.mockImplementationOnce(async () => {
			throw new Error("KV PUT 503");
		});

		await expect(tickJob(env, ticker, {}, now)).rejects.toThrow("KV PUT 503");
		// advance did run before the failing checkpoint.
		expect(ticker.advanceSpy).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// tickJob — finalize on done transition
// ---------------------------------------------------------------------------

describe("tickJob — finalize", () => {
	it("invokes finalize exactly once when status transitions to 'done'", async () => {
		const env = makeEnv();
		const now = 1_700_000_000_000;
		const finalize = vi.fn(async () => undefined);

		const ticker: StatsJobTicker = {
			kind: "threads",
			initialize: vi.fn(),
			advance: vi.fn(async (_env, prev) => ({
				...prev,
				status: "done",
				processed: prev.total ?? 0,
				finishedAt: now,
			})),
			finalize,
		};

		await writeJob(env, snapshot({ leaseUntil: null, total: 1000 }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.payload.status).toBe("done");
		// Framework strips leaseUntil even for `done` transitions.
		expect(result.payload.leaseUntil).toBeNull();
		expect(finalize).toHaveBeenCalledTimes(1);
	});

	it("does NOT invoke finalize when the batch leaves the job still running", async () => {
		const env = makeEnv();
		const now = 1_700_000_000_000;
		const finalize = vi.fn(async () => undefined);

		const ticker: StatsJobTicker = {
			kind: "threads",
			initialize: vi.fn(),
			advance: vi.fn(async (_env, prev) => ({
				...prev,
				cursor: prev.cursor + 1000,
				processed: prev.processed + 1000,
			})),
			finalize,
		};

		await writeJob(env, snapshot({ leaseUntil: null, total: 10_000 }));

		await tickJob(env, ticker, {}, now);

		expect(finalize).not.toHaveBeenCalled();
	});

	it("a throw from finalize does NOT roll the job back to failed", async () => {
		const env = makeEnv();
		const now = 1_700_000_000_000;
		const ticker: StatsJobTicker = {
			kind: "threads",
			initialize: vi.fn(),
			advance: vi.fn(async (_env, prev) => ({
				...prev,
				status: "done",
				processed: prev.total ?? 0,
				finishedAt: now,
			})),
			finalize: vi.fn(async () => {
				throw new Error("cache bump failed");
			}),
		};

		await writeJob(env, snapshot({ leaseUntil: null, total: 1000 }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.payload.status).toBe("done");

		const persisted = await readJob(env, "threads");
		expect(persisted?.status).toBe("done");
	});
});

// ---------------------------------------------------------------------------
// makeInitialPayload — shape sanity
// ---------------------------------------------------------------------------

describe("makeInitialPayload", () => {
	it("produces a v1 running payload with cursor=0 and leaseUntil=null", () => {
		const now = 1_700_000_000_000;
		const p = makeInitialPayload({ kind: "users", total: 12_345, now });

		expect(p.v).toBe(STATS_JOB_PAYLOAD_VERSION);
		expect(p.kind).toBe("users");
		expect(p.status).toBe("running");
		expect(p.cursor).toBe(0);
		expect(p.processed).toBe(0);
		expect(p.updated).toBe(0);
		expect(p.total).toBe(12_345);
		expect(p.startedAt).toBe(now);
		expect(p.lastTickAt).toBe(now);
		expect(p.finishedAt).toBeNull();
		expect(p.error).toBeNull();
		// Reviewer pin (msg=92086575): no preset lease — only an
		// in-flight `advance` window holds a non-null lease.
		expect(p.leaseUntil).toBeNull();
		expect(p.batchSize).toBe(DEFAULT_BATCH_SIZE);
		expect(p.params).toEqual({});
	});

	it("honors batchSize override and copies params", () => {
		const p = makeInitialPayload({
			kind: "threads",
			total: null,
			batchSize: 250,
			params: { forumId: 9 },
		});
		expect(p.batchSize).toBe(250);
		expect(p.params).toEqual({ forumId: 9 });
		expect(p.total).toBeNull();
	});
});
