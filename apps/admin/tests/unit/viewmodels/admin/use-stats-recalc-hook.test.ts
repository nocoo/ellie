// @vitest-environment happy-dom
//
// Unit tests for `useStatsRecalc` — the Phase E ViewModel hook driving
// each recalc card on /admin/statistics/recalc.
//
// Wire-contract notes (E.1 fix per reviewer msg=5c975973):
//   - 2xx body is the worker envelope `{data, meta}`. `data === null`
//     means "no job yet" (fresh GET). `data === snapshot` is real
//     progress.
//   - 4xx/5xx body is the flat `{error:{code, details:{payload?}}}`
//     shape from `errorResponse`, NOT envelope-wrapped.
//   - `parseRecalcResponse` takes `expectedKind` and rejects any
//     snapshot whose `kind` does not match.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type StatsJobSnapshot, isSnapshot } from "@/viewmodels/admin/stats-recalc";
import {
	type ParsedResponse,
	parseRecalcResponse,
	shouldAutoAdvance,
	useStatsRecalc,
} from "@/viewmodels/admin/use-stats-recalc";

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

/** Envelope-wrap a snapshot the way the worker actually returns 2xx. */
function envelope<T>(data: T) {
	return { data, meta: { timestamp: 0, requestId: "test-req" } };
}

/** Helper to mint a `Response`-ish object for vi.fn fetch. */
function mockResponse(body: unknown, init?: { status?: number; ok?: boolean }) {
	const status = init?.status ?? 200;
	return {
		ok: init?.ok ?? (status >= 200 && status < 300),
		status,
		statusText: status === 500 ? "Internal" : "OK",
		json: async () => body,
	} as Response;
}

function mockOk(snapshot: StatsJobSnapshot | null) {
	return mockResponse(envelope(snapshot));
}

function mockNonJson(status = 500) {
	return {
		ok: false,
		status,
		statusText: "Bad Gateway",
		json: async () => {
			throw new Error("bad json");
		},
	} as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("parseRecalcResponse", () => {
	it("returns snapshot on a 2xx enveloped body", async () => {
		const s = snap();
		const out = await parseRecalcResponse(mockOk(s), "forums");
		expect(out.kind).toBe("snapshot");
		if (out.kind === "snapshot") expect(out.snapshot).toEqual(s);
	});

	it("returns empty on a 2xx body with data:null (no job yet)", async () => {
		const out = await parseRecalcResponse(mockOk(null), "forums");
		expect(out.kind).toBe("empty");
	});

	it("rejects a cross-kind snapshot on 2xx as a hard error", async () => {
		const s = snap({ kind: "users" });
		const out = await parseRecalcResponse(mockOk(s), "forums");
		expect(out.kind).toBe("hard");
		if (out.kind === "hard") {
			expect(out.message).toContain("forums");
			expect(out.message).toContain("users");
			// Cross-kind payload is dropped, never assigned to the card.
			expect(out.snapshot).toBe(null);
		}
	});

	it("returns hard on a 2xx body without a `data` field", async () => {
		const out = await parseRecalcResponse(mockResponse({ meta: {} }), "forums");
		expect(out.kind).toBe("hard");
	});

	it("returns hard on a 2xx body with data of wrong shape", async () => {
		const out = await parseRecalcResponse(mockResponse({ data: { not: "snap" } }), "forums");
		expect(out.kind).toBe("hard");
	});

	it("returns hard on a 2xx primitive body", async () => {
		const out = await parseRecalcResponse(mockResponse(null), "forums");
		expect(out.kind).toBe("hard");
	});

	it("returns soft on 409 CONCURRENT_TICK with matching kind payload", async () => {
		const s = snap({ status: "running", processed: 10 });
		const body = { error: { code: "CONCURRENT_TICK", details: { payload: s } } };
		const out = await parseRecalcResponse(mockResponse(body, { status: 409, ok: false }), "forums");
		expect(out.kind).toBe("soft");
		if (out.kind === "soft") expect(out.snapshot).toEqual(s);
	});

	it("drops cross-kind payload on a soft 409", async () => {
		const body = {
			error: { code: "CONCURRENT_TICK", details: { payload: snap({ kind: "users" }) } },
		};
		const out = await parseRecalcResponse(mockResponse(body, { status: 409, ok: false }), "forums");
		expect(out.kind).toBe("soft");
		if (out.kind === "soft") expect(out.snapshot).toBe(null);
	});

	it("returns soft on 409 RUNNING_JOB_EXISTS", async () => {
		const body = { error: { code: "RUNNING_JOB_EXISTS", details: { payload: snap() } } };
		const out = await parseRecalcResponse(mockResponse(body, { status: 409, ok: false }), "forums");
		expect(out.kind).toBe("soft");
	});

	it("returns hard on 500 RECALC_FAILED with payload + error", async () => {
		const failed = snap({ status: "failed", error: "boom" });
		const body = {
			error: { code: "RECALC_FAILED", details: { payload: failed, error: "boom" } },
		};
		const out = await parseRecalcResponse(mockResponse(body, { status: 500, ok: false }), "forums");
		expect(out.kind).toBe("hard");
		if (out.kind === "hard") {
			expect(out.snapshot).toEqual(failed);
			expect(out.message).toBe("boom");
		}
	});

	it("drops cross-kind embedded payload on a hard error", async () => {
		const body = {
			error: {
				code: "RECALC_FAILED",
				details: { payload: snap({ kind: "threads" }), error: "boom" },
			},
		};
		const out = await parseRecalcResponse(mockResponse(body, { status: 500, ok: false }), "forums");
		expect(out.kind).toBe("hard");
		if (out.kind === "hard") expect(out.snapshot).toBe(null);
	});

	it("returns hard on body parse failure", async () => {
		const out = await parseRecalcResponse(mockNonJson(502), "forums");
		expect(out.kind).toBe("hard");
		if (out.kind === "hard") expect(out.snapshot).toBe(null);
	});

	it("uses error.message when details.error is missing", async () => {
		const body = { error: { code: "WHATEVER", message: "fallback message" } };
		const out = await parseRecalcResponse(mockResponse(body, { status: 400, ok: false }), "forums");
		expect(out.kind).toBe("hard");
		if (out.kind === "hard") expect(out.message).toBe("fallback message");
	});

	it("falls back to code when no message", async () => {
		const body = { error: { code: "WEIRD" } };
		const out = await parseRecalcResponse(mockResponse(body, { status: 400, ok: false }), "forums");
		if (out.kind === "hard") expect(out.message).toBe("WEIRD");
	});

	it("falls back to HTTP status when error envelope absent", async () => {
		const out = await parseRecalcResponse(mockResponse({}, { status: 418, ok: false }), "forums");
		if (out.kind === "hard") expect(out.message).toBe("HTTP 418");
	});
});

describe("shouldAutoAdvance", () => {
	it("returns false when autoAdvance is off", () => {
		expect(shouldAutoAdvance(snap(), false, false)).toBe(false);
	});
	it("returns false when posting", () => {
		expect(shouldAutoAdvance(snap(), true, true)).toBe(false);
	});
	it("returns false when snapshot is null", () => {
		expect(shouldAutoAdvance(null, false, true)).toBe(false);
	});
	it("returns false when status is done", () => {
		expect(shouldAutoAdvance(snap({ status: "done" }), false, true)).toBe(false);
	});
	it("returns true on running + idle + autoAdvance", () => {
		expect(shouldAutoAdvance(snap({ status: "running" }), false, true)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Hook lifecycle
// ---------------------------------------------------------------------------

describe("useStatsRecalc — lifecycle", () => {
	it("fetches initial snapshot on mount (real envelope wire shape)", async () => {
		const s = snap({ status: "done" });
		fetchMock.mockResolvedValueOnce(mockOk(s));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "forums", pollIntervalMs: 999_999, autoAdvance: false }),
		);

		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		expect(result.current.state.snapshot).toEqual(s);
		expect(result.current.state.error).toBe(null);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/admin/statistics/job/forums",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("initial GET with data:null lands as snapshot:null without error", async () => {
		fetchMock.mockResolvedValueOnce(mockOk(null));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "post-forums", pollIntervalMs: 999_999, autoAdvance: false }),
		);

		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		expect(result.current.state.snapshot).toBe(null);
		expect(result.current.state.error).toBe(null);
	});

	it("surfaces a network throw on the initial GET", async () => {
		fetchMock.mockRejectedValueOnce(new Error("offline"));
		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "forums", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});
		expect(result.current.state.error).toBe("offline");
	});

	it("start() POSTs with no body and updates snapshot via envelope", async () => {
		// Initial GET → data:null (no job yet).
		fetchMock.mockResolvedValueOnce(mockOk(null));
		const initial = snap({ kind: "users", status: "running" });
		fetchMock.mockResolvedValueOnce(mockOk(initial));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "users", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		await act(async () => {
			await result.current.actions.start();
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/admin/statistics/recalc-users",
			expect.objectContaining({ method: "POST", body: undefined }),
		);
		expect(result.current.state.snapshot?.kind).toBe("users");
	});

	it("reset() POSTs {reset:true}", async () => {
		const done = snap({ kind: "threads", status: "done" });
		fetchMock.mockResolvedValueOnce(mockOk(done));
		const fresh = snap({ kind: "threads", status: "running", processed: 0 });
		fetchMock.mockResolvedValueOnce(mockOk(fresh));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "threads", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		await act(async () => {
			await result.current.actions.reset();
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/admin/statistics/recalc-threads",
			expect.objectContaining({ method: "POST", body: JSON.stringify({ reset: true }) }),
		);
	});

	it("treats 409 CONCURRENT_TICK as a soft conflict — clears error, keeps payload", async () => {
		const running = snap({ status: "running", processed: 100 });
		fetchMock.mockResolvedValueOnce(mockOk(running));
		const updated = snap({ status: "running", processed: 250 });
		const body = { error: { code: "CONCURRENT_TICK", details: { payload: updated } } };
		fetchMock.mockResolvedValueOnce(mockResponse(body, { status: 409, ok: false }));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "forums", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		await act(async () => {
			await result.current.actions.advance();
		});

		expect(result.current.state.error).toBe(null);
		expect(result.current.state.snapshot?.processed).toBe(250);
	});

	it("rejects a cross-kind 2xx snapshot — sets error, drops payload", async () => {
		fetchMock.mockResolvedValueOnce(mockOk(null)); // initial GET
		// POST returns a snapshot belonging to a DIFFERENT kind. The
		// `users` card must not start showing `forums` progress — instead
		// the parser flags this as a hard contract error.
		fetchMock.mockResolvedValueOnce(mockOk(snap({ kind: "forums" })));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "users", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		await act(async () => {
			await result.current.actions.advance();
		});

		expect(result.current.state.error).toContain("kind");
		expect(result.current.state.snapshot).toBe(null);
	});

	it("surfaces a hard error on 500 with the embedded failed snapshot", async () => {
		fetchMock.mockResolvedValueOnce(mockOk(snap({ status: "running" })));
		const failed = snap({ status: "failed", error: "boom" });
		const body = {
			error: { code: "RECALC_FAILED", details: { payload: failed, error: "boom" } },
		};
		fetchMock.mockResolvedValueOnce(mockResponse(body, { status: 500, ok: false }));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "forums", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		await act(async () => {
			await result.current.actions.advance();
		});

		expect(result.current.state.error).toBe("boom");
		expect(result.current.state.snapshot?.status).toBe("failed");
	});

	it("guards against a second POST while one is in flight", async () => {
		fetchMock.mockResolvedValueOnce(mockOk(snap({ status: "running" })));

		let resolveFetch: (v: Response) => void = () => {};
		const slow = new Promise<Response>((r) => {
			resolveFetch = r;
		});
		fetchMock.mockReturnValueOnce(slow);

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "forums", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		let firstPromise!: Promise<void>;
		let secondPromise!: Promise<void>;
		await act(async () => {
			firstPromise = result.current.actions.advance();
			secondPromise = result.current.actions.advance();
		});

		expect(fetchMock).toHaveBeenCalledTimes(2); // 1 GET + 1 POST
		expect(result.current.state.isPosting).toBe(true);

		await act(async () => {
			resolveFetch(mockOk(snap({ status: "running", processed: 1 })));
			await firstPromise;
			await secondPromise;
		});

		expect(result.current.state.isPosting).toBe(false);
		expect(result.current.state.snapshot?.processed).toBe(1);
	});

	it("auto-advances on the polling tick while running", async () => {
		const s1 = snap({ status: "running", processed: 0 });
		const s2 = snap({ status: "running", processed: 100 });
		const s3 = snap({ status: "done", processed: 200 });
		fetchMock
			.mockResolvedValueOnce(mockOk(s1)) // initial GET
			.mockResolvedValueOnce(mockOk(s2)) // 1st auto-advance POST
			.mockResolvedValueOnce(mockOk(s3)); // 2nd auto-advance POST → done

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "forums", pollIntervalMs: 20, autoAdvance: true }),
		);
		await waitFor(() => {
			expect(result.current.state.snapshot?.status).toBe("done");
		});

		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it("refresh() does a GET without posting", async () => {
		const s = snap({ status: "done" });
		fetchMock.mockResolvedValueOnce(mockOk(s));
		const refreshed = snap({ status: "done", lastTickAt: 1_700_000_999_999 });
		fetchMock.mockResolvedValueOnce(mockOk(refreshed));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "forums", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		await act(async () => {
			await result.current.actions.refresh();
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/admin/statistics/job/forums",
			expect.objectContaining({ method: "GET" }),
		);
		expect(result.current.state.snapshot?.lastTickAt).toBe(1_700_000_999_999);
	});

	it("surfaces a network throw on POST", async () => {
		fetchMock.mockResolvedValueOnce(mockOk(snap({ status: "running" })));
		fetchMock.mockRejectedValueOnce(new Error("post failed"));

		const { result } = renderHook(() =>
			useStatsRecalc({ kind: "forums", pollIntervalMs: 999_999, autoAdvance: false }),
		);
		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});
		await act(async () => {
			await result.current.actions.advance();
		});
		expect(result.current.state.error).toBe("post failed");
	});

	it("exports ParsedResponse and isSnapshot for downstream consumers", () => {
		const x: ParsedResponse = { kind: "soft", snapshot: null };
		expect(x.kind).toBe("soft");
		expect(isSnapshot(snap())).toBe(true);
	});
});
