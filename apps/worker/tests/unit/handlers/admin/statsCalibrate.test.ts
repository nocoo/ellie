// admin/statsCalibrate.test.ts — Tests for stats calibration admin endpoint
// GET/POST /api/admin/stats/calibrate

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	handleCalibrateGet,
	handleCalibratePost,
} from "../../../../src/handlers/admin/statsCalibrate";
import { shanghaiDateLocal, shanghaiTodayStartUnix } from "../../../../src/lib/shanghaiTime";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

// ─── Helpers ──────────────────────────────────────────────────

function createAdminRequest(method: string, path: string, body?: Record<string, unknown>): Request {
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			"X-Admin-API-Key": "test-admin-api-key",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
}

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
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-30T10:00:00Z"));
		f = readingFixture();
		f.thread(1);
		const batch = f.env.DB.batch.bind(f.env.DB);
		vi.spyOn(f.env.DB, "batch").mockImplementation(async (statements) => {
			f.sqlite.exec("BEGIN");
			try {
				const results = await batch(statements);
				f.sqlite.exec("COMMIT");
				return results;
			} catch (error) {
				f.sqlite.exec("ROLLBACK");
				throw error;
			}
		});
	});

	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("GET /api/admin/stats/calibrate", () => {
		it("returns stored counter values and delegates getPublicStats(admin) for todayPosts", async () => {
			f.sqlite.prepare("UPDATE settings SET value = '100' WHERE key = 'stats.total_threads'").run();
			f.sqlite.prepare("UPDATE settings SET value = '500' WHERE key = 'stats.total_posts'").run();
			f.sqlite.prepare("UPDATE settings SET value = '50' WHERE key = 'stats.total_members'").run();
			f.sqlite
				.prepare("UPDATE settings SET value = '25' WHERE key = 'stats.yesterday_posts'")
				.run();

			const todayStart = shanghaiTodayStartUnix();
			for (let i = 0; i < 10; i++) {
				f.post(100 + i, { created_at: todayStart + i * 10 });
			}

			const request = createAdminRequest("GET", "/api/admin/stats/calibrate");
			const response = await handleCalibrateGet(request, f.env);
			const body = (await response.json()) as CalibrateGetResponse;

			expect(response.status).toBe(200);
			expect(body.data.counters).toHaveLength(4);
			expect(body.data.counters[0]).toEqual({
				key: "stats.total_threads",
				stored: 100,
				real: null,
			});
			expect(body.data.counters[1]).toEqual({
				key: "stats.total_posts",
				stored: 500,
				real: null,
			});
			expect(body.data.todayPosts).toBe(10);
			expect(body.data.todayDate).toBe(shanghaiDateLocal());
		});

		it("handles zero settings gracefully", async () => {
			const request = createAdminRequest("GET", "/api/admin/stats/calibrate");
			const response = await handleCalibrateGet(request, f.env);
			const body = (await response.json()) as CalibrateGetResponse;

			expect(response.status).toBe(200);
			expect(body.data.counters[0].stored).toBe(0);
			expect(body.data.todayPosts).toBe(0);
			expect(body.data.todayDate).toBe(shanghaiDateLocal());
		});
	});

	describe("POST /api/admin/stats/calibrate action=run_stats", () => {
		it("runs COUNT queries and returns real values", async () => {
			f.sqlite.prepare("UPDATE settings SET value = '90' WHERE key = 'stats.total_threads'").run();
			f.sqlite.prepare("UPDATE settings SET value = '450' WHERE key = 'stats.total_posts'").run();
			f.sqlite.prepare("UPDATE settings SET value = '45' WHERE key = 'stats.total_members'").run();
			f.sqlite
				.prepare("UPDATE settings SET value = '20' WHERE key = 'stats.yesterday_posts'")
				.run();

			// In readingFixture, users table has 5 rows (alice, bob, mod, admin, super)
			// threads table has 1 row (thread 1)
			// let's add 2 more posts
			f.post(10, { created_at: 100 });
			f.post(11, { created_at: 200 });

			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "run_stats",
			});
			const response = await handleCalibratePost(request, f.env);
			const body = (await response.json()) as CalibratePostResponse;

			expect(response.status).toBe(200);
			expect(body.data.success).toBe(true);
			expect(body.data.counters).toBeDefined();
			expect(body.data.counters?.[0]).toEqual({
				key: "stats.total_threads",
				stored: 90,
				real: 1,
			});
			expect(body.data.counters?.[1]).toEqual({
				key: "stats.total_posts",
				stored: 450,
				real: 2,
			});
			expect(body.data.counters?.[2]).toEqual({
				key: "stats.total_members",
				stored: 45,
				real: 5,
			});
			// yesterday_posts has no real COUNT
			expect(body.data.counters?.[3]?.real).toBeNull();
		});
	});

	describe("POST /api/admin/stats/calibrate action=apply_real", () => {
		it("applies real COUNT values to settings without touching retired public-stats cache", async () => {
			await f.env.KV.put("public-stats", JSON.stringify({ cached: true }));
			f.post(20, { created_at: 100 });

			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_real",
			});
			const response = await handleCalibratePost(request, f.env);
			const body = (await response.json()) as CalibratePostResponse;

			expect(response.status).toBe(200);
			expect(body.data.success).toBe(true);

			// Check DB settings updated
			const threads = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_threads'")
				.get() as { value: string };
			const posts = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_posts'")
				.get() as { value: string };
			const members = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_members'")
				.get() as { value: string };

			expect(threads.value).toBe("1");
			expect(posts.value).toBe("1");
			expect(members.value).toBe("5");

			expect(f.env.KV.delete).not.toHaveBeenCalledWith("public-stats");
		});
	});

	describe("POST /api/admin/stats/calibrate action=apply_offsets", () => {
		it("applies offset adjustments to counters without touching retired public-stats cache", async () => {
			await f.env.KV.put("public-stats", JSON.stringify({ cached: true }));
			f.sqlite.prepare("UPDATE settings SET value = '10' WHERE key = 'stats.total_threads'").run();
			f.sqlite.prepare("UPDATE settings SET value = '20' WHERE key = 'stats.total_posts'").run();

			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_offsets",
				offsets: {
					"stats.total_threads": 5,
					"stats.total_posts": -10,
				},
			});
			const response = await handleCalibratePost(request, f.env);
			const body = (await response.json()) as CalibratePostResponse;

			expect(response.status).toBe(200);
			expect(body.data.success).toBe(true);

			const threads = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_threads'")
				.get() as { value: string };
			const posts = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.total_posts'")
				.get() as { value: string };

			expect(Number(threads.value)).toBe(15);
			expect(Number(posts.value)).toBe(10);

			expect(f.env.KV.delete).not.toHaveBeenCalledWith("public-stats");
		});

		it("rejects invalid offsets", async () => {
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_offsets",
			});
			const response = await handleCalibratePost(request, f.env);
			expect(response.status).toBe(400);
		});

		it("skips zero offsets and does not execute batch updates", async () => {
			const callsBefore = f.calls.length;
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_offsets",
				offsets: {
					"stats.total_threads": 0,
				},
			});
			const response = await handleCalibratePost(request, f.env);
			const body = (await response.json()) as CalibratePostResponse;

			expect(response.status).toBe(200);
			expect(body.data.success).toBe(true);

			const updateCalls = f.calls.slice(callsBefore).filter((c) => c.sql.startsWith("UPDATE"));
			expect(updateCalls).toHaveLength(0);
		});
	});

	it("creates missing numeric totals when applying real counts", async () => {
		f.sqlite.exec("DELETE FROM settings WHERE key LIKE 'stats.total_%'");
		f.post(20);
		const response = await handleCalibratePost(
			createAdminRequest("POST", "/api/admin/stats/calibrate", { action: "apply_real" }),
			f.env,
		);
		expect(response.status).toBe(200);
		expect(
			f.sqlite
				.prepare(
					"SELECT key, value, type FROM settings WHERE key LIKE 'stats.total_%' ORDER BY key",
				)
				.all(),
		).toEqual([
			{ key: "stats.total_members", value: "5", type: "number" },
			{ key: "stats.total_posts", value: "1", type: "number" },
			{ key: "stats.total_threads", value: "1", type: "number" },
		]);
	});

	it("applies offsets to a missing counter's displayed zero and retains numeric type", async () => {
		f.sqlite.exec("DELETE FROM settings WHERE key = 'stats.yesterday_posts'");
		const response = await handleCalibratePost(
			createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_offsets",
				offsets: { "stats.yesterday_posts": 7 },
			}),
			f.env,
		);
		expect(response.status).toBe(200);
		expect(
			f.sqlite
				.prepare("SELECT value, type FROM settings WHERE key = 'stats.yesterday_posts'")
				.get(),
		).toEqual({ value: "7", type: "number" });
	});

	it.each([
		[],
		null,
		{ "stats.total_posts": 1.5 },
		{ "stats.total_posts": "5" },
		{ "stats.total_posts": Number.MAX_SAFE_INTEGER + 1 },
		{ "stats.total_threads": 5, "unknown.counter": 10 },
	])("rejects malformed offsets without partially applying valid entries: %j", async (offsets) => {
		const response = await handleCalibratePost(
			createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "apply_offsets",
				offsets,
			}),
			f.env,
		);
		expect(response.status).toBe(400);
		expect(f.env.DB.batch).not.toHaveBeenCalled();
		expect(f.env.KV.delete).not.toHaveBeenCalled();
	});

	for (const action of ["apply_real", "apply_offsets"] as const) {
		it.each(["zero", "missing-meta", "failed", "incomplete"])(
			`${action} refuses %s write confirmation`,
			async (kind) => {
				await handleCalibrateGet(createAdminRequest("GET", "/api/admin/stats/calibrate"), f.env);
				const cached = new Map(f.values);
				const resultCount = action === "apply_real" ? 3 : 2;
				const results = Array.from({ length: resultCount }, (_, index) => ({
					success: kind !== "failed" || index !== 0,
					results: [],
					...(kind === "missing-meta" && index === 0
						? {}
						: { meta: { changes: kind === "zero" && index === 0 ? 0 : 1 } }),
				}));
				vi.mocked(f.env.DB.batch).mockResolvedValueOnce(
					(kind === "incomplete" ? results.slice(1) : results) as D1Result[],
				);
				await expect(
					handleCalibratePost(
						createAdminRequest("POST", "/api/admin/stats/calibrate", {
							action,
							offsets: { "stats.total_posts": 3, "stats.total_threads": 4 },
						}),
						f.env,
					),
				).rejects.toThrow(/confirm/i);
				expect(f.values).toEqual(cached);
			},
		);

		it(`${action} rolls back earlier writes on a later SQL failure`, async () => {
			const before = f.sqlite.prepare("SELECT key, value, type FROM settings ORDER BY key").all();
			f.sqlite.exec(
				"CREATE TRIGGER reject_calibration BEFORE INSERT ON settings WHEN NEW.key = 'stats.total_posts' BEGIN SELECT RAISE(ABORT, 'injected calibration failure'); END",
			);
			await expect(
				handleCalibratePost(
					createAdminRequest("POST", "/api/admin/stats/calibrate", {
						action,
						offsets: { "stats.total_threads": 4, "stats.total_posts": 3 },
					}),
					f.env,
				),
			).rejects.toThrow("injected calibration failure");
			expect(f.sqlite.prepare("SELECT key, value, type FROM settings ORDER BY key").all()).toEqual(
				before,
			);
			expect(f.env.KV.delete).not.toHaveBeenCalled();
		});
	}

	it.each([null, { cnt: -1 }, { cnt: 1.5 }, { cnt: "4" }])(
		"refuses an invalid count instead of storing a fallback zero: %j",
		async (value) => {
			const prepare = f.env.DB.prepare.bind(f.env.DB);
			vi.spyOn(f.env.DB, "prepare").mockImplementation((sql) => {
				const statement = prepare(sql);
				if (sql === "SELECT COUNT(*) AS cnt FROM posts") {
					return { ...statement, first: async () => value } as unknown as D1PreparedStatement;
				}
				return statement;
			});
			for (const action of ["run_stats", "apply_real"]) {
				await expect(
					handleCalibratePost(
						createAdminRequest("POST", "/api/admin/stats/calibrate", { action }),
						f.env,
					),
				).rejects.toThrow(/count/i);
			}
			expect(f.env.DB.batch).not.toHaveBeenCalled();
		},
	);

	it("rejects failed stored-counter reads instead of reporting zero", async () => {
		f.state.queryError = true;
		await expect(
			handleCalibrateGet(createAdminRequest("GET", "/api/admin/stats/calibrate"), f.env),
		).rejects.toThrow();
		await expect(
			handleCalibratePost(
				createAdminRequest("POST", "/api/admin/stats/calibrate", { action: "run_stats" }),
				f.env,
			),
		).rejects.toThrow();
	});

	it.each(["null", "[]", "7"])("rejects a non-object body: %s", async (body) => {
		const response = await handleCalibratePost(
			new Request("http://localhost/api/admin/stats/calibrate", {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Admin-API-Key": "test-admin-api-key" },
				body,
			}),
			f.env,
		);
		expect(response.status).toBe(400);
	});

	describe("POST /api/admin/stats/calibrate invalid action", () => {
		it("returns 400 for unknown action", async () => {
			const request = createAdminRequest("POST", "/api/admin/stats/calibrate", {
				action: "unknown",
			});
			const response = await handleCalibratePost(request, f.env);
			expect(response.status).toBe(400);
		});

		it("returns 400 for invalid JSON body", async () => {
			const request = new Request("http://localhost/api/admin/stats/calibrate", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Admin-API-Key": "test-admin-api-key",
				},
				body: "not json",
			});
			const response = await handleCalibratePost(request, f.env);
			expect(response.status).toBe(400);
		});
	});
});
