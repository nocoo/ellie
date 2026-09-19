// tests/integration/http/analytics.test.ts — L2 analytics coverage
//
// Pins the route × method surface for the admin analytics + login/visits
// audit + internal page-view ingest endpoints:
//
//   Internal (POST, X-Ingest-Key gated, dispatched BEFORE API key gate):
//     POST /api/internal/analytics/ingest
//
//   Admin trend / overview (Key B, range=7d|30d|90d):
//     GET  /api/admin/analytics/overview
//     GET  /api/admin/analytics/trend
//     GET  /api/admin/analytics/forum-dist
//     GET  /api/admin/analytics/checkin
//
//   Admin login-history audit (P4):
//     GET  /api/admin/analytics/today/logins
//     GET  /api/admin/analytics/today/logins/list
//
//   Admin today's visits aggregate (P5):
//     GET  /api/admin/analytics/today/visits
//     GET  /api/admin/analytics/today/visits/list
//
// L2-audit-only contract: each route × method must be hit from a live
// Worker so the audit gate sees it. Detailed handler logic (KV cache TTL,
// constant-time key comparison, IP masking, range parsing) lives in the
// existing handler unit tests under apps/worker/tests/unit/handlers.

import { describe, expect, test } from "bun:test";
import { TEST_WORKER_VARS } from "../../../scripts/lib/test-worker-vars";
import { adminGet, getWorkerUrl } from "../setup";

const WORKER_URL = getWorkerUrl();

describe("L2: Worker analytics API", () => {
	// ─── Internal ingest ───────────────────────────────────────────

	describe("POST /api/internal/analytics/ingest", () => {
		test("rejects unauthenticated ingest", async () => {
			const res = await fetch(`${WORKER_URL}/api/internal/analytics/ingest`, { method: "POST" });
			expect(res.status).toBe(401);
		});
		test("collects a real page view into the shared memory report", async () => {
			const read = async () =>
				(await (await adminGet("/api/admin/analytics/today/visits")).json()).data;
			const before = await read();
			const ingest = await fetch(`${WORKER_URL}/api/internal/analytics/ingest`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Ingest-Key": TEST_WORKER_VARS.ANALYTICS_INGEST_KEY,
					"User-Agent": "Mozilla/5.0",
				},
				body: JSON.stringify({ path_kind: "home", target_id: 0, user_id: 0 }),
			});
			expect(ingest.status).toBe(200);
			const deadline = Date.now() + 35_000;
			let after = await read();
			while (after.totalViews <= before.totalViews && Date.now() < deadline) {
				await Bun.sleep(100);
				after = await read();
			}
			expect(after.totalViews).toBeGreaterThan(before.totalViews);
			expect(after.startedAt).toBeGreaterThan(0);
			const list = await (
				await adminGet("/api/admin/analytics/today/visits/list?path_kind=home")
			).json();
			expect(
				list.data.rows.some(
					(row: { pathKind: string; views: number }) => row.pathKind === "home" && row.views > 0,
				),
			).toBe(true);
		}, 40_000);
	});

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

	// ─── Admin today/visits ────────────────────────────────────────

	describe("GET /api/admin/analytics/today/visits", () => {
		test("returns 200 with aggregate KPI payload", async () => {
			const res = await adminGet("/api/admin/analytics/today/visits");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/analytics/today/visits/list", () => {
		test("returns 200 with realtime no-store list payload", async () => {
			const res = await adminGet("/api/admin/analytics/today/visits/list");
			expect(res.status).toBe(200);
		});
	});
});
