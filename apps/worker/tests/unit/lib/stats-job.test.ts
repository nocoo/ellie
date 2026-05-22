// Stats recalc-job state machine tests.
//
// Reviewer guard rails (msg=d646977b) under test:
//   - per-kind singleton:        readJob / writeJob target `stats:recalc-job:<kind>`
//                                and never read across kinds.
//   - state must survive 503:    a stranded `running` payload whose `leaseUntil`
//                                has passed is reclaimable on the next POST.
//   - duplicate POST guard:      while the lease is active, tickJob must NOT
//                                advance; it returns `code:"locked"`.
//   - schema version pinned:     v1 payload only; future versions read back as
//                                null so a corrupt write can't block all jobs.
//   - reset gate:                `body.reset === true` reopens a `done`/`failed`
//                                job; without it, no advance.
//   - finalize on done:          framing invokes ticker.finalize exactly once
//                                on the `running → done` transition, and a
//                                throw from finalize does NOT roll the job
//                                back to `failed`.

import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_BATCH_SIZE,
	JOB_LEASE_SECONDS,
	STATS_JOB_PAYLOAD_VERSION,
	type StatsJobPayload,
	type StatsJobTicker,
	makeInitialPayload,
	readJob,
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
		leaseUntil: 1_700_000_000_000 + JOB_LEASE_SECONDS * 1000,
		error: null,
		params: {},
		...overrides,
	};
}

// Minimal ticker — initialize/advance just shuffle counters so we can
// assert which one was invoked.
function makeTicker(
	overrides: Partial<StatsJobTicker> = {},
): StatsJobTicker & { initSpy: ReturnType<typeof vi.fn>; advanceSpy: ReturnType<typeof vi.fn> } {
	const initSpy = vi.fn(async () =>
		makeInitialPayload({ kind: "threads", total: 5_000, now: 1_700_000_000_000 }),
	);
	const advanceSpy = vi.fn(async (_env, prev: StatsJobPayload) => ({
		...prev,
		cursor: prev.cursor + DEFAULT_BATCH_SIZE,
		processed: prev.processed + DEFAULT_BATCH_SIZE,
		updated: prev.updated + 42,
		lastBatchUpdated: 42,
		// stop when we've covered total
		status:
			prev.total !== null && prev.processed + DEFAULT_BATCH_SIZE >= prev.total
				? ("done" as const)
				: ("running" as const),
		finishedAt:
			prev.total !== null && prev.processed + DEFAULT_BATCH_SIZE >= prev.total
				? 1_700_000_000_999
				: null,
		leaseUntil:
			prev.total !== null && prev.processed + DEFAULT_BATCH_SIZE >= prev.total
				? null
				: prev.leaseUntil,
	}));
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
		// Direct KV put with mismatched `kind` to simulate a poisoned write.
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
});

// ---------------------------------------------------------------------------
// tickJob — start, lease, reset, advance
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
		expect(ticker.initSpy).toHaveBeenCalledTimes(1);
		expect(ticker.advanceSpy).not.toHaveBeenCalled();

		// Persisted under the per-kind key.
		const persisted = await readJob(env, "threads");
		expect(persisted?.cursor).toBe(0);
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
});

describe("tickJob — duplicate POST guard (active lease)", () => {
	it("returns code:'locked' and does NOT advance while lease is still in the future", async () => {
		const env = makeEnv();
		const ticker = makeTicker();

		// Prime KV with a running snapshot whose lease is still active.
		const now = 1_700_000_000_000;
		await writeJob(env, snapshot({ leaseUntil: now + 30_000, lastTickAt: now }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("locked");
		expect(ticker.initSpy).not.toHaveBeenCalled();
		expect(ticker.advanceSpy).not.toHaveBeenCalled();
	});

	it("reclaims and advances once the lease has expired (503-survival path)", async () => {
		const env = makeEnv();
		const ticker = makeTicker();

		const now = 1_700_000_000_000;
		await writeJob(env, snapshot({ leaseUntil: now - 1, lastTickAt: now - 60_000 }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.advanced).toBe(true);
		expect(ticker.advanceSpy).toHaveBeenCalledTimes(1);

		// The reclaimed payload passed to advance must have a fresh lease.
		const passed = ticker.advanceSpy.mock.calls[0][1] as StatsJobPayload;
		expect(passed.leaseUntil).toBe(now + JOB_LEASE_SECONDS * 1000);
		expect(passed.lastTickAt).toBe(now);
	});
});

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

// ---------------------------------------------------------------------------
// tickJob — error path (advance throws)
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

		await writeJob(env, snapshot({ leaseUntil: now - 1 }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("error");
		if (result.code !== "error") throw new Error("unreachable");
		expect(result.error).toBe("D1 timeout");
		expect(result.payload.status).toBe("failed");
		expect(result.payload.leaseUntil).toBeNull();
		expect(result.payload.finishedAt).toBe(now);

		// Persisted as failed so the next POST without reset returns a
		// terminal snapshot rather than re-running advance.
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

		await writeJob(env, snapshot({ leaseUntil: now - 1 }));

		const result = await tickJob(env, ticker, {}, now);
		if (result.code !== "error") throw new Error("expected error");
		expect(result.error).toBe("plain string");
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

		// Configure ticker so the next advance completes the job in one step.
		const ticker: StatsJobTicker = {
			kind: "threads",
			initialize: vi.fn(),
			advance: vi.fn(async (_env, prev) => ({
				...prev,
				status: "done",
				processed: prev.total ?? 0,
				finishedAt: now,
				leaseUntil: null,
			})),
			finalize,
		};

		await writeJob(env, snapshot({ leaseUntil: now - 1, total: 1000 }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.payload.status).toBe("done");
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
				// Still running — half-way through.
			})),
			finalize,
		};

		await writeJob(env, snapshot({ leaseUntil: now - 1, total: 10_000 }));

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
				leaseUntil: null,
			})),
			finalize: vi.fn(async () => {
				throw new Error("cache bump failed");
			}),
		};

		await writeJob(env, snapshot({ leaseUntil: now - 1, total: 1000 }));

		const result = await tickJob(env, ticker, {}, now);

		expect(result.code).toBe("ok");
		if (result.code !== "ok") throw new Error("unreachable");
		expect(result.payload.status).toBe("done");

		// Persisted as done, not failed — finalize is best-effort.
		const persisted = await readJob(env, "threads");
		expect(persisted?.status).toBe("done");
	});
});

// ---------------------------------------------------------------------------
// makeInitialPayload — shape sanity
// ---------------------------------------------------------------------------

describe("makeInitialPayload", () => {
	it("produces a v1 running payload with cursor=0 and a fresh lease", () => {
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
		expect(p.leaseUntil).toBe(now + JOB_LEASE_SECONDS * 1000);
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
