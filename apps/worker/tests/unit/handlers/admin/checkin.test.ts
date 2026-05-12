// admin/checkin.test.ts — Phase E. Covers all three user-scoped
// admin checkin endpoints + interaction with recomputeFromHistory.
//
//   GET   /api/admin/users/:id/checkins
//   PATCH /api/admin/users/:id/checkins/:dateLocal
//   PATCH /api/admin/users/:id/checkins/streak

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserCheckins, setCheckinDay, setStreak } from "../../../../src/handlers/admin/checkin";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

// Pin Date so Shanghai-local "today" / "yesterday" are deterministic in
// the recompute streak walker. 2026-05-12 04:30 UTC = 2026-05-12 12:30
// Shanghai. So today=2026-05-12, yesterday=2026-05-11.
function fixShanghaiNow() {
	vi.setSystemTime(new Date("2026-05-12T04:30:00Z"));
}

beforeEach(() => {
	vi.useFakeTimers();
	fixShanghaiNow();
});
afterEach(() => {
	vi.useRealTimers();
});

const TODAY = "2026-05-12";
const YESTERDAY = "2026-05-11";

function makeAggregateRow(overrides?: Record<string, unknown>) {
	return {
		user_id: 42,
		total_days: 5,
		month_days: 5,
		streak_days: 3,
		reward_total: 500,
		last_reward: 100,
		mood: "kx",
		message: "hi",
		last_checkin_at: 1715476800,
		...overrides,
	};
}

function makeHistoryRow(overrides?: Record<string, unknown>) {
	return {
		user_id: 42,
		date_local: TODAY,
		mood: "",
		message: "",
		reward: 0,
		created_at: 1715486400,
		...overrides,
	};
}

const ACTIVE_USER = { id: 42, username: "alice", status: 0 };
const PURGED_USER = { id: 42, username: "alice", status: -99 };

// ─── GET ────────────────────────────────────────────────────────

describe("admin/checkin GET /api/admin/users/:id/checkins", () => {
	it("returns aggregate + history with default 90-day range", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
				"SELECT * FROM user_checkins WHERE user_id": makeAggregateRow(),
			},
			allResults: {
				"FROM checkin_history": [makeHistoryRow(), makeHistoryRow({ date_local: YESTERDAY })],
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("GET", "/api/admin/users/42/checkins");

		const response = await getUserCheckins(request, env);

		expect(response.status).toBe(200);
		const envelope = (await response.json()) as { data: Record<string, unknown> };
		const body = envelope.data;
		expect(body.userId).toBe(42);
		expect(body.username).toBe("alice");
		expect((body.checkin as Record<string, unknown>).totalDays).toBe(5);
		expect((body.history as unknown[]).length).toBe(2);
		const range = body.range as { from: string; to: string };
		expect(range.to).toBe(TODAY);
		// Default range = last 90 days inclusive of today
		const expectedFrom = new Date(`${TODAY}T00:00:00Z`).getTime() - 89 * 86400_000;
		const fromIso = new Date(expectedFrom).toISOString().slice(0, 10);
		expect(range.from).toBe(fromIso);
		// Should bind userId, from, to, MAX_HISTORY_ROWS
		const histCall = calls.find((c) => c.sql.includes("FROM checkin_history"));
		expect(histCall?.params[0]).toBe(42);
		expect(histCall?.params[1]).toBe(fromIso);
		expect(histCall?.params[2]).toBe(TODAY);
	});

	it("respects from/to query params and validates them", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest(
			"GET",
			"/api/admin/users/42/checkins?from=2026-05-01&to=2026-05-12",
		);

		const response = await getUserCheckins(request, env);

		expect(response.status).toBe(200);
		const histCall = calls.find((c) => c.sql.includes("FROM checkin_history"));
		expect(histCall?.params[1]).toBe("2026-05-01");
		expect(histCall?.params[2]).toBe("2026-05-12");
	});

	it("rejects malformed dateLocal in from/to with 400", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest(
			"GET",
			"/api/admin/users/42/checkins?from=2026-02-31&to=2026-05-12",
		);

		const response = await getUserCheckins(request, env);

		expect(response.status).toBe(400);
	});

	it("rejects from > to with 400", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest(
			"GET",
			"/api/admin/users/42/checkins?from=2026-05-13&to=2026-05-12",
		);

		const response = await getUserCheckins(request, env);
		expect(response.status).toBe(400);
	});

	it("returns 404 USER_NOT_FOUND when user missing", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("GET", "/api/admin/users/42/checkins");
		const response = await getUserCheckins(request, env);
		expect(response.status).toBe(404);
	});

	it("returns 409 ALREADY_PURGED for tombstoned user", async () => {
		const { db } = createMockDb({
			firstResults: { "SELECT id, username, status FROM users WHERE id = ?": PURGED_USER },
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("GET", "/api/admin/users/42/checkins");
		const response = await getUserCheckins(request, env);
		expect(response.status).toBe(409);
	});

	it("returns null aggregate when user_checkins row absent", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
				// no user_checkins row
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("GET", "/api/admin/users/42/checkins");
		const response = await getUserCheckins(request, env);
		expect(response.status).toBe(200);
		const envelope = (await response.json()) as { data: Record<string, unknown> };
		const body = envelope.data;
		expect(body.checkin).toBeNull();
	});
});

// ─── PATCH date ─────────────────────────────────────────────────

describe("admin/checkin PATCH /api/admin/users/:id/checkins/:dateLocal", () => {
	it("upserts history row at Shanghai noon when checkedIn=true and recomputes", async () => {
		// recompute reads back history → make it visible after insert
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
			},
			allResults: {
				// recompute SELECT
				"SELECT date_local, reward, created_at FROM checkin_history": [
					makeHistoryRow({ date_local: TODAY }),
				],
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", `/api/admin/users/42/checkins/${TODAY}`, {
			checkedIn: true,
		});

		const response = await setCheckinDay(request, env);

		expect(response.status).toBe(200);
		const envelope = (await response.json()) as { data: Record<string, unknown> };
		const body = envelope.data;
		expect(body.dateLocal).toBe(TODAY);
		expect(body.checkedIn).toBe(true);
		const recompute = body.recompute as Record<string, unknown>;
		expect(recompute.totalDays).toBe(1);
		expect(recompute.streakDays).toBe(1); // today

		// Insert call: created_at = Shanghai noon = UTC 04:00 of TODAY
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO checkin_history"));
		expect(insertCall).toBeDefined();
		expect(insertCall?.params[0]).toBe(42);
		expect(insertCall?.params[1]).toBe(TODAY);
		const expectedNoon = Math.floor(Date.UTC(2026, 4, 12, 4, 0, 0) / 1000);
		expect(insertCall?.params[2]).toBe(expectedNoon);

		// admin_logs INSERT fired with action=checkin.history_set
		const logCall = calls.find((c) => c.sql.includes("INSERT INTO admin_logs"));
		expect(logCall).toBeDefined();
		expect(logCall?.params[2]).toBe("checkin.history_set");
		expect(logCall?.params[3]).toBe("user");
		expect(logCall?.params[4]).toBe(42);
	});

	it("deletes history row when checkedIn=false and recomputes (allowEmptyReset)", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
			},
			// recompute sees empty history → allowEmptyReset zeros aggregate
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", `/api/admin/users/42/checkins/${TODAY}`, {
			checkedIn: false,
		});

		const response = await setCheckinDay(request, env);

		expect(response.status).toBe(200);
		const envelope = (await response.json()) as { data: Record<string, unknown> };
		const body = envelope.data;
		expect(body.checkedIn).toBe(false);
		const recompute = body.recompute as Record<string, unknown>;
		expect(recompute.totalDays).toBe(0);
		expect(recompute.skipped).toBe(false);

		const deleteCall = calls.find((c) => c.sql.includes("DELETE FROM checkin_history"));
		expect(deleteCall).toBeDefined();
		expect(deleteCall?.params).toEqual([42, TODAY]);

		// Reset INSERT into user_checkins fired (allowEmptyReset path)
		const resetCall = calls.find(
			(c) => c.sql.includes("INSERT INTO user_checkins") && c.sql.includes("DO UPDATE SET"),
		);
		expect(resetCall).toBeDefined();

		const logCall = calls.find((c) => c.sql.includes("INSERT INTO admin_logs"));
		expect(logCall?.params[2]).toBe("checkin.history_clear");
	});

	it("rejects invalid calendar date with 400", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", "/api/admin/users/42/checkins/2026-02-31", {
			checkedIn: true,
		});

		const response = await setCheckinDay(request, env);
		expect(response.status).toBe(400);
	});

	it("rejects non-boolean checkedIn with 400", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", `/api/admin/users/42/checkins/${TODAY}`, {
			checkedIn: "yes",
		});
		const response = await setCheckinDay(request, env);
		expect(response.status).toBe(400);
	});

	it("returns 404 USER_NOT_FOUND when user missing", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", `/api/admin/users/42/checkins/${TODAY}`, {
			checkedIn: true,
		});
		const response = await setCheckinDay(request, env);
		expect(response.status).toBe(404);
	});

	it("rejects 'streak' as dateLocal so the streak route is unambiguous", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", "/api/admin/users/42/checkins/streak", {
			checkedIn: true,
		});
		const response = await setCheckinDay(request, env);
		expect(response.status).toBe(400);
	});
});

// ─── PATCH streak ───────────────────────────────────────────────

describe("admin/checkin PATCH /api/admin/users/:id/checkins/streak", () => {
	it("updates streak_days only and writes admin log", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
				"SELECT user_id FROM user_checkins WHERE user_id": { user_id: 42 },
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", "/api/admin/users/42/checkins/streak", {
			streakDays: 7,
		});

		const response = await setStreak(request, env);

		expect(response.status).toBe(200);
		const envelope = (await response.json()) as { data: Record<string, unknown> };
		const body = envelope.data;
		expect(body.streakDays).toBe(7);
		expect(body.note).toContain("overwritten");

		const updateCall = calls.find((c) =>
			c.sql.includes("UPDATE user_checkins SET streak_days = ?"),
		);
		expect(updateCall).toBeDefined();
		expect(updateCall?.params).toEqual([7, 42]);

		const logCall = calls.find((c) => c.sql.includes("INSERT INTO admin_logs"));
		expect(logCall?.params[2]).toBe("checkin.streak_edit");
	});

	it("rejects non-integer / negative / oversized streakDays with 400", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
				"SELECT user_id FROM user_checkins WHERE user_id": { user_id: 42 },
			},
		});
		const env = makeEnv({ DB: db });
		const cases = [{ streakDays: -1 }, { streakDays: 1.5 }, { streakDays: 1_000_000 }, {}];
		for (const body of cases) {
			const req = createAdminRequest("PATCH", "/api/admin/users/42/checkins/streak", body);
			const res = await setStreak(req, env);
			expect(res.status).toBe(400);
		}
	});

	it("returns 404 CHECKIN_NOT_FOUND when no aggregate row exists", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, username, status FROM users WHERE id = ?": ACTIVE_USER,
				// no user_checkins row
			},
		});
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", "/api/admin/users/42/checkins/streak", {
			streakDays: 7,
		});
		const response = await setStreak(request, env);
		expect(response.status).toBe(404);
	});

	it("returns 404 USER_NOT_FOUND when user missing", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("PATCH", "/api/admin/users/42/checkins/streak", {
			streakDays: 7,
		});
		const response = await setStreak(request, env);
		expect(response.status).toBe(404);
	});
});
