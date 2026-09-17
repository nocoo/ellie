import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleStats } from "../../../../src/handlers/admin/stats";
import { statsReportsGenKey } from "../../../../src/lib/cache/keys";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
const START = Date.parse("2026-09-17T12:00:00Z");

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(START);
	f = readingFixture();
	f.sqlite.exec("DELETE FROM settings WHERE key LIKE 'stats.total_%'");
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function counter(key: string, value: string) {
	f.sqlite
		.prepare(
			"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.run(key, value);
}
async function read() {
	return handleStats(createAdminRequest("GET", "/api/admin/stats"), f.env);
}

describe("on-demand admin totals", () => {
	it("reads only three maintained counters, with an indexed lookup instead of business table counts", async () => {
		counter("stats.total_members", "100");
		counter("stats.total_threads", "2000000");
		counter("stats.total_posts", "10000000");
		f.thread(1);
		f.post(1);
		const response = await read();
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store, private");
		expect((await response.json()).data).toEqual({
			users: { total: 100 },
			threads: { total: 2000000 },
			posts: { total: 10000000 },
			source: "stored-counters",
			observedAt: START,
		});
		expect(f.calls).toHaveLength(1);
		const call = f.calls[0];
		expect(call.params).toEqual([
			"stats.total_members",
			"stats.total_threads",
			"stats.total_posts",
		]);
		expect(call.sql).not.toMatch(/COUNT\s*\(|FROM\s+(users|threads|posts)\b/i);
		const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${call.sql}`).all(...call.params);
		expect(plan.some((row) => /SEARCH settings USING INDEX.*key=/.test(String(row.detail)))).toBe(
			true,
		);
		expect(f.snapshots("admin:analytics")[0]).toMatchObject({
			tier: "MEDIUM",
			loadedAt: START,
			expiresAt: START + 1_800_000,
		});
	});

	it("stays warm past 60 seconds, reloads at 30 minutes, and observes completed calibration epochs", async () => {
		counter("stats.total_members", "10");
		await read();
		counter("stats.total_members", "20");
		f.calls.length = 0;
		vi.setSystemTime(START + 60_000);
		expect((await (await read()).json()).data.users.total).toBe(10);
		expect(f.calls).toHaveLength(0);
		vi.setSystemTime(START + 1_800_000);
		expect((await (await read()).json()).data.users.total).toBe(20);
		expect(f.calls).toHaveLength(1);
		counter("stats.total_members", "30");
		await f.env.KV.put(statsReportsGenKey(), "completed-calibration");
		expect((await (await read()).json()).data.users.total).toBe(30);
		expect(f.calls).toHaveLength(2);
	});

	it("distinguishes a stored zero from an unavailable counter", async () => {
		counter("stats.total_threads", "0");
		expect((await (await read()).json()).data).toMatchObject({
			users: { total: null },
			threads: { total: 0 },
			posts: { total: null },
		});
		expect(f.calls).toHaveLength(1);
	});

	it.each(["", "12oops", "-1", "1.5", "9007199254740992"])(
		"rejects malformed counter %j without caching it",
		async (value) => {
			counter("stats.total_members", value);
			await expect(read()).rejects.toThrow("Invalid stored statistics counter");
			expect(f.snapshots("admin:analytics")).toHaveLength(0);
		},
	);

	it("rejects unconfirmed reads without fabricating totals or filling a snapshot", async () => {
		f.state.queryError = true;
		await expect(read()).rejects.toThrow("Stored statistics could not be loaded");
		expect(f.snapshots("admin:analytics")).toHaveLength(0);
	});
});
