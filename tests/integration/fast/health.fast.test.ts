/**
 * tests/integration/fast/health.fast.test.ts — sanity that the in-process
 * Worker harness boots and answers /api/live.
 *
 * No fixtures, no auth, no API key needed — /api/live is the pre-auth
 * health endpoint at apps/worker/src/index.ts:71. If this test passes
 * the L2-fast harness is functioning end-to-end (INIT_SQL → mock KV/R2
 * → worker.fetch → response).
 */

import "./_helpers/setup";

import { describe, expect, test } from "bun:test";
import { createTestEnv, workerFetch } from "./_helpers/env";

describe("L2-fast: GET /api/live", () => {
	test("returns 200 ok with a working D1 probe", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/live", { method: "GET" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status?: string;
			database?: { connected?: boolean };
			component?: string;
		};
		// The handler's contract: status=ok ⇔ database.connected=true ⇔ the
		// in-process D1 shim handled SELECT 1 correctly.
		expect(body.status).toBe("ok");
		expect(body.database?.connected).toBe(true);
		expect(body.component).toBe("ellie-worker");
	});

	test("each createTestEnv() yields an isolated DB (no shared state)", async () => {
		const env1 = createTestEnv();
		const env2 = createTestEnv();
		env1._sqlite.exec("INSERT INTO forums (name, status) VALUES ('only-in-env1', 0)");
		const env1Count = env1._sqlite
			.prepare("SELECT COUNT(*) AS cnt FROM forums WHERE name='only-in-env1'")
			.get() as { cnt: number };
		const env2Count = env2._sqlite
			.prepare("SELECT COUNT(*) AS cnt FROM forums WHERE name='only-in-env1'")
			.get() as { cnt: number };
		expect(env1Count.cnt).toBe(1);
		expect(env2Count.cnt).toBe(0);
	});
});
