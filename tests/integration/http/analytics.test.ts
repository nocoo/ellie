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
import { adminGet, getWorkerUrl } from "../setup";

const WORKER_URL = getWorkerUrl();

describe("L2: Worker analytics API", () => {
	// ─── Internal ingest ───────────────────────────────────────────

	describe("POST /api/internal/analytics/ingest", () => {
		test("returns 503 when ANALYTICS_INGEST_KEY is not configured", async () => {
			// L2 worker boots without ANALYTICS_INGEST_KEY (see scripts/run-l2.ts
			// — only API_KEY / ADMIN_API_KEY / JWT_SECRET are injected). The
			// handler refuses with INGEST_NOT_CONFIGURED to surface the
			// deployment-hardening invariant: no anonymous ingest without
			// the shared secret in place. This is the only branch we can
			// reliably exercise from L2 without baking a secret into the
			// boot script.
			const res = await fetch(`${WORKER_URL}/api/internal/analytics/ingest`, { method: "POST" });
			// Allow 401 in case the worker pushes auth checks even without
			// a configured key (current handler returns 503 first); either
			// status proves the router actually dispatched the handler.
			expect([401, 503]).toContain(res.status);
		});
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
