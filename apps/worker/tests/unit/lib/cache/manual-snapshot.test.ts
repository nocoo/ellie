import { afterEach, describe, expect, it, vi } from "vitest";
import { overview, snapshot } from "../../../../src/handlers/admin/kv";
import {
	captureMonitorSnapshot,
	MONITOR_SNAPSHOT_KEY,
	readMonitorSnapshot,
} from "../../../../src/lib/cache/admin-monitor-read";
import { cacheGetOrSet } from "../../../../src/lib/cache/wrap";
import { createAdminRequest, createMockDb, createMockKV, makeEnv } from "../../../helpers";
import { readingFixture } from "./thread-cache-fixture";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("administrator-triggered cache snapshot", () => {
	it("opening an empty monitor does not scan KV, write or query D1", async () => {
		const env = makeEnv({ KV: createMockKV(), DB: createMockDb().db });
		const response = await overview(createAdminRequest("GET", "/api/admin/kv/overview"), env);
		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ families: [], observedAt: null });
		expect(env.KV.get).toHaveBeenCalledExactlyOnceWith(MONITOR_SNAPSHOT_KEY, "json");
		expect(env.KV.list).not.toHaveBeenCalled();
		expect(env.KV.put).not.toHaveBeenCalled();
		expect(env.DB.prepare).not.toHaveBeenCalled();
	});

	it("only capture scans; reads preserve the original timestamp even after a week", async () => {
		vi.useFakeTimers();
		const env = makeEnv({
			KV: createMockKV({ "refresh:secret-token": "1", "online:42": "{}" }),
			DB: createMockDb().db,
		});
		const response = await snapshot(createAdminRequest("POST", "/api/admin/kv/snapshot", {}), env);
		expect(response.status).toBe(200);
		const captured = (await response.json()).data;
		expect(JSON.stringify(captured)).not.toContain("secret-token");
		expect(JSON.stringify(captured)).not.toContain('"online:42"');
		expect(env.KV.put).toHaveBeenCalledExactlyOnceWith(
			MONITOR_SNAPSHOT_KEY,
			JSON.stringify(captured),
		);
		expect(env.DB.prepare).not.toHaveBeenCalled();
		vi.mocked(env.KV.list).mockClear();
		vi.mocked(env.KV.put).mockClear();
		vi.advanceTimersByTime(8 * 86_400_000);
		expect(await readMonitorSnapshot(env)).toEqual(captured);
		expect(env.KV.list).not.toHaveBeenCalled();
		expect(env.KV.put).not.toHaveBeenCalled();
	});

	it.each(["scan", "save"])("preserves the previous snapshot on a %s failure", async (failure) => {
		const env = makeEnv({ KV: createMockKV() });
		const previous = await captureMonitorSnapshot(env);
		if (failure === "scan") vi.mocked(env.KV.list).mockRejectedValue(new Error("scan failed"));
		else vi.mocked(env.KV.put).mockRejectedValue(new Error("save failed"));
		await expect(captureMonitorSnapshot(env)).rejects.toThrow(`${failure} failed`);
		expect(await readMonitorSnapshot(env)).toEqual(previous);
	});

	it("rejects corrupt saved data without an implicit scan", async () => {
		const env = makeEnv({ KV: createMockKV({ [MONITOR_SNAPSHOT_KEY]: "{}" }) });
		await expect(readMonitorSnapshot(env)).rejects.toThrow("Saved cache snapshot is invalid");
		expect(env.KV.list).not.toHaveBeenCalled();
		expect(env.KV.put).not.toHaveBeenCalled();
	});

	it("ordinary cache traffic across hour boundaries never writes monitoring rows", async () => {
		vi.useFakeTimers();
		const f = readingFixture();
		try {
			for (let hour = 0; hour < 3; hour++) {
				await cacheGetOrSet(f.env, f.ctx, "snapshot-cost-check", async () => ({ count: 1 }), {
					family: "thread:stats",
					tier: "SHORT",
				});
				await Promise.all(f.ctx._waitUntilPromises);
				vi.advanceTimersByTime(3_600_000);
			}
			expect(f.calls).toEqual([]);
			expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM kv_cache_metrics_hour").get()).toEqual(
				{
					count: 0,
				},
			);
		} finally {
			f.close();
		}
	});
});
