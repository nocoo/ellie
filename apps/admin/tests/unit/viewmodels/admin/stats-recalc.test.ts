// Unit tests for pure helpers in viewmodels/admin/stats-recalc.ts.
// Hook lifecycle / fetch + timer plumbing is covered separately in
// use-stats-recalc-hook.test.ts (happy-dom). Keeping these pure tests
// in the default node environment so they run fast and stay
// independent of the React renderer.

import { describe, expect, it } from "vitest";

import {
	type StatsJobSnapshot,
	extractSnapshotFromError,
	formatPercent,
	formatProcessedTotal,
	formatTickTime,
	isSnapshot,
	isSoftConflictCode,
	jobEndpoint,
	percentValue,
	recalcEndpoint,
	snapshotStatusLabel,
	snapshotStatusVariant,
} from "@/viewmodels/admin/stats-recalc";

function snap(overrides: Partial<StatsJobSnapshot> = {}): StatsJobSnapshot {
	return {
		v: 1,
		kind: "forums",
		status: "running",
		cursor: 0,
		processed: 0,
		total: 100,
		updated: 0,
		lastBatchUpdated: 0,
		batchSize: 1000,
		startedAt: 1_700_000_000_000,
		lastTickAt: 1_700_000_000_000,
		finishedAt: null,
		leaseUntil: null,
		error: null,
		params: {},
		...overrides,
	};
}

describe("isSnapshot", () => {
	it("accepts a v1 payload matching the shape", () => {
		expect(isSnapshot(snap())).toBe(true);
	});

	it("rejects non-object inputs", () => {
		expect(isSnapshot(null)).toBe(false);
		expect(isSnapshot(undefined)).toBe(false);
		expect(isSnapshot("string")).toBe(false);
		expect(isSnapshot(42)).toBe(false);
	});

	it("rejects unknown kinds", () => {
		const broken = { ...snap(), kind: "unknown" } as unknown;
		expect(isSnapshot(broken)).toBe(false);
	});

	it("rejects unknown statuses", () => {
		const broken = { ...snap(), status: "bogus" } as unknown;
		expect(isSnapshot(broken)).toBe(false);
	});

	it("rejects when required numeric field is missing", () => {
		const { cursor: _cursor, ...rest } = snap();
		expect(isSnapshot(rest)).toBe(false);
	});

	it("accepts null total and null finishedAt", () => {
		expect(isSnapshot(snap({ total: null, finishedAt: null, leaseUntil: null }))).toBe(true);
	});

	it("rejects total of wrong type", () => {
		expect(isSnapshot({ ...snap(), total: "100" } as unknown)).toBe(false);
	});

	it("rejects when error field has wrong type", () => {
		expect(isSnapshot({ ...snap(), error: 42 } as unknown)).toBe(false);
	});

	it("rejects when finishedAt is a string", () => {
		expect(isSnapshot({ ...snap(), finishedAt: "now" } as unknown)).toBe(false);
	});

	it("rejects when leaseUntil is a string", () => {
		expect(isSnapshot({ ...snap(), leaseUntil: "soon" } as unknown)).toBe(false);
	});

	it("rejects future schema versions (v !== 1)", () => {
		// Strict v1 lock per reviewer msg=5c975973 P1 — a v2 payload must
		// not be rendered as-if v1 just because the field types overlap.
		expect(isSnapshot({ ...snap(), v: 2 } as unknown)).toBe(false);
		expect(isSnapshot({ ...snap(), v: 0 } as unknown)).toBe(false);
		expect(isSnapshot({ ...snap(), v: "1" } as unknown)).toBe(false);
	});

	it("rejects when params is null", () => {
		expect(isSnapshot({ ...snap(), params: null } as unknown)).toBe(false);
	});

	it("rejects when params is an array", () => {
		// Arrays are typeof "object" — guard must explicitly reject them.
		expect(isSnapshot({ ...snap(), params: [] } as unknown)).toBe(false);
	});

	it("rejects when params is a primitive", () => {
		expect(isSnapshot({ ...snap(), params: 0 } as unknown)).toBe(false);
		expect(isSnapshot({ ...snap(), params: "x" } as unknown)).toBe(false);
	});
});

describe("extractSnapshotFromError", () => {
	it("returns the embedded payload from a 409 envelope", () => {
		const payload = snap({ status: "running", processed: 1000 });
		const body = { error: { code: "CONCURRENT_TICK", details: { payload } } };
		expect(extractSnapshotFromError(body)).toEqual(payload);
	});

	it("returns null when the body is not an object", () => {
		expect(extractSnapshotFromError(null)).toBe(null);
		expect(extractSnapshotFromError("oops")).toBe(null);
	});

	it("returns null when error is missing", () => {
		expect(extractSnapshotFromError({})).toBe(null);
	});

	it("returns null when error.details is missing", () => {
		expect(extractSnapshotFromError({ error: { code: "X" } })).toBe(null);
	});

	it("returns null when payload is not a valid snapshot", () => {
		expect(extractSnapshotFromError({ error: { details: { payload: { not: "valid" } } } })).toBe(
			null,
		);
	});

	it("returns null when error is not an object", () => {
		expect(extractSnapshotFromError({ error: "not-an-object" })).toBe(null);
	});
});

describe("isSoftConflictCode", () => {
	it("returns true for CONCURRENT_TICK", () => {
		expect(isSoftConflictCode("CONCURRENT_TICK")).toBe(true);
	});
	it("returns true for RUNNING_JOB_EXISTS", () => {
		expect(isSoftConflictCode("RUNNING_JOB_EXISTS")).toBe(true);
	});
	it("returns false for RECALC_FAILED", () => {
		expect(isSoftConflictCode("RECALC_FAILED")).toBe(false);
	});
	it("returns false for empty string", () => {
		expect(isSoftConflictCode("")).toBe(false);
	});
});

describe("snapshotStatusVariant + label", () => {
	it("maps running → secondary", () => {
		expect(snapshotStatusVariant("running")).toBe("secondary");
		expect(snapshotStatusLabel("running")).toBe("运行中");
	});
	it("maps done → success", () => {
		expect(snapshotStatusVariant("done")).toBe("success");
		expect(snapshotStatusLabel("done")).toBe("已完成");
	});
	it("maps failed → destructive", () => {
		expect(snapshotStatusVariant("failed")).toBe("destructive");
		expect(snapshotStatusLabel("failed")).toBe("失败");
	});
});

describe("formatPercent / percentValue", () => {
	it("renders em-dash when total is null", () => {
		expect(formatPercent(50, null)).toBe("—");
		expect(percentValue(50, null)).toBe(0);
	});

	it("treats total=0 as 100% (empty sweep)", () => {
		expect(formatPercent(0, 0)).toBe("100%");
		expect(percentValue(0, 0)).toBe(100);
	});

	it("clamps overshoot to 100%", () => {
		expect(formatPercent(200, 100)).toBe("100%");
		expect(percentValue(200, 100)).toBe(100);
	});

	it("clamps negatives to 0%", () => {
		expect(formatPercent(-1, 100)).toBe("0%");
		expect(percentValue(-1, 100)).toBe(0);
	});

	it("floors to integer percent", () => {
		expect(formatPercent(33, 100)).toBe("33%");
		expect(formatPercent(1, 3)).toBe("33%");
		expect(percentValue(1, 4)).toBeCloseTo(25);
	});
});

describe("formatProcessedTotal", () => {
	it("formats with thousands separators", () => {
		expect(formatProcessedTotal(12345, 67890)).toContain("12,345");
		expect(formatProcessedTotal(12345, 67890)).toContain("67,890");
	});
	it("renders em-dash for null denominator", () => {
		expect(formatProcessedTotal(10, null)).toContain("—");
	});
});

describe("formatTickTime", () => {
	it("formats a valid epoch ms", () => {
		const formatted = formatTickTime(1_700_000_000_000);
		expect(typeof formatted).toBe("string");
		expect(formatted.length).toBeGreaterThan(0);
		expect(formatted).not.toBe("—");
	});
	it("returns em-dash for non-finite input", () => {
		expect(formatTickTime(Number.NaN)).toBe("—");
		expect(formatTickTime(0)).toBe("—");
		expect(formatTickTime(-1)).toBe("—");
	});
});

describe("endpoint helpers", () => {
	it("builds recalcEndpoint per kind", () => {
		expect(recalcEndpoint("forums")).toBe("/api/admin/statistics/recalc-forums");
		expect(recalcEndpoint("threads")).toBe("/api/admin/statistics/recalc-threads");
		expect(recalcEndpoint("users")).toBe("/api/admin/statistics/recalc-users");
		expect(recalcEndpoint("post-forums")).toBe("/api/admin/statistics/recalc-post-forums");
	});

	it("builds jobEndpoint per kind", () => {
		expect(jobEndpoint("forums")).toBe("/api/admin/statistics/job/forums");
		expect(jobEndpoint("post-forums")).toBe("/api/admin/statistics/job/post-forums");
	});
});
