import { STATISTICS_WRITE_HEADER } from "@ellie/types";
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createMockCtx, createMockDb, createMockKV, createMockR2, makeEnv } from "../helpers";

function frozenEnv() {
	const { db, calls } = createMockDb();
	const kv = createMockKV();
	const r2 = createMockR2();
	return {
		env: makeEnv({
			DB: db,
			KV: kv,
			R2: r2,
			DEPLOYMENT_FREEZE: "true",
			WEB_STATISTICS_WRITE_KEY: "freeze-test",
		}),
		calls,
		kv,
		r2,
	};
}

describe("deployment freeze", () => {
	it.each([
		["PATCH", "/api/admin/users/1"],
		["POST", "/api/v1/auth/login"],
		["POST", "/api/v1/upload"],
		["POST", "/api/internal/statistics/snapshot"],
		["POST", "/api/internal/statistics/batch"],
		["GET", "/api/v1/forums"],
		["DELETE", "/api/admin/users/1"],
		["OPTIONS", "/api/v1/upload"],
		["OPTIONS", "/api/internal/statistics/snapshot"],
		["HEAD", "/api/live"],
	])("blocks %s %s before storage or handler side effects", async (method, path) => {
		const { env, calls, kv, r2 } = frozenEnv();
		const ctx = createMockCtx();
		const response = await worker.fetch(
			new Request(`https://local.test${path}`, {
				method,
				headers: { "X-API-Key": env.ADMIN_API_KEY, [STATISTICS_WRITE_HEADER]: "freeze-test" },
			}),
			env,
			ctx,
		);
		expect(response.status).toBe(503);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(calls).toEqual([]);
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
		expect(r2.put).not.toHaveBeenCalled();
		expect(ctx.waitUntil).not.toHaveBeenCalled();
	});

	it("permits health and authenticated snapshot GETs without writes", async () => {
		const { env, calls, kv } = frozenEnv();
		const ctx = createMockCtx();
		expect((await worker.fetch(new Request("https://local.test/api/live"), env, ctx)).status).toBe(
			200,
		);
		const url = "https://local.test/api/internal/statistics/snapshot";
		expect((await worker.fetch(new Request(url), env, ctx)).status).toBe(401);
		expect(
			(
				await worker.fetch(
					new Request(url, { headers: { [STATISTICS_WRITE_HEADER]: "freeze-test" } }),
					env,
					ctx,
				)
			).status,
		).toBe(200);
		expect(calls.every((call) => call.sql === "SELECT 1 AS probe")).toBe(true);
		expect(kv.put).not.toHaveBeenCalled();
		expect(ctx.waitUntil).not.toHaveBeenCalled();
	});

	it("skips scheduled work while frozen", async () => {
		const { env, calls, kv } = frozenEnv();
		const ctx = createMockCtx();
		await worker.scheduled({ cron: "0 19 * * *" } as ScheduledEvent, env, ctx);
		expect(ctx.waitUntil).not.toHaveBeenCalled();
		expect(calls).toEqual([]);
		expect(kv.get).not.toHaveBeenCalled();
	});
});
