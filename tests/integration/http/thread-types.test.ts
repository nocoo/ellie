// tests/integration/http/thread-types.test.ts — L2 forum_thread_types coverage
//
// Pins the route × method surface for the per-forum "主题分类" feature:
//
//   Public:
//     GET    /api/v1/forums/:forumId/thread-types
//
//   Admin (Key B):
//     GET    /api/admin/forums/:forumId/thread-types
//     POST   /api/admin/forums/:forumId/thread-types
//     PATCH  /api/admin/forums/:forumId/thread-types/reorder
//     PATCH  /api/admin/forums/:forumId/thread-types-config
//     PATCH  /api/admin/forum-thread-types/:id
//     DELETE /api/admin/forum-thread-types/:id
//
// The test bodies do not own the full thread-type product logic (that lives
// in the handler unit tests); they only assert that:
//   1. The router actually dispatches to the handler (no 404 from the
//      router fallback).
//   2. The handler's surface-level contract holds — empty/missing body
//      returns the right 4xx, unknown forums/types return 404, etc.
// These guarantees are enough for the L2 audit-coverage gate, and they
// catch any future refactor that quietly drops a route from src/index.ts
// or re-shadows it behind a sibling.

import { describe, expect, test } from "bun:test";
import { adminDelete, adminGet, adminPatch, adminPost, workerFetch } from "../setup";

describe("L2: Worker thread-types API", () => {
	// ─── Public read ───────────────────────────────────────────────

	describe("GET /api/v1/forums/:forumId/thread-types", () => {
		test("returns 200 with the picker payload for a known forum", async () => {
			// Seed forum 1 exists with no thread types yet; the public
			// payload is still valid — `types` is just an empty array.
			const res = await workerFetch("/api/v1/forums/1/thread-types");
			expect(res.status).toBe(200);
			// jsonResponse wraps the payload in `{ data, meta }` — the
			// picker payload itself lives under `.data`.
			const envelope = (await res.json()) as {
				data: {
					enabled: boolean;
					required: boolean;
					listable: boolean;
					prefix: boolean;
					types: unknown[];
				};
			};
			expect(typeof envelope.data.enabled).toBe("boolean");
			expect(Array.isArray(envelope.data.types)).toBe(true);
		});

		test("returns 404 for a non-existent forum", async () => {
			const res = await workerFetch("/api/v1/forums/9999999/thread-types");
			expect(res.status).toBe(404);
		});
	});

	// ─── Admin list ────────────────────────────────────────────────

	describe("GET /api/admin/forums/:forumId/thread-types", () => {
		test("returns 200 with admin DTO list for a known forum", async () => {
			const res = await adminGet("/api/admin/forums/1/thread-types");
			expect(res.status).toBe(200);
			// Admin endpoints wrap the payload in `{ data, meta }` as well.
			const envelope = (await res.json()) as {
				data: {
					forumId: number;
					config: {
						enabled: boolean;
						required: boolean;
						listable: boolean;
						prefix: boolean;
					};
					types: unknown[];
				};
			};
			expect(envelope.data.forumId).toBe(1);
			expect(typeof envelope.data.config.enabled).toBe("boolean");
			expect(Array.isArray(envelope.data.types)).toBe(true);
		});

		test("returns 404 for a non-existent forum", async () => {
			const res = await adminGet("/api/admin/forums/9999999/thread-types");
			expect(res.status).toBe(404);
		});
	});

	// ─── Admin create ──────────────────────────────────────────────

	describe("POST /api/admin/forums/:forumId/thread-types", () => {
		test("returns 400 for missing name", async () => {
			const res = await adminPost("/api/admin/forums/1/thread-types", {});
			expect(res.status).toBe(400);
		});

		test("returns 400 for unknown body fields (strict whitelist)", async () => {
			const res = await adminPost("/api/admin/forums/1/thread-types", {
				name: "valid",
				bogusField: "x",
			});
			expect(res.status).toBe(400);
		});

		test("returns 404 for a non-existent forum", async () => {
			const res = await adminPost("/api/admin/forums/9999999/thread-types", {
				name: "ignored",
			});
			expect(res.status).toBe(404);
		});
	});

	// ─── Admin reorder ─────────────────────────────────────────────

	describe("PATCH /api/admin/forums/:forumId/thread-types/reorder", () => {
		test("returns 400 for missing/invalid body", async () => {
			// NOTE: keep helper(path, body) on one line — the L2 audit
			// scanner only detects helper calls when the opening paren and
			// the path-literal share a source line.
			const res = await adminPatch("/api/admin/forums/1/thread-types/reorder", {});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin 4-switch config ─────────────────────────────────────

	describe("PATCH /api/admin/forums/:forumId/thread-types-config", () => {
		test("returns 404 for a non-existent forum", async () => {
			const res = await adminPatch("/api/admin/forums/9999999/thread-types-config", {
				enabled: false,
			});
			expect(res.status).toBe(404);
		});

		test("returns 400 for an invalid flag type", async () => {
			// `enabled` must be a boolean; a string trips the per-flag
			// type guard with INVALID_BODY.
			const res = await adminPatch("/api/admin/forums/1/thread-types-config", { enabled: "yes" });
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin update (single thread type) ─────────────────────────

	describe("PATCH /api/admin/forum-thread-types/:id", () => {
		test("returns 404 for a non-existent thread type", async () => {
			const res = await adminPatch("/api/admin/forum-thread-types/9999999", { name: "ignored" });
			expect(res.status).toBe(404);
		});
	});

	// ─── Admin delete (single thread type) ─────────────────────────

	describe("DELETE /api/admin/forum-thread-types/:id", () => {
		test("returns 404 for a non-existent thread type", async () => {
			const res = await adminDelete("/api/admin/forum-thread-types/9999999");
			expect(res.status).toBe(404);
		});
	});
});
