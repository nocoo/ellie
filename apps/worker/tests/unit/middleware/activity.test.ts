import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackActivity } from "../../../src/middleware/activity";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
const NOW = 1_800_000_000;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW * 1000);
	f = readingFixture();
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
const activity = () =>
	f.sqlite.prepare("SELECT last_activity, ol_time FROM users WHERE id = 10").get();
const flush = async () => {
	await Promise.all(vi.mocked(f.ctx.waitUntil).mock.calls.map(([task]) => task));
};

describe("trackActivity", () => {
	it("updates only last activity, throttling reads and writes for fifteen minutes", async () => {
		f.sqlite.exec("UPDATE users SET ol_time = 45 WHERE id = 10");
		trackActivity(f.env, f.ctx, { userId: 10, role: 0 });
		await flush();
		expect(activity()).toEqual({ last_activity: NOW, ol_time: 45 });
		f.calls.length = 0;
		vi.setSystemTime((NOW + 899) * 1000);
		trackActivity(f.env, f.ctx, { userId: 10, role: 0 });
		await flush();
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		vi.setSystemTime((NOW + 900) * 1000);
		trackActivity(f.env, f.ctx, { userId: 10, role: 0 });
		await flush();
		expect(activity()).toEqual({ last_activity: NOW + 900, ol_time: 45 });
		expect(f.calls).toHaveLength(1);
	});

	it("keeps newer cross-isolate activity and ignores deleted users without a SELECT", async () => {
		f.sqlite.exec(`UPDATE users SET last_activity = ${NOW - 100}, ol_time = 8 WHERE id = 10`);
		trackActivity(f.env, f.ctx, { userId: 10, role: 0 });
		trackActivity(f.env, f.ctx, { userId: 999, role: 0 });
		await flush();
		expect(activity()).toEqual({ last_activity: NOW - 100, ol_time: 8 });
		expect(f.calls).toHaveLength(2);
		expect(f.calls.every((call) => call.sql.startsWith("UPDATE users SET last_activity"))).toBe(
			true,
		);
	});

	it.each(["rejected", "unconfirmed"])("retries after a %s D1 write", async (failure) => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const original = f.env.DB.prepare.bind(f.env.DB);
		const run =
			failure === "rejected"
				? vi.fn().mockRejectedValue(new Error("offline"))
				: vi.fn().mockResolvedValue({ success: false });
		const prepare = vi
			.spyOn(f.env.DB, "prepare")
			.mockImplementationOnce(() => ({ bind: () => ({ run }) }) as D1PreparedStatement);
		trackActivity(f.env, f.ctx, { userId: 10, role: 0 });
		await flush();
		prepare.mockImplementation(original);
		trackActivity(f.env, f.ctx, { userId: 10, role: 0 });
		await flush();
		expect(activity()).toMatchObject({ last_activity: NOW });
	});

	it("bounds local throttles and isolates users and namespaces", async () => {
		for (let userId = 1; userId <= 4097; userId++) trackActivity(f.env, f.ctx, { userId, role: 0 });
		await flush();
		f.calls.length = 0;
		trackActivity(f.env, f.ctx, { userId: 1, role: 0 });
		trackActivity(f.env, f.ctx, { userId: 4097, role: 0 });
		await flush();
		expect(f.calls).toHaveLength(1);
		const second = readingFixture();
		try {
			trackActivity(second.env, second.ctx, { userId: 4097, role: 0 });
			await Promise.all(vi.mocked(second.ctx.waitUntil).mock.calls.map(([task]) => task));
			expect(second.calls).toHaveLength(1);
		} finally {
			second.close();
		}
	});
});
