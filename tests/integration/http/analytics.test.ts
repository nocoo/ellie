import { describe, expect, test } from "bun:test";
import { adminGet } from "../setup";

describe("L2: Worker analytics API", () => {
	// ─── Admin trend / overview ────────────────────────────────────

	describe("GET /api/admin/analytics/overview", () => {
		test("returns 200 with overview payload (no range — always today)", async () => {
			// Overview is a single-shot KPI snapshot of "today" — it does
			// NOT take a range parameter. The handler reads the URL only
			// for the cache key.
			const res = await adminGet("/api/admin/analytics/overview");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/analytics/trend", () => {
		test("returns 200 with trend payload (metric=users, range=30d)", async () => {
			const res = await adminGet("/api/admin/analytics/trend?metric=users&range=30d");
			expect(res.status).toBe(200);
		});

		test("returns 400 for an invalid metric", async () => {
			const res = await adminGet("/api/admin/analytics/trend?metric=bogus&range=7d");
			expect(res.status).toBe(400);
		});
	});

	describe("GET /api/admin/analytics/forum-dist", () => {
		test("returns 200 with forum-distribution payload (range=7d)", async () => {
			const res = await adminGet("/api/admin/analytics/forum-dist?range=7d");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/analytics/checkin", () => {
		test("returns 200 with checkin-trend payload (range=7d)", async () => {
			const res = await adminGet("/api/admin/analytics/checkin?range=7d");
			expect(res.status).toBe(200);
		});
	});

	// ─── Admin today/logins ────────────────────────────────────────

	describe("GET /api/admin/analytics/today/logins", () => {
		test("returns 200 with KPI card payload", async () => {
			const res = await adminGet("/api/admin/analytics/today/logins");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/analytics/today/logins/list", () => {
		test("returns 200 with masked list payload", async () => {
			const res = await adminGet("/api/admin/analytics/today/logins/list");
			expect(res.status).toBe(200);
		});

		test("accepts ok / kind / errorCode filter combinations", async () => {
			const res = await adminGet("/api/admin/analytics/today/logins/list?ok=1&kind=login");
			expect(res.status).toBe(200);
		});
	});
});
