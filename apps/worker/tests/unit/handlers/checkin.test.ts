import { CHECKIN_MOODS, type UserCheckin } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";
import { perform, status } from "../../../src/handlers/checkin";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";

// ─── Factories ──────────────────────────────────────────────

function makeD1CheckinRow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		user_id: 1,
		total_days: 10,
		month_days: 3,
		streak_days: 2,
		reward_total: 5000,
		last_reward: 300,
		mood: "kx",
		message: "hello",
		last_checkin_at: 0,
		...overrides,
	};
}

async function createAuthRequest(
	method: string,
	path: string,
	body?: unknown,
	userId = 1,
): Promise<Request> {
	const token = await createJwtForRole(0, userId);
	const headers: Record<string, string> = {
		"X-API-Key": "test-api-key",
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
	return new Request(`https://api.example.com${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

// ─── Time helpers ───────────────────────────────────────────

/** Mock Date.now to a specific Shanghai time (hour in 0-23). */
function mockShanghaiTime(hour: number, minute = 0) {
	// Asia/Shanghai = UTC+8. To get hour H in Shanghai, set UTC to H-8.
	const d = new Date();
	d.setUTCFullYear(2026, 4, 8); // May 8 2026
	d.setUTCHours(hour - 8, minute, 0, 0);
	vi.setSystemTime(d);
	return d;
}

// Shanghai 2026-05-08 00:00:00 as unix seconds
function todayStartUnix(): number {
	const d = new Date("2026-05-08T00:00:00+08:00");
	return Math.floor(d.getTime() / 1000);
}

// ─── GET /api/v1/checkin/status ─────────────────────────────

describe("GET /api/v1/checkin/status", () => {
	it("returns null checkin for user without checkin history", async () => {
		mockShanghaiTime(12);
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("GET", "/api/v1/checkin/status");

		const res = await status(req, env);
		expect(res.status).toBe(200);

		const { data } = await res.json();
		expect(data.checkin).toBeNull();
		expect(data.checkedInToday).toBe(false);
		expect(data.level).toBeNull();
		expect(data.withinWindow).toBe(true);
	});

	it("returns checkin data with level for existing user", async () => {
		mockShanghaiTime(12);
		const row = makeD1CheckinRow({
			total_days: 50,
			last_checkin_at: todayStartUnix() - 86400, // yesterday
		});
		const { db } = createMockDb({
			firstResults: { "SELECT * FROM user_checkins": row },
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("GET", "/api/v1/checkin/status");

		const res = await status(req, env);
		expect(res.status).toBe(200);

		const { data } = await res.json();
		expect(data.checkin).not.toBeNull();
		expect(data.checkin.totalDays).toBe(50);
		expect(data.checkedInToday).toBe(false);
		expect(data.level).not.toBeNull();
		expect(data.level.level).toBe(5); // 30 <= 50 < 60 → LV.5
	});

	it("detects already checked in today", async () => {
		mockShanghaiTime(14);
		const row = makeD1CheckinRow({
			last_checkin_at: todayStartUnix() + 3600, // 01:00 today
		});
		const { db } = createMockDb({
			firstResults: { "SELECT * FROM user_checkins": row },
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("GET", "/api/v1/checkin/status");

		const res = await status(req, env);
		const { data } = await res.json();
		expect(data.checkedInToday).toBe(true);
	});

	it("reports withinWindow=false outside hours", async () => {
		mockShanghaiTime(3); // 03:00, before 04:00
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("GET", "/api/v1/checkin/status");

		const res = await status(req, env);
		const { data } = await res.json();
		expect(data.withinWindow).toBe(false);
	});

	it("reports withinWindow=false at 23:00 (exclusive end)", async () => {
		mockShanghaiTime(23);
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("GET", "/api/v1/checkin/status");

		const res = await status(req, env);
		const { data } = await res.json();
		expect(data.withinWindow).toBe(false);
	});

	it("reports withinWindow=true at 04:00 (inclusive start)", async () => {
		mockShanghaiTime(4);
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("GET", "/api/v1/checkin/status");

		const res = await status(req, env);
		const { data } = await res.json();
		expect(data.withinWindow).toBe(true);
	});
});

// ─── POST /api/v1/checkin ───────────────────────────────────

describe("POST /api/v1/checkin", () => {
	it("rejects invalid mood", async () => {
		mockShanghaiTime(12);
		const { db } = createMockDb({
			// withAuthVerified does a DB lookup for status/role
			firstResults: { "SELECT role, status FROM users": { role: 0, status: 0 } },
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "invalid_mood",
			message: "hello",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CHECKIN_INVALID_MOOD");
	});

	it("rejects missing mood", async () => {
		mockShanghaiTime(12);
		const { db } = createMockDb({
			firstResults: { "SELECT role, status FROM users": { role: 0, status: 0 } },
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			message: "hello",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CHECKIN_INVALID_MOOD");
	});

	it("rejects checkin outside time window", async () => {
		mockShanghaiTime(3); // 03:00, before window
		const { db } = createMockDb({
			firstResults: { "SELECT role, status FROM users": { role: 0, status: 0 } },
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "test",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CHECKIN_OUTSIDE_WINDOW");
	});

	it("rejects duplicate checkin", async () => {
		mockShanghaiTime(12);
		const row = makeD1CheckinRow({
			last_checkin_at: todayStartUnix() + 3600, // already checked in today
		});
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
				"SELECT * FROM user_checkins": row,
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "test",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(409);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CHECKIN_ALREADY_DONE");
	});

	it("performs first-time checkin successfully", async () => {
		mockShanghaiTime(12);
		const { db, batchCalls } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
				// No existing checkin row → .first() returns null
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "fd",
			message: "fighting!",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(200);

		const { data } = (await res.json()) as {
			data: {
				checkin: UserCheckin;
				reward: number;
				level: { level: number; label: string } | null;
			};
		};
		expect(data.checkin.totalDays).toBe(1);
		expect(data.checkin.monthDays).toBe(1);
		expect(data.checkin.streakDays).toBe(1);
		expect(data.checkin.mood).toBe("fd");
		expect(data.checkin.message).toBe("fighting!");
		expect(data.reward).toBeGreaterThanOrEqual(20);
		expect(data.reward).toBeLessThanOrEqual(500);
		expect(data.level).not.toBeNull();
		expect(data.level?.level).toBe(1); // 1 day → LV.1

		// Verify batch was called (transaction)
		expect(batchCalls).toHaveLength(1);
		expect(batchCalls[0]).toHaveLength(3); // checkin INSERT + coins UPDATE + history INSERT
	});

	it("performs returning-user checkin with streak increment", async () => {
		mockShanghaiTime(12);
		const yesterdayCheckin = makeD1CheckinRow({
			user_id: 1,
			total_days: 30,
			month_days: 7,
			streak_days: 5,
			reward_total: 8000,
			last_checkin_at: todayStartUnix() - 3600, // yesterday, 23:00
		});
		const { db, batchCalls } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
				"SELECT * FROM user_checkins": yesterdayCheckin,
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "hi",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(200);

		const { data } = (await res.json()) as {
			data: {
				checkin: UserCheckin;
				reward: number;
			};
		};
		expect(data.checkin.totalDays).toBe(31);
		expect(data.checkin.monthDays).toBe(8); // same month
		expect(data.checkin.streakDays).toBe(6); // yesterday → streak continues
		expect(data.reward).toBeGreaterThanOrEqual(20);
		expect(data.reward).toBeLessThanOrEqual(500);

		// Verify batch (UPDATE checkin + UPDATE coins + INSERT history)
		expect(batchCalls).toHaveLength(1);
		expect(batchCalls[0]).toHaveLength(3);
	});

	it("resets streak when last checkin was more than a day ago", async () => {
		mockShanghaiTime(12);
		const oldCheckin = makeD1CheckinRow({
			total_days: 100,
			streak_days: 50,
			last_checkin_at: todayStartUnix() - 86400 * 3, // 3 days ago
		});
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
				"SELECT * FROM user_checkins": oldCheckin,
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "yl",
			message: "",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(200);

		const { data } = (await res.json()) as { data: { checkin: UserCheckin } };
		expect(data.checkin.totalDays).toBe(101);
		expect(data.checkin.streakDays).toBe(1); // streak reset
	});

	it("trims message to 100 characters", async () => {
		mockShanghaiTime(12);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const longMessage = "a".repeat(200);
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: longMessage,
		});

		const res = await perform(req, env);
		expect(res.status).toBe(200);

		const { data } = (await res.json()) as { data: { checkin: UserCheckin } };
		expect(data.checkin.message).toHaveLength(100);
	});

	it("accepts all valid mood codes", async () => {
		for (const mood of Object.keys(CHECKIN_MOODS)) {
			mockShanghaiTime(12);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status FROM users": { role: 0, status: 0 },
				},
			});
			const env = makeEnv({ DB: db });
			const req = await createAuthRequest("POST", "/api/v1/checkin", {
				mood,
				message: "",
			});

			const res = await perform(req, env);
			expect(res.status).toBe(200);
		}
	});

	it("rejects invalid JSON body", async () => {
		mockShanghaiTime(12);
		const { db } = createMockDb({
			firstResults: { "SELECT role, status FROM users": { role: 0, status: 0 } },
		});
		const env = makeEnv({ DB: db });
		const token = await createJwtForRole(0, 1);
		const req = new Request("https://api.example.com/api/v1/checkin", {
			method: "POST",
			headers: {
				"X-API-Key": "test-api-key",
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: "not json",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("INVALID_BODY");
	});

	it("rejects at 23:00 (exclusive end of window)", async () => {
		mockShanghaiTime(23, 0);
		const { db } = createMockDb({
			firstResults: { "SELECT role, status FROM users": { role: 0, status: 0 } },
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "test",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CHECKIN_OUTSIDE_WINDOW");
	});

	it("allows at 22:59 (just before exclusive end)", async () => {
		mockShanghaiTime(22, 59);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "just in time",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(200);
	});

	it("returns 409 when concurrent request already wrote checkin (changes=0)", async () => {
		mockShanghaiTime(12);
		const row = makeD1CheckinRow({
			last_checkin_at: todayStartUnix() - 3600, // yesterday — passes early check
		});
		const { db, batchCalls } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
				"SELECT * FROM user_checkins": row,
			},
		});
		// Override batch to simulate concurrent write: conditional UPDATE was no-op
		db.batch = vi.fn(async (stmts: unknown[]) => {
			batchCalls.push(stmts);
			return [
				{ success: true, results: [], meta: { changes: 0, last_row_id: 0 } },
				{ success: true, results: [], meta: { changes: 0, last_row_id: 0 } },
				{ success: true, results: [], meta: { changes: 0, last_row_id: 0 } },
			];
		}) as typeof db.batch;
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "race",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(409);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CHECKIN_ALREADY_DONE");
	});

	it("duplicate checkin (early check) does not call batch", async () => {
		mockShanghaiTime(12);
		const row = makeD1CheckinRow({
			last_checkin_at: todayStartUnix() + 3600, // already today
		});
		const { db, batchCalls } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
				"SELECT * FROM user_checkins": row,
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "dup",
		});

		await perform(req, env);
		expect(batchCalls).toHaveLength(0); // no coins awarded
	});

	it("uses conditional UPDATE with last_checkin_at guard for returning users", async () => {
		mockShanghaiTime(12);
		const row = makeD1CheckinRow({
			last_checkin_at: todayStartUnix() - 3600,
		});
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
				"SELECT * FROM user_checkins": row,
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "test",
		});

		await perform(req, env);

		const updateCall = calls.find((c) => c.sql.includes("UPDATE user_checkins"));
		expect(updateCall?.sql).toContain("AND last_checkin_at < ?");
		const coinsCall = calls.find((c) => c.sql.includes("UPDATE users SET coins"));
		expect(coinsCall?.sql).toContain("changes() > 0");
	});

	it("uses INSERT ON CONFLICT DO NOTHING for first-time users", async () => {
		mockShanghaiTime(12);
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "first",
		});

		await perform(req, env);

		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO user_checkins"));
		expect(insertCall?.sql).toContain("ON CONFLICT");
		expect(insertCall?.sql).toContain("DO NOTHING");
		const coinsCall = calls.find((c) => c.sql.includes("UPDATE users SET coins"));
		expect(coinsCall?.sql).toContain("changes() > 0");
	});

	// ─── Phase D: per-day audit row in checkin_history ────────────────
	//
	// Every successful POST appends one row to `checkin_history` (composite
	// PK on (user_id, date_local)) inside the same atomic batch as the
	// aggregate UPDATE/INSERT. The day key is the Asia/Shanghai local day
	// in YYYY-MM-DD form, derived from the same `getShanghaiParts()`
	// primitive that drives `shanghaiTodayStartUnix()` — so a 23:59:55 POST
	// (Shanghai) and the aggregate it touches both reference the same day.
	it("appends a checkin_history row with Shanghai-local YYYY-MM-DD date and ON CONFLICT DO NOTHING", async () => {
		// `mockShanghaiTime` pins Shanghai to 2026-05-08 12:00 (UTC=04:00),
		// so date_local must be the corresponding `YYYY-MM-DD` string.
		mockShanghaiTime(12);
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": { role: 0, status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = await createAuthRequest("POST", "/api/v1/checkin", {
			mood: "kx",
			message: "phase-d",
		});

		const res = await perform(req, env);
		expect(res.status).toBe(200);

		const historyCall = calls.find((c) => c.sql.includes("INSERT INTO checkin_history"));
		expect(historyCall).toBeDefined();
		expect(historyCall?.sql).toContain("ON CONFLICT(user_id, date_local) DO NOTHING");
		// Bound params: (user_id, date_local, mood, message, reward, created_at)
		expect(typeof historyCall?.params[0]).toBe("number");
		expect(historyCall?.params[1]).toBe("2026-05-08");
		expect(historyCall?.params[2]).toBe("kx");
		expect(historyCall?.params[3]).toBe("phase-d");
		expect(typeof historyCall?.params[4]).toBe("number");
		expect(typeof historyCall?.params[5]).toBe("number");
	});
});
