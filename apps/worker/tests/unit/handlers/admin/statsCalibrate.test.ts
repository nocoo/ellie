// admin/statsCalibrate.test.ts — Tests for stats calibration admin endpoint
// GET/POST /api/admin/stats/calibrate

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	handleCalibrateGet,
	handleCalibratePost,
} from "../../../../src/handlers/admin/statsCalibrate";
import { createAdminRequest, createMockDb, createMockKV, makeEnv } from "../../../helpers";

// ─── Types ────────────────────────────────────────────────────

interface CounterRow {
	key: string;
	stored: number;
	real: number | null;
}

interface CalibrateGetResponse {
	data: {
		counters: CounterRow[];
		todayPosts: number;
		todayDate: string;
	};
}

interface CalibratePostResponse {
	data: {
		success: boolean;
		counters?: CounterRow[];
	};
}

// ─── Tests ────────────────────────────────────────────────────

describe("admin/statsCalibrate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("GET /api/admin/stats/calibrate", () => {
		it("returns stored counter values", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT key, value FROM settings": [
						{ key: "stats.total_threads", value: "100" },
						{ key: "stats.total_posts", value: "500" },
						{ key: "stats.total_members", value: "50" },
						{ key: "stats.yesterday_posts", value: "25" },
					],
				},
			});
			const kv = createMockKV({
				"stats:today_posts": "10",
				"stats:today_date": "2026-05-30",
			});

			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("GET", "/api/admin/stats/calibrate");

			const response = await handleCalibrateGet(request, env);
			const body = (await response.json()) as CalibrateGetResponse;

			expect(response.status).toBe(200);
			expect(body.data.counters).toHaveLength(4);
			expect(body.data.counters[0]).toEqual({
				key: "stats.total_threads",
				stored: 100,
				real: null,
			});
			expect(body.data.todayPosts).toBe(10);
			expect(body.data.todayDate).toBe("2026-05-30");
		});

		it("handles empty settings gracefully", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT key, value FROM settings": [],
				},
			});
			const kv = createMockKV({});

			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("GET", "/api/admin/stats/calibrate");

			const response = await handleCalibrateGet(request, env);
			const body = (await response.json()) as CalibrateGetResponse;

			expect(response.status).toBe(200);
			expect(body.data.counters[0].stored).toBe(0);
			expect(body.data.todayPosts).toBe(0);
			expect(body.data.todayDate).toBe("");
		});
	});

	describe("POST /api/admin/stats/calibrate action=run_stats", () => {
		it("runs COUNT queries and returns real values", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) AS cnt FROM threads": { cnt: 100 },
					"SELECT COUNT(*) AS cnt FROM posts": { cnt: 500 },
					"SELECT COUNT(*) AS cnt FROM users": { cnt: 50 },
				},
				allResults: {
					"SELECT key, value FROM settings": [
						{ key: "stats.total_threads", value: "90" },
						{ key: "stats.total_posts", value: "450" },
						{ key: "stats.total_members", value: "45" },
						{ key: "stats.yesterday_posts", value: "20" },
					],
				},
			});
			const kv = createMockKV({});

			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "run_stats",
			});

			const response = await handleCalibratePost(request, env);
			const body = (await response.json()) as CalibratePostResponse;

			expect(response.status).toBe(200);
			expect(body.data.success).toBe(true);
			expect(body.data.counters).toBeDefined();
			expect(body.data.counters?.[0]).toEqual({
				key: "stats.total_threads",
				stored: 90,
				real: 100,
			});
			expect(body.data.counters?.[1]).toEqual({
				key: "stats.total_posts",
				stored: 450,
				real: 500,
			});
			expect(body.data.counters?.[2]).toEqual({
				key: "stats.total_members",
				stored: 45,
				real: 50,
			});
			// yesterday_posts has no COUNT
			expect(body.data.counters?.[3]?.real).toBeNull();
		});
	});

	describe("POST /api/admin/stats/calibrate action=apply_real", () => {
		it("applies real COUNT values to settings", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*) AS cnt FROM threads": { cnt: 100 },
					"SELECT COUNT(*) AS cnt FROM posts": { cnt: 500 },
					"SELECT COUNT(*) AS cnt FROM users": { cnt: 50 },
				},
			});

			const env = makeEnv({ DB: db, KV: createMockKV({}) });
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_real",
			});

			const response = await handleCalibratePost(request, env);
			const body = (await response.json()) as CalibratePostResponse;

			expect(response.status).toBe(200);
			expect(body.data.success).toBe(true);
			expect(db.batch).toHaveBeenCalledTimes(1);
		});
	});

	describe("POST /api/admin/stats/calibrate action=apply_offsets", () => {
		it("applies offset adjustments to counters", async () => {
			const { db } = createMockDb({});

			const env = makeEnv({ DB: db, KV: createMockKV({}) });
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_offsets",
				offsets: {
					"stats.total_threads": 5,
					"stats.total_posts": -10,
				},
			});

			const response = await handleCalibratePost(request, env);
			const body = (await response.json()) as CalibratePostResponse;

			expect(response.status).toBe(200);
			expect(body.data.success).toBe(true);
			expect(db.batch).toHaveBeenCalledTimes(1);
		});

		it("rejects invalid offsets", async () => {
			const { db } = createMockDb({});

			const env = makeEnv({ DB: db, KV: createMockKV({}) });
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_offsets",
			}); // missing offsets

			const response = await handleCalibratePost(request, env);

			expect(response.status).toBe(400);
		});

		it("skips zero offsets and does not batch", async () => {
			const { db } = createMockDb({});

			const env = makeEnv({ DB: db, KV: createMockKV({}) });
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_offsets",
				offsets: {
					"stats.total_threads": 0, // should be skipped
				},
			});

			const response = await handleCalibratePost(request, env);
			const body = (await response.json()) as CalibratePostResponse;

			expect(response.status).toBe(200);
			expect(body.data.success).toBe(true);
			// No batch call since all offsets were 0
			expect(db.batch).not.toHaveBeenCalled();
		});
	});

	describe("POST /api/admin/stats/calibrate invalid action", () => {
		it("returns 400 for unknown action", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db, KV: createMockKV({}) });
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "unknown",
			});

			const response = await handleCalibratePost(request, env);

			expect(response.status).toBe(400);
		});

		it("returns 400 for invalid JSON body", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db, KV: createMockKV({}) });
			const request = new Request("http://localhost/api/admin/stats/calibrate", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": "test-admin-api-key",
				},
				body: "not json",
			});

			const response = await handleCalibratePost(request, env);

			expect(response.status).toBe(400);
		});
	});
});
