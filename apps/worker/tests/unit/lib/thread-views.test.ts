// Unit tests for `scheduleThreadViewIncrement`.
//
// The helper is the single replacement point for the thread-views
// write contract — see `apps/worker/src/lib/thread-views.ts`. These
// tests pin three invariants:
//
//   1. The SQL handed to D1 is exactly `UPDATE threads SET views =
//      views + 1 WHERE id = ?` with the thread id bound. Any drift
//      (column rename, conditional clause, multi-row update) breaks
//      observability and must surface here, not in prod.
//   2. The UPDATE is registered with `ctx.waitUntil`, not as a bare
//      fire-and-forget. This was the original 1184179 bug — without
//      `waitUntil` the isolate may freeze before D1 acknowledges the
//      write.
//   3. D1 rejections do not leak: `console.warn` is called, but the
//      caller (and any awaited consumer of the `waitUntil` promise)
//      sees a resolved Promise. View bumps must be best-effort.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleThreadViewIncrement } from "../../../src/lib/thread-views";
import { createMockCtx, makeEnv } from "../../helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a D1 stub whose `prepare(...).bind(...).run()` resolves or
 * rejects per the caller's choice. The chain is captured so each test
 * can assert which SQL was prepared and which arguments were bound.
 */
function makeDb(runResult: { ok: true } | { ok: false; error: unknown }): {
	db: D1Database;
	prepareSpy: ReturnType<typeof vi.fn>;
	bindSpy: ReturnType<typeof vi.fn>;
	runSpy: ReturnType<typeof vi.fn>;
} {
	const runSpy = vi.fn(() =>
		runResult.ok ? Promise.resolve({ success: true }) : Promise.reject(runResult.error),
	);
	const bindSpy = vi.fn(() => ({ run: runSpy }));
	const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
	const db = { prepare: prepareSpy } as unknown as D1Database;
	return { db, prepareSpy, bindSpy, runSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scheduleThreadViewIncrement", () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it("registers the UPDATE with ctx.waitUntil exactly once", () => {
		const { db } = makeDb({ ok: true });
		const env = makeEnv({ DB: db });
		const ctx = createMockCtx() as ReturnType<typeof createMockCtx>;

		scheduleThreadViewIncrement(env, ctx, 42);

		expect((ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
		// What we hand to waitUntil must be a Promise (the Worker runtime
		// requires a thenable; the lifecycle hook is meaningless on a
		// synchronous value).
		const arg = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
		expect(arg).toBeInstanceOf(Promise);
	});

	it("prepares the exact view-bump SQL and binds the thread id", async () => {
		const { db, prepareSpy, bindSpy, runSpy } = makeDb({ ok: true });
		const env = makeEnv({ DB: db });
		const ctx = createMockCtx() as ReturnType<typeof createMockCtx> & {
			_waitUntilPromises: Promise<unknown>[];
		};

		scheduleThreadViewIncrement(env, ctx, 1184179);

		// Drain the waitUntil promise so the .then chain has executed
		// before we assert. The helper composes prepare/bind/run inside
		// the waitUntil-bound Promise tail, so D1 may not have been
		// touched yet at the synchronous return point.
		await Promise.all(ctx._waitUntilPromises);

		expect(prepareSpy).toHaveBeenCalledTimes(1);
		expect(prepareSpy).toHaveBeenCalledWith("UPDATE threads SET views = views + 1 WHERE id = ?");
		expect(bindSpy).toHaveBeenCalledTimes(1);
		expect(bindSpy).toHaveBeenCalledWith(1184179);
		expect(runSpy).toHaveBeenCalledTimes(1);
	});

	it("returns synchronously without throwing on D1 reject", () => {
		const { db } = makeDb({ ok: false, error: new Error("D1 boom") });
		const env = makeEnv({ DB: db });
		const ctx = createMockCtx() as ReturnType<typeof createMockCtx>;

		// The helper returns void synchronously; any rejection lives
		// inside the waitUntil-bound Promise, never bubbles to here.
		expect(() => scheduleThreadViewIncrement(env, ctx, 1)).not.toThrow();
	});

	it("swallows D1 rejection into console.warn and resolves the waitUntil promise", async () => {
		const boom = new Error("D1 unavailable");
		const { db } = makeDb({ ok: false, error: boom });
		const env = makeEnv({ DB: db });
		const ctx = createMockCtx() as ReturnType<typeof createMockCtx> & {
			_waitUntilPromises: Promise<unknown>[];
		};

		scheduleThreadViewIncrement(env, ctx, 99);

		// The waitUntil-bound Promise MUST resolve — if it rejected,
		// Workers would log an unhandled rejection and we'd be back to
		// silent fire-and-forget semantics.
		await expect(Promise.all(ctx._waitUntilPromises)).resolves.toEqual([undefined]);

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith("[thread-views] increment failed", {
			threadId: 99,
			err: boom,
		});
	});

	it("does not invoke ctx.waitUntil more than once per call", () => {
		const { db } = makeDb({ ok: true });
		const env = makeEnv({ DB: db });
		const ctx = createMockCtx() as ReturnType<typeof createMockCtx>;

		scheduleThreadViewIncrement(env, ctx, 7);
		scheduleThreadViewIncrement(env, ctx, 8);

		// Each call schedules exactly one waitUntil; callers MUST NOT
		// wrap a second waitUntil around this helper.
		expect((ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
	});

	it("survives a synchronous throw from env.DB.prepare", async () => {
		// Regression guard: an earlier implementation called `prepare`
		// synchronously in the argument expression of `ctx.waitUntil(...)`.
		// If `prepare` (or `bind`) ever throws synchronously — a plausible
		// future change if the D1 binding adds eager argument validation —
		// the helper must still register a waitUntil-bound task that
		// resolves and emits a warn, NOT propagate the throw into the
		// request hot path. Implementation must wrap the chain in
		// `Promise.resolve().then(...)` to convert sync throws into
		// rejected promises.
		const boom = new Error("prepare exploded synchronously");
		const db = {
			prepare: vi.fn(() => {
				throw boom;
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const ctx = createMockCtx() as ReturnType<typeof createMockCtx> & {
			_waitUntilPromises: Promise<unknown>[];
		};

		expect(() => scheduleThreadViewIncrement(env, ctx, 5)).not.toThrow();

		// A waitUntil-bound task must have been registered even though
		// `prepare` threw, and it must resolve (not reject).
		expect((ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
		await expect(Promise.all(ctx._waitUntilPromises)).resolves.toEqual([undefined]);

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith("[thread-views] increment failed", {
			threadId: 5,
			err: boom,
		});
	});
});
