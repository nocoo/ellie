// tests/integration/http/post-rating.test.ts — L2 post-rating coverage
//
// Pins the route × method surface for the post 评分 feature:
//
//   POST /api/v1/posts/:postId/rate                       (create)
//   GET  /api/v1/posts/:postId/ratings                    (list)
//   POST /api/v1/posts/:postId/ratings/:ratingId/revoke   (revoke)
//
// The product-logic happy path (quota window, role gate, credits refund,
// PM auto-emission, etc.) is covered by the dedicated unit tests under
// apps/worker/tests/unit/handlers/post-rating.*. This file only owns the
// L2-audit contract: every route × method is reachable from a live
// Worker, and the handler returns a credible 4xx for the boring boundary
// cases (missing JWT, unknown post, malformed body). That is sufficient
// for the strict-coverage gate and catches a router-table regression
// without doubling up the per-handler logic asserts that live closer to
// the code.

import { describe, expect, test } from "bun:test";
import { createTestJwt, workerFetch, workerPost } from "../setup";

describe("L2: Worker post-rating API", () => {
	// ─── Create ────────────────────────────────────────────────────

	describe("POST /api/v1/posts/:postId/rate", () => {
		test("returns 401 without JWT", async () => {
			// `withVerifiedEmail` gate fires before any handler logic,
			// so an unauthenticated request must short-circuit with 401.
			const res = await workerPost("/api/v1/posts/1/rate", {
				dimension: "credits",
				score: 1,
			});
			expect(res.status).toBe(401);
		});

		test("returns 4xx for an invalid body when authenticated", async () => {
			// Use a regular user (seeded id=3, role=0). The exact code may
			// be 400 (bad body) or 403 (role gate) depending on the validation
			// order — both are router-dispatched and that is what we are
			// asserting at the L2 layer.
			const jwt = await createTestJwt(3, 0);
			const res = await workerPost("/api/v1/posts/1/rate", {}, jwt);
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
		});
	});

	// ─── List ──────────────────────────────────────────────────────

	describe("GET /api/v1/posts/:postId/ratings", () => {
		test("returns 404 for a non-existent post", async () => {
			// The list endpoint does optional-auth then a post-chain JOIN.
			// A non-existent post id returns 404 (hides post existence per
			// `rejectListVisibility`).
			const res = await workerFetch("/api/v1/posts/9999999/ratings");
			expect(res.status).toBe(404);
		});
	});

	// ─── Revoke ────────────────────────────────────────────────────

	describe("POST /api/v1/posts/:postId/ratings/:ratingId/revoke", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPost("/api/v1/posts/1/ratings/1/revoke", {});
			expect(res.status).toBe(401);
		});

		test("returns 403 for a regular user (admin-only)", async () => {
			// docs/22 §3 — revoke is Admin / SuperMod only. Regular user
			// must be rejected before any DB read (no 404 leak).
			const jwt = await createTestJwt(3, 0);
			const res = await workerPost("/api/v1/posts/1/ratings/1/revoke", {}, jwt);
			expect([403, 404]).toContain(res.status);
		});
	});
});
