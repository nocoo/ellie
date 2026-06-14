/**
 * tests/integration/fast/_helpers/env — L2-fast entry point.
 *
 * Boots a fresh in-process Worker against a `:memory:` SQLite for each
 * test. Zero subprocess overhead vs the wrangler-dev-based L2-http suite.
 *
 * Run under `bun test` (uses bun:sqlite). Vitest cannot import this file.
 *
 * Surface:
 *   - createTestEnv()           — new :memory: DB + mock KV/R2 + Env vars
 *   - createTestCtx()           — ExecutionContext shim that captures waitUntil
 *   - setCurrentTestCtx()       — beforeEach hook: install current-test ctx
 *   - flushCurrentTestCtx()     — afterEach hook: drain waitUntil + rethrow first error
 *   - workerFetch(env, …)       — invoke the in-process Worker, returns Response
 *   - workerFetchWithCtx(…)     — same but returns { res, ctx } for explicit flush
 *
 * See docs/23-local-test-stack.md §2.3 / §2.5.
 */

import { Database } from "bun:sqlite";
import worker from "../../../../apps/worker/src/index";
import type { Env } from "../../../../apps/worker/src/lib/env";
import { wrapAsD1 } from "../../../../apps/worker/src/test-support/d1-shim";
import { INIT_SQL } from "../../../../apps/worker/src/test-support/init-sql.generated";
import { createMockKV, createMockR2 } from "../../../../apps/worker/src/test-support/mocks";

export interface TestEnv extends Env {
	/** Direct handle to the underlying sqlite so tests can seed/inspect rows. */
	_sqlite: Database;
}

export function createTestEnv(overrides: Partial<Env> = {}): TestEnv {
	const sqlite = new Database(":memory:");
	sqlite.exec(INIT_SQL);
	return {
		DB: wrapAsD1(sqlite),
		KV: createMockKV(),
		R2: createMockR2(),
		API_KEY: "test-api-key",
		ADMIN_API_KEY: "test-admin-api-key",
		JWT_SECRET: "test-secret-key-for-jwt-hs256",
		ENVIRONMENT: "test",
		ALLOWED_ORIGINS: "*",
		DOVE_BASE_URL: "https://dove.test",
		DOVE_PROJECT_ID: "test-proj",
		DOVE_TEMPLATE_SLUG: "verify-email",
		DOVE_WEBHOOK_TOKEN: "test-token-not-real",
		EMAIL_VERIFY_HMAC_KEY: "test-hmac-key",
		_sqlite: sqlite,
		...overrides,
	} as TestEnv;
}

// ─── ExecutionContext capture + flush ─────────────────────────────

type Settled = { ok: true } | { ok: false; err: unknown };

export interface TestCtx extends ExecutionContext {
	flush(): Promise<void>;
}

export function createTestCtx(): TestCtx {
	const tasks: Promise<Settled>[] = [];
	return {
		waitUntil(p: Promise<unknown>) {
			tasks.push(
				Promise.resolve(p).then(
					() => ({ ok: true }) as Settled,
					(err: unknown) => ({ ok: false, err }) as Settled,
				),
			);
		},
		passThroughOnException() {},
		props: undefined as unknown as ExecutionContext["props"],
		flush: async () => {
			const all = tasks.splice(0, tasks.length);
			const results = await Promise.all(all);
			const failed = results.find((r): r is { ok: false; err: unknown } => !r.ok);
			if (failed) throw failed.err;
		},
	} as TestCtx;
}

let CURRENT_TEST_CTX: TestCtx | null = null;

/** Install a fresh ctx for the current test. Call in beforeEach. */
export function setCurrentTestCtx(): TestCtx {
	CURRENT_TEST_CTX = createTestCtx();
	return CURRENT_TEST_CTX;
}

/** Drain the current ctx's queued waitUntil promises. Call in afterEach. */
export async function flushCurrentTestCtx(): Promise<void> {
	const ctx = CURRENT_TEST_CTX;
	CURRENT_TEST_CTX = null;
	if (ctx) await ctx.flush();
}

// ─── Worker invocation ────────────────────────────────────────────

/**
 * Invoke the in-process Worker. Returns the Response. If a harness ctx
 * was installed via setCurrentTestCtx(), the worker's `ctx.waitUntil`
 * promises queue on that shared ctx and the harness's afterEach
 * (flushCurrentTestCtx) will flush + rethrow any failures. Without a
 * harness ctx, a one-shot ctx is created and flushed before returning —
 * slightly slower but never silent.
 */
export async function workerFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
	const useShared = CURRENT_TEST_CTX != null;
	const ctx = (CURRENT_TEST_CTX ?? createTestCtx()) as TestCtx;
	const res = await worker.fetch(
		new Request(`http://localhost${path}`, init) as never,
		env,
		ctx as ExecutionContext,
	);
	if (!useShared) await ctx.flush();
	return res;
}

/**
 * Variant that returns the ExecutionContext so the caller can await
 * `ctx.flush()` mid-test to assert on side-effects of waitUntil tasks.
 * The ctx defaults to the current harness ctx (or a fresh one).
 */
export async function workerFetchWithCtx(
	env: Env,
	path: string,
	init?: RequestInit,
	ctx: TestCtx = (CURRENT_TEST_CTX ?? createTestCtx()) as TestCtx,
): Promise<{ res: Response; ctx: TestCtx }> {
	const res = await worker.fetch(
		new Request(`http://localhost${path}`, init) as never,
		env,
		ctx as ExecutionContext,
	);
	return { res, ctx };
}
