// tests/integration/worker/admin.test.ts — L2 Worker Admin API Tests
// Tests admin endpoints: forums, threads, posts, users, settings, etc.

import { describe, expect, test } from "bun:test";
import {
	adminDelete,
	adminGet,
	adminPatch,
	adminPost,
	adminPut,
	createTestJwt,
	workerPost,
} from "../setup";

describe("L2: Worker Admin API", () => {
	// ─── Admin Forums ──────────────────────────────────────────────

	describe("GET /api/admin/forums", () => {
		test("returns 200 with forum list", async () => {
			const res = await adminGet("/api/admin/forums");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
			expect(Array.isArray(data.data)).toBe(true);
		});
	});

	describe("GET /api/admin/forums/:id", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await adminGet("/api/admin/forums/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/forums", () => {
		test("returns 400 for missing required fields", async () => {
			const res = await adminPost("/api/admin/forums", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/forums/reorder", () => {
		test("returns 400 for invalid body", async () => {
			const res = await adminPost("/api/admin/forums/reorder", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/forums/:id/merge", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await adminPost("/api/admin/forums/999999/merge", {
				targetForumId: 1,
			});
			expect([400, 404]).toContain(res.status);
		});
	});

	describe("PATCH /api/admin/forums/:id", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await adminPatch("/api/admin/forums/999999", {
				name: "Updated",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/forums/:id", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await adminDelete("/api/admin/forums/999999");
			expect(res.status).toBe(404);
		});
	});

	// ─── Admin Threads ─────────────────────────────────────────────

	describe("GET /api/admin/threads", () => {
		test("returns 200 with thread list", async () => {
			const res = await adminGet("/api/admin/threads");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});

		test("supports pagination", async () => {
			const res = await adminGet("/api/admin/threads?limit=5&offset=0");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/threads/:id", () => {
		test("returns 404 for non-existent thread", async () => {
			const res = await adminGet("/api/admin/threads/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/threads/:id", () => {
		test("returns 404 for non-existent thread", async () => {
			const res = await adminPatch("/api/admin/threads/999999", {
				sticky: true,
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/threads/:id", () => {
		test("returns 404 for non-existent thread", async () => {
			const res = await adminDelete("/api/admin/threads/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/threads/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/threads/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/threads/batch-move", () => {
		test("returns 400 for missing params", async () => {
			const res = await adminPost("/api/admin/threads/batch-move", {});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Posts ───────────────────────────────────────────────

	describe("GET /api/admin/posts", () => {
		test("returns 200 with post list", async () => {
			const res = await adminGet("/api/admin/posts");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/posts/:id", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await adminGet("/api/admin/posts/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/posts/:id", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await adminPatch("/api/admin/posts/999999", {
				content: "Updated",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/posts/:id", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await adminDelete("/api/admin/posts/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/posts/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/posts/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Users ───────────────────────────────────────────────

	describe("GET /api/admin/users", () => {
		test("returns 200 with user list", async () => {
			const res = await adminGet("/api/admin/users");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/users/staff", () => {
		test("returns 200 with staff list", async () => {
			const res = await adminGet("/api/admin/users/staff");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/users/batch", () => {
		test("requires ids parameter", async () => {
			const res = await adminGet("/api/admin/users/batch");
			expect(res.status).toBe(400);
		});

		test("returns users for valid ids", async () => {
			const res = await adminGet("/api/admin/users/batch?ids=1,2,3");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/users/:id", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminGet("/api/admin/users/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/users/:id", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPatch("/api/admin/users/999999", {
				role: 1,
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/users/:id/ban", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPost("/api/admin/users/999999/ban", {
				reason: "Test",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/users/:id/nuke", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPost("/api/admin/users/999999/nuke", {
				reason: "Test",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/users/:id/purge", () => {
		test("returns 400 for missing confirm body", async () => {
			const res = await adminPost("/api/admin/users/999999/purge", {});
			expect(res.status).toBe(400);
			const data = await res.json();
			// confirm is missing → "confirm must be a string"
			expect(data.error.code).toBe("INVALID_BODY");
		});

		test("returns 400 when confirm is not 'ok'", async () => {
			const res = await adminPost("/api/admin/users/999999/purge", { confirm: "no" });
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("CONFIRM_MISMATCH");
		});

		test("returns 404 for non-existent user", async () => {
			const res = await adminPost("/api/admin/users/999999/purge", { confirm: "ok" });
			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error.code).toBe("USER_NOT_FOUND");
		});
	});

	describe("POST /api/admin/users/:id/recalc-counters", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPost("/api/admin/users/999999/recalc-counters", {});
			expect(res.status).toBe(404);
		});
	});

	// ─── Check-ins (Admin) — Phase E ─────────────────────────────
	//
	// Three user-scoped endpoints. L2 hits the auth-passed handler path
	// and asserts the canonical not-found / validation responses; deeper
	// behavior (recompute semantics, audit log) is unit-tested in
	// apps/worker/tests/unit/handlers/admin/checkin.test.ts.

	describe("GET /api/admin/users/:id/checkins", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminGet("/api/admin/users/999999/checkins");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/users/:id/checkins/:dateLocal", () => {
		test("returns 400 for invalid calendar date", async () => {
			const res = await adminPatch("/api/admin/users/999999/checkins/2026-02-31", {
				checkedIn: true,
			});
			expect(res.status).toBe(400);
		});
	});

	describe("PATCH /api/admin/users/:id/checkins/streak", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPatch("/api/admin/users/999999/checkins/streak", {
				streakDays: 7,
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/users/batch-status", () => {
		test("returns 400 for missing params", async () => {
			const res = await adminPost("/api/admin/users/batch-status", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/users/batch-role", () => {
		test("returns 400 for missing params", async () => {
			const res = await adminPost("/api/admin/users/batch-role", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/users/batch-recalc-counters", () => {
		test("accepts empty ids array (recalcs all users)", async () => {
			// API accepts empty array and recalculates all users
			const res = await adminPost("/api/admin/users/batch-recalc-counters", {
				ids: [],
			});
			expect(res.status).toBe(200);
		});
	});

	// ─── Admin Statistics ──────────────────────────────────────────

	describe("POST /api/admin/statistics/recalc-forums", () => {
		test("recalculates forum stats", async () => {
			const res = await adminPost("/api/admin/statistics/recalc-forums", {});
			expect(res.status).toBe(200);
		});
	});

	describe("POST /api/admin/statistics/recalc-threads", () => {
		test("recalculates thread stats", async () => {
			const res = await adminPost("/api/admin/statistics/recalc-threads", {});
			expect(res.status).toBe(200);
		});
	});

	describe("POST /api/admin/statistics/recalc-users", () => {
		test("recalculates user stats", async () => {
			const res = await adminPost("/api/admin/statistics/recalc-users", {});
			expect(res.status).toBe(200);
		});
	});

	describe("POST /api/admin/statistics/recalc-post-forums", () => {
		test("advances the post-forums sync job", async () => {
			// First POST initializes the job (returns the v=1 snapshot at
			// cursor 0). We only assert the wire contract here — the
			// state-machine semantics are covered by worker unit tests.
			const res = await adminPost("/api/admin/statistics/recalc-post-forums", {});
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/statistics/job/:kind", () => {
		test("reads the per-kind job snapshot without advancing", async () => {
			// `data` is either the StatsJobPayload (when a prior POST has
			// initialised the slot) or null (no KV state yet). Either is
			// a valid 2xx response — the route is read-only.
			const res = await adminGet("/api/admin/statistics/job/forums");
			expect(res.status).toBe(200);
		});
	});

	// ─── Admin Attachments ─────────────────────────────────────────

	describe("GET /api/admin/attachments", () => {
		test("returns 200 with attachment list", async () => {
			const res = await adminGet("/api/admin/attachments");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/attachments/:id", () => {
		test("returns 404 for non-existent attachment", async () => {
			const res = await adminGet("/api/admin/attachments/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/attachments/:id", () => {
		test("returns 404 for non-existent attachment", async () => {
			const res = await adminDelete("/api/admin/attachments/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/attachments/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/attachments/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin IP Bans ─────────────────────────────────────────────

	describe("GET /api/admin/ip-bans", () => {
		test("returns 200 with IP ban list", async () => {
			const res = await adminGet("/api/admin/ip-bans");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/ip-bans/check-ip", () => {
		test("checks IP status", async () => {
			const res = await adminGet("/api/admin/ip-bans/check-ip?ip=192.168.1.1");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/ip-bans/:id", () => {
		test("returns 404 for non-existent IP ban", async () => {
			const res = await adminGet("/api/admin/ip-bans/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/ip-bans", () => {
		test("returns 400 for missing required fields", async () => {
			const res = await adminPost("/api/admin/ip-bans", {});
			expect(res.status).toBe(400);
		});
	});

	describe("PATCH /api/admin/ip-bans/:id", () => {
		test("returns 404 for non-existent IP ban", async () => {
			const res = await adminPatch("/api/admin/ip-bans/999999", {
				reason: "Updated",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/ip-bans/:id", () => {
		test("returns 404 for non-existent IP ban", async () => {
			const res = await adminDelete("/api/admin/ip-bans/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/ip-bans/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/ip-bans/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Censor Words ────────────────────────────────────────

	describe("GET /api/admin/censor-words", () => {
		test("returns 200 with censor word list", async () => {
			const res = await adminGet("/api/admin/censor-words");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/censor-words/:id", () => {
		test("returns 404 for non-existent censor word", async () => {
			const res = await adminGet("/api/admin/censor-words/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/censor-words", () => {
		test("returns 400 for missing required fields", async () => {
			const res = await adminPost("/api/admin/censor-words", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/censor-words/test", () => {
		test("requires content field", async () => {
			// API requires 'content' not 'text'
			const res = await adminPost("/api/admin/censor-words/test", {
				text: "Hello world",
			});
			expect(res.status).toBe(400);
		});

		test("tests censor word matching with correct field", async () => {
			const res = await adminPost("/api/admin/censor-words/test", {
				content: "Hello world",
			});
			expect(res.status).toBe(200);
		});
	});

	describe("PATCH /api/admin/censor-words/:id", () => {
		test("returns 404 for non-existent censor word", async () => {
			const res = await adminPatch("/api/admin/censor-words/999999", {
				replacement: "***",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/censor-words/:id", () => {
		test("returns 404 for non-existent censor word", async () => {
			const res = await adminDelete("/api/admin/censor-words/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/censor-words/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/censor-words/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Stats ───────────────────────────────────────────────

	describe("GET /api/admin/stats", () => {
		test("returns 200 with admin stats", async () => {
			const res = await adminGet("/api/admin/stats");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	// ─── Admin Settings ────────────────────────────────────────────

	describe("GET /api/admin/settings", () => {
		test("returns 200 with settings", async () => {
			const res = await adminGet("/api/admin/settings");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("PUT /api/admin/settings", () => {
		test("updates settings", async () => {
			const res = await adminPut("/api/admin/settings", {
				settings: {},
			});
			// Could be 200 or 400 depending on validation
			expect([200, 400]).toContain(res.status);
		});
	});

	// ─── Admin Reports ─────────────────────────────────────────────

	describe("GET /api/admin/reports", () => {
		test("returns 200 with report list", async () => {
			const res = await adminGet("/api/admin/reports");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/reports/:id", () => {
		test("returns 404 for non-existent report", async () => {
			const res = await adminGet("/api/admin/reports/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/reports/:id", () => {
		test("returns 404 for non-existent report", async () => {
			const res = await adminPatch("/api/admin/reports/999999", {
				status: "resolved",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/reports/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/reports/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Reports lifecycle (E4: post → list/get → patch → batch-delete) ───
	//
	// End-to-end flow exercising the real Worker chain (no mocks):
	//   1. user 100 (e2etest) submits a thread report against thread 662174
	//      (author 64495) and a user report against user 64495.
	//   2. Admin GET list with type=thread / type=user surfaces both rows
	//      with the per-type JOIN metadata (target_title for thread,
	//      target_name for user).
	//   3. Admin GET detail returns the same JOIN-shaped payload.
	//   4. Admin PATCH transitions pending → resolved with handler info.
	//   5. Admin batch-delete removes the seeded rows so the test is
	//      idempotent across runs (the Worker also enforces a 24h dedup
	//      window keyed on reporter+type+target_id).

	describe("Reports lifecycle (thread + user)", () => {
		test("submit → list → get → patch → batch-delete", async () => {
			// Reporter is user 100 (e2etest, role=0); targets belong to user 64495.
			const reporterJwt = await createTestJwt(100, 0);

			// 1a. Submit thread report.
			const threadRes = await workerPost(
				"/api/v1/reports",
				{ type: "thread", targetId: 662174, reason: "垃圾广告" },
				reporterJwt,
			);
			// Accept 201 (fresh) or 400 DUPLICATE_REPORT (dedup window from prior run)
			// — in the dedup case we recover the existing report id via admin list.
			let threadReportId: number | null = null;
			if (threadRes.status === 201) {
				const body = (await threadRes.json()) as { data: { id: number; type: string } };
				expect(body.data.type).toBe("thread");
				threadReportId = body.data.id;
			} else {
				expect(threadRes.status).toBe(400);
				const body = (await threadRes.json()) as { error?: { code?: string } };
				expect(body.error?.code).toBe("DUPLICATE_REPORT");
			}

			// 1b. Submit user report.
			const userRes = await workerPost(
				"/api/v1/reports",
				{ type: "user", targetId: 64495, reason: "人身攻击" },
				reporterJwt,
			);
			let userReportId: number | null = null;
			if (userRes.status === 201) {
				const body = (await userRes.json()) as { data: { id: number; type: string } };
				expect(body.data.type).toBe("user");
				userReportId = body.data.id;
			} else {
				expect(userRes.status).toBe(400);
				const body = (await userRes.json()) as { error?: { code?: string } };
				expect(body.error?.code).toBe("DUPLICATE_REPORT");
			}

			// 2a. Admin list with type=thread surfaces the thread report with title.
			const listThreadRes = await adminGet(
				"/api/admin/reports?type=thread&reporterId=100&limit=50",
			);
			expect(listThreadRes.status).toBe(200);
			const listThread = (await listThreadRes.json()) as {
				data: Array<{
					id: number;
					type: string;
					targetId: number;
					threadId: number | null;
					targetTitle: string | null;
					targetName: string | null;
				}>;
			};
			const threadHit = listThread.data.find((r) => r.targetId === 662174 && r.type === "thread");
			expect(threadHit).toBeDefined();
			expect(threadHit?.threadId).toBe(662174);
			expect(threadHit?.targetTitle).toBe("L3 navigation thread");
			expect(threadHit?.targetName).toBeNull();
			if (threadReportId === null) threadReportId = threadHit?.id ?? null;
			expect(threadReportId).not.toBeNull();

			// 2b. Admin list with type=user surfaces the user report with username.
			const listUserRes = await adminGet("/api/admin/reports?type=user&reporterId=100&limit=50");
			expect(listUserRes.status).toBe(200);
			const listUser = (await listUserRes.json()) as {
				data: Array<{
					id: number;
					type: string;
					targetId: number;
					threadId: number | null;
					targetTitle: string | null;
					targetName: string | null;
				}>;
			};
			const userHit = listUser.data.find((r) => r.targetId === 64495 && r.type === "user");
			expect(userHit).toBeDefined();
			expect(userHit?.threadId).toBeNull();
			expect(userHit?.targetTitle).toBeNull();
			expect(userHit?.targetName).toBe("e2eprofile");
			if (userReportId === null) userReportId = userHit?.id ?? null;
			expect(userReportId).not.toBeNull();

			// 3. Admin GET detail returns the same JOIN-shaped payload for the thread report.
			const detailRes = await adminGet(`/api/admin/reports/${threadReportId}`);
			expect(detailRes.status).toBe(200);
			const detail = (await detailRes.json()) as {
				data: {
					id: number;
					type: string;
					threadId: number | null;
					targetTitle: string | null;
					targetName: string | null;
				};
			};
			expect(detail.data.id).toBe(threadReportId);
			expect(detail.data.type).toBe("thread");
			expect(detail.data.threadId).toBe(662174);
			expect(detail.data.targetTitle).toBe("L3 navigation thread");
			expect(detail.data.targetName).toBeNull();

			// 3b. Admin GET detail for the user report exercises the user-branch JOIN.
			const userDetailRes = await adminGet(`/api/admin/reports/${userReportId}`);
			expect(userDetailRes.status).toBe(200);
			const userDetail = (await userDetailRes.json()) as {
				data: {
					id: number;
					type: string;
					threadId: number | null;
					targetTitle: string | null;
					targetName: string | null;
				};
			};
			expect(userDetail.data.id).toBe(userReportId);
			expect(userDetail.data.type).toBe("user");
			expect(userDetail.data.threadId).toBeNull();
			expect(userDetail.data.targetTitle).toBeNull();
			expect(userDetail.data.targetName).toBe("e2eprofile");

			// 4. Admin PATCH the thread report to resolved.
			const patchRes = await adminPatch(`/api/admin/reports/${threadReportId}`, {
				status: "resolved",
				handlerId: 1,
				handlerName: "admin",
			});
			expect(patchRes.status).toBe(200);
			const patched = (await patchRes.json()) as {
				data: { status: string; handlerId: number | null; handlerName: string };
			};
			expect(patched.data.status).toBe("resolved");
			expect(patched.data.handlerId).toBe(1);
			expect(patched.data.handlerName).toBe("admin");

			// 5. Cleanup: batch-delete both reports so the test is idempotent.
			const ids = [threadReportId, userReportId].filter((id): id is number => id !== null);
			expect(ids.length).toBeGreaterThan(0);
			const cleanupRes = await adminPost("/api/admin/reports/batch-delete", { ids });
			expect(cleanupRes.status).toBe(200);

			// Verify cleanup — detail of the deleted thread report should now 404.
			const verifyRes = await adminGet(`/api/admin/reports/${threadReportId}`);
			expect(verifyRes.status).toBe(404);
		});
	});

	// ─── Admin Logs ────────────────────────────────────────────────

	describe("GET /api/admin/admin-logs", () => {
		test("returns 200 with admin log list", async () => {
			const res = await adminGet("/api/admin/admin-logs");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/admin-logs/:id", () => {
		test("returns 404 for non-existent log", async () => {
			const res = await adminGet("/api/admin/admin-logs/999999");
			expect(res.status).toBe(404);
		});
	});

	// ─── F3-a audit lifecycle ──────────────────────────────────────
	//
	// End-to-end check: a high-risk admin mutation must land an admin_logs
	// row that is immediately surfaced via the admin-logs filter API. We
	// run two independent chains (user.ban + report.resolve) so a regression
	// in either the writer or the reader is caught.
	//
	// Both tests use idempotent fixtures: ban is paired with an unban; the
	// report is created via the public API and torn down with batch-delete.

	describe("F3-a audit lifecycle (user.ban + report.resolve)", () => {
		test("user.ban writes a user.ban admin_logs row that the list API surfaces", async () => {
			// Snapshot the current top admin_logs id so we can detect the new row
			// without scanning the entire table (audit trail can grow over time).
			const beforeRes = await adminGet("/api/admin/admin-logs?action=user.ban&limit=1");
			expect(beforeRes.status).toBe(200);
			const before = (await beforeRes.json()) as {
				data: Array<{ id: number; targetId: number | null }>;
			};
			const beforeTopId = before.data[0]?.id ?? 0;

			// Ban target user 100 (e2etest), no content delete.
			const banRes = await adminPost("/api/admin/users/100/ban", { deleteContent: false });
			expect(banRes.status).toBe(200);
			const banBody = (await banRes.json()) as { data: { banned: boolean } };
			expect(banBody.data.banned).toBe(true);

			try {
				// Best-effort poll: writeAdminLog is fire-and-forget; give it a
				// short window in case the row hasn't landed yet.
				let hit:
					| { id: number; action: string; targetId: number | null; targetType: string }
					| undefined;
				for (let i = 0; i < 5 && !hit; i++) {
					const res = await adminGet("/api/admin/admin-logs?action=user.ban&limit=10");
					expect(res.status).toBe(200);
					const body = (await res.json()) as {
						data: Array<{
							id: number;
							action: string;
							targetId: number | null;
							targetType: string;
						}>;
					};
					hit = body.data.find((row) => row.id > beforeTopId && row.targetId === 100);
					if (!hit) await new Promise((r) => setTimeout(r, 100));
				}
				expect(hit).toBeDefined();
				expect(hit?.action).toBe("user.ban");
				expect(hit?.targetType).toBe("user");
				expect(hit?.targetId).toBe(100);
			} finally {
				// Cleanup — restore the user so the test is idempotent.
				await adminPost("/api/admin/users/100/unban", {});
			}
		});

		test("report.resolve writes a report.resolve admin_logs row that the list API surfaces", async () => {
			// Reporter is user 100 (e2etest, role=0); target is thread 662174.
			const reporterJwt = await createTestJwt(100, 0);

			// `reason` must be one of the fixed REPORT_REASONS enum
			// (apps/worker/src/handlers/report.ts) — cannot use a unique
			// marker. The (reporter, type, targetId) tuple is enough to
			// identify the row inside the 24h dedup window (only one pending
			// row can exist per tuple per window).

			// 1. Submit a thread report.
			const submitRes = await workerPost(
				"/api/v1/reports",
				{ type: "thread", targetId: 662174, reason: "垃圾广告" },
				reporterJwt,
			);
			let reportId: number | null = null;
			if (submitRes.status === 201) {
				const body = (await submitRes.json()) as { data: { id: number } };
				reportId = body.data.id;
			} else {
				// Only DUPLICATE_REPORT is acceptable (24h dedup window from a
				// prior run within the same calendar day).
				expect(submitRes.status).toBe(400);
				const errBody = (await submitRes.json()) as { error?: { code?: string } };
				expect(errBody.error?.code).toBe("DUPLICATE_REPORT");
				// Recover the dedup'd id via admin list. Filter to our exact
				// (type, target, reporter) tuple — there can be at most one
				// pending row per the dedup constraint.
				const listRes = await adminGet("/api/admin/reports?type=thread&reporterId=100&limit=50");
				expect(listRes.status).toBe(200);
				const list = (await listRes.json()) as {
					data: Array<{
						id: number;
						targetId: number;
						type: string;
						status: string;
					}>;
				};
				// Prefer pending; fall back to any matching (resolved/dismissed
				// shouldn't normally appear because dedup checks pending only,
				// but being defensive doesn't hurt).
				const candidates = list.data.filter((r) => r.type === "thread" && r.targetId === 662174);
				reportId = (candidates.find((r) => r.status === "pending") ?? candidates[0])?.id ?? null;
			}
			expect(reportId).not.toBeNull();
			const finalReportId = reportId as number;

			// 2. Snapshot top admin_logs id for action=report.resolve.
			const beforeRes = await adminGet("/api/admin/admin-logs?action=report.resolve&limit=1");
			expect(beforeRes.status).toBe(200);
			const before = (await beforeRes.json()) as {
				data: Array<{ id: number; targetId: number | null }>;
			};
			const beforeTopId = before.data[0]?.id ?? 0;

			try {
				// 3. Resolve the report.
				const patchRes = await adminPatch(`/api/admin/reports/${finalReportId}`, {
					status: "resolved",
					handlerId: 1,
					handlerName: "admin",
				});
				expect(patchRes.status).toBe(200);

				// 4. Poll the admin-logs list for the new entry.
				let hit:
					| { id: number; action: string; targetId: number | null; targetType: string }
					| undefined;
				for (let i = 0; i < 5 && !hit; i++) {
					const res = await adminGet("/api/admin/admin-logs?action=report.resolve&limit=10");
					expect(res.status).toBe(200);
					const body = (await res.json()) as {
						data: Array<{
							id: number;
							action: string;
							targetId: number | null;
							targetType: string;
						}>;
					};
					hit = body.data.find((row) => row.id > beforeTopId && row.targetId === finalReportId);
					if (!hit) await new Promise((r) => setTimeout(r, 100));
				}
				expect(hit).toBeDefined();
				expect(hit?.action).toBe("report.resolve");
				expect(hit?.targetType).toBe("report");
				expect(hit?.targetId).toBe(finalReportId);
			} finally {
				// 5. Cleanup — delete the report so the test is idempotent.
				await adminPost("/api/admin/reports/batch-delete", { ids: [finalReportId] });
			}
		});

		// ─── F3-b: thread.update lifecycle ─────────────────────────
		// Same pattern as F3-a: snapshot → mutate → poll → restore.
		// Picks `sticky` because it's reversible without affecting content
		// or other fixtures, and because it's a non-subject field so the
		// audit row should carry before/after rather than length-only.

		test("thread.update writes a thread.update admin_logs row that the list API surfaces", async () => {
			// Read current sticky so we can restore it deterministically.
			const getRes = await adminGet("/api/admin/threads/662174");
			expect(getRes.status).toBe(200);
			const thread = (await getRes.json()) as { data: { sticky: number } };
			const originalSticky = thread.data.sticky;
			// Toggle to a different valid value (sticky range is 0-3).
			const newSticky = originalSticky === 0 ? 1 : 0;

			const beforeRes = await adminGet("/api/admin/admin-logs?action=thread.update&limit=1");
			expect(beforeRes.status).toBe(200);
			const before = (await beforeRes.json()) as {
				data: Array<{ id: number; targetId: number | null }>;
			};
			const beforeTopId = before.data[0]?.id ?? 0;

			try {
				const patchRes = await adminPatch("/api/admin/threads/662174", { sticky: newSticky });
				expect(patchRes.status).toBe(200);

				let hit:
					| { id: number; action: string; targetId: number | null; targetType: string }
					| undefined;
				for (let i = 0; i < 5 && !hit; i++) {
					const res = await adminGet("/api/admin/admin-logs?action=thread.update&limit=10");
					expect(res.status).toBe(200);
					const body = (await res.json()) as {
						data: Array<{
							id: number;
							action: string;
							targetId: number | null;
							targetType: string;
						}>;
					};
					hit = body.data.find((row) => row.id > beforeTopId && row.targetId === 662174);
					if (!hit) await new Promise((r) => setTimeout(r, 100));
				}
				expect(hit).toBeDefined();
				expect(hit?.action).toBe("thread.update");
				expect(hit?.targetType).toBe("thread");
				expect(hit?.targetId).toBe(662174);
			} finally {
				// Restore original sticky so subsequent runs and other tests
				// see the fixture in its baseline state.
				await adminPatch("/api/admin/threads/662174", { sticky: originalSticky });
			}
		});
	});

	// ─── Admin Announcements ───────────────────────────────────────

	describe("GET /api/admin/announcements", () => {
		test("returns 200 with announcement list", async () => {
			const res = await adminGet("/api/admin/announcements");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/announcements/:id", () => {
		test("returns 404 for non-existent announcement", async () => {
			const res = await adminGet("/api/admin/announcements/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/announcements", () => {
		test("returns 400 for missing required fields", async () => {
			const res = await adminPost("/api/admin/announcements", {});
			expect(res.status).toBe(400);
		});
	});

	describe("PATCH /api/admin/announcements/:id", () => {
		test("returns 404 for non-existent announcement", async () => {
			const res = await adminPatch("/api/admin/announcements/999999", {
				title: "Updated",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/announcements/:id", () => {
		test("returns 404 for non-existent announcement", async () => {
			const res = await adminDelete("/api/admin/announcements/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/announcements/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/announcements/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── F3-c: ip_ban audit lifecycle ──────────────────────────────
	// Same poll pattern as F3-a/F3-b. We use ip_ban for the create→delete
	// chain because the handler auto-fills required schema fields
	// (admin_id/admin_name/created_at), it has no foreign-key dependencies,
	// and IP plaintext is allowed in audit details per the F3-c spec.

	describe("F3-c audit lifecycle (ip_ban create + delete)", () => {
		test("ip_ban.create then ip_ban.delete each surface in admin-logs", async () => {
			// Use a unique non-loopback IP so the self-ban check
			// (CF-Connecting-IP match) cannot interfere across reruns.
			const lastOctet = (Date.now() % 250) + 2;
			const uniqueIp = `198.51.100.${lastOctet}`;

			const beforeCreateRes = await adminGet("/api/admin/admin-logs?action=ip_ban.create&limit=1");
			expect(beforeCreateRes.status).toBe(200);
			const beforeCreate = (await beforeCreateRes.json()) as {
				data: Array<{ id: number }>;
			};
			const beforeCreateTopId = beforeCreate.data[0]?.id ?? 0;

			const beforeDeleteRes = await adminGet("/api/admin/admin-logs?action=ip_ban.delete&limit=1");
			expect(beforeDeleteRes.status).toBe(200);
			const beforeDelete = (await beforeDeleteRes.json()) as {
				data: Array<{ id: number }>;
			};
			const beforeDeleteTopId = beforeDelete.data[0]?.id ?? 0;

			// 1. Create
			const createRes = await adminPost("/api/admin/ip-bans", {
				ip: uniqueIp,
				reason: "F3-c L2 audit chain test",
			});
			expect(createRes.status).toBe(201);
			const created = (await createRes.json()) as { data: { id: number } };
			const newId = created.data.id;

			try {
				// 2. Poll for create audit row.
				let createHit:
					| { id: number; action: string; targetId: number | null; targetType: string }
					| undefined;
				for (let i = 0; i < 5 && !createHit; i++) {
					const res = await adminGet("/api/admin/admin-logs?action=ip_ban.create&limit=10");
					expect(res.status).toBe(200);
					const body = (await res.json()) as {
						data: Array<{
							id: number;
							action: string;
							targetId: number | null;
							targetType: string;
						}>;
					};
					createHit = body.data.find((row) => row.id > beforeCreateTopId && row.targetId === newId);
					if (!createHit) await new Promise((r) => setTimeout(r, 100));
				}
				expect(createHit).toBeDefined();
				expect(createHit?.action).toBe("ip_ban.create");
				expect(createHit?.targetType).toBe("ip_ban");
				expect(createHit?.targetId).toBe(newId);
			} finally {
				// 3. Delete (cleanup) — runs regardless of poll outcome
				// so the fixture state is always restored for subsequent runs.
				const delRes = await adminDelete(`/api/admin/ip-bans/${newId}`);
				expect(delRes.status).toBe(200);
			}

			// 4. Poll for delete audit row.
			let deleteHit:
				| { id: number; action: string; targetId: number | null; targetType: string }
				| undefined;
			for (let i = 0; i < 5 && !deleteHit; i++) {
				const res = await adminGet("/api/admin/admin-logs?action=ip_ban.delete&limit=10");
				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					data: Array<{
						id: number;
						action: string;
						targetId: number | null;
						targetType: string;
					}>;
				};
				deleteHit = body.data.find((row) => row.id > beforeDeleteTopId && row.targetId === newId);
				if (!deleteHit) await new Promise((r) => setTimeout(r, 100));
			}
			expect(deleteHit).toBeDefined();
			expect(deleteHit?.action).toBe("ip_ban.delete");
			expect(deleteHit?.targetType).toBe("ip_ban");
			expect(deleteHit?.targetId).toBe(newId);
		});
	});
});
