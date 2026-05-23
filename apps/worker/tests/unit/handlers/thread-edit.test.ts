// Tests for PATCH /api/v1/threads/:id — author + moderator subject editing.
// Pins the freeze rules per reviewer msg=a8ee78db:
//   - permission: canEditThreadSubject (author/active/open OR mod-in-scope OR admin/supermod)
//   - body strict: only `subject`, non-empty, ≤200 chars
//   - censor: applyCensorFilter → banned ⇒ CONTENT_BANNED 403; replace ⇒ filtered value stored
//   - cache invalidation: bumpThreadMetaGen + bumpThreadListGen + bumpForumSummaryGen
//   - semantic no-op: subject unchanged ⇒ 200 without any bump
//   - audit: NO admin_logs writes from this endpoint
//
// Mock surface mirrors apps/worker/tests/unit/handlers/cache-invalidation-phase1.test.ts:
// we mock the cache module + censor module so we can assert call counts without
// touching real KV / DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/cache/invalidate", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/cache/invalidate")>(
		"../../../src/lib/cache/invalidate",
	);
	return {
		...actual,
		bumpThreadMetaGen: vi.fn(async () => "g"),
		bumpThreadListGen: vi.fn(async () => "g"),
		bumpForumSummaryGen: vi.fn(async () => "g"),
	};
});

vi.mock("../../../src/lib/censor", () => ({
	applyCensorFilter: vi.fn(async (content: string) => ({ banned: false, content })),
}));

import { editThreadSubject } from "../../../src/handlers/thread-edit";
import {
	bumpForumSummaryGen,
	bumpThreadListGen,
	bumpThreadMetaGen,
} from "../../../src/lib/cache/invalidate";
import { applyCensorFilter } from "../../../src/lib/censor";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";

const mockBumpMeta = bumpThreadMetaGen as ReturnType<typeof vi.fn>;
const mockBumpList = bumpThreadListGen as ReturnType<typeof vi.fn>;
const mockBumpSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockCensor = applyCensorFilter as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
	mockCensor.mockImplementation(async (content: string) => ({ banned: false, content }));
});

// ─── Mock-DB row builders ────────────────────────────────────────

function dbRows(
	overrides: {
		authorId?: number;
		closed?: number;
		subject?: string;
		userRole?: number;
		userStatus?: number;
		username?: string;
		moderators?: string;
		threadMissing?: boolean;
	} = {},
) {
	const authorId = overrides.authorId ?? 10;
	const userRole = overrides.userRole ?? 0;
	const userStatus = overrides.userStatus ?? 0;
	const username = overrides.username ?? "alice";
	const moderators = overrides.moderators ?? "";
	const closed = overrides.closed ?? 0;
	const subject = overrides.subject ?? "Original title";

	const firstResults: Record<string, unknown> = {
		// requireVerifiedEmail middleware lookup
		"SELECT role, status, email_verified_at": {
			role: userRole,
			status: userStatus,
			email_verified_at: 1700000000,
		},
		// permissionHelpers.getUserForPermission
		"SELECT id, username, role, status FROM users": {
			id: 10,
			username,
			role: userRole,
			status: userStatus,
		},
		// permissionHelpers.getForumForPermission
		"FROM forums WHERE id": { id: 1, moderators, moderator_ids: "" },
	};
	if (!overrides.threadMissing) {
		firstResults["SELECT id, forum_id, author_id, closed, subject FROM threads"] = {
			id: 5,
			forum_id: 1,
			author_id: authorId,
			closed,
			subject,
		};
	} else {
		firstResults["SELECT id, forum_id, author_id, closed, subject FROM threads"] = null;
	}
	return firstResults;
}

function makeReq(body: unknown, token: string, idPath = "5"): Request {
	return new Request(`https://api.example.com/api/v1/threads/${idPath}`, {
		method: "PATCH",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

// ─── Auth ─────────────────────────────────────────────────────────

describe("editThreadSubject — auth", () => {
	it("401 when Authorization header missing", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/v1/threads/5", {
			method: "PATCH",
			body: JSON.stringify({ subject: "x" }),
		});
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(401);
	});
});

// ─── Body validation ──────────────────────────────────────────────

describe("editThreadSubject — body validation", () => {
	it("400 on invalid JSON body", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows() });
		const env = makeEnv({ DB: db });
		const req = makeReq("not json{{{", token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(400);
	});

	it("400 when subject is not a string", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows() });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: 123 }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(400);
	});

	it("400 when subject is empty after trim", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows() });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "   " }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(400);
	});

	it("400 when subject exceeds 200 chars", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows() });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "a".repeat(201) }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(400);
	});

	it("400 when unexpected fields are passed alongside subject", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows() });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "ok", sticky: 2 }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error?: { details?: { message?: string } } };
		expect(json.error?.details?.message ?? "").toContain("sticky");
	});

	it("400 on invalid thread ID path segment", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows() });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "ok" }, token, "abc");
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(400);
	});
});

// ─── 404 / 403 ────────────────────────────────────────────────────

describe("editThreadSubject — not found / forbidden", () => {
	it("404 when thread does not exist", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows({ threadMissing: true }) });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "ok" }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(404);
	});

	it("403 when active user is neither author nor moderator", async () => {
		// authUser.id = 10, but thread.author_id = 99 and forum.moderators = ""
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows({ authorId: 99 }) });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "new title" }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(403);
		expect(mockBumpMeta).not.toHaveBeenCalled();
	});

	it("403 when author tries to edit a CLOSED thread", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({
			firstResults: dbRows({ authorId: 10, closed: 1, username: "alice" }),
		});
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "new title" }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(403);
		expect(mockBumpMeta).not.toHaveBeenCalled();
	});
});

// ─── Censor ───────────────────────────────────────────────────────

describe("editThreadSubject — censor", () => {
	it("403 CONTENT_BANNED when censor reports banned", async () => {
		mockCensor.mockResolvedValueOnce({ banned: true, content: "blocked" });
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({ firstResults: dbRows({ authorId: 10 }) });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "spam" }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(403);
		const json = (await res.json()) as { error?: { code?: string } };
		expect(json.error?.code).toBe("CONTENT_BANNED");
		expect(mockBumpMeta).not.toHaveBeenCalled();
	});

	it("uses filtered subject from censor on replace action", async () => {
		// Censor mutates the value — we expect the UPDATE statement to receive
		// the FILTERED string, not the raw one.
		mockCensor.mockResolvedValueOnce({ banned: false, content: "Hello ****" });
		const token = await createJwtForRole(0, 10);
		const { db, calls } = createMockDb({ firstResults: dbRows({ authorId: 10 }) });
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "Hello badword" }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(200);
		const update = calls.find((c) => c.sql.startsWith("UPDATE threads SET subject"));
		expect(update?.params[0]).toBe("Hello ****");
		// Even with censor replacement, no admin_logs row is written.
		expect(calls.find((c) => /admin_logs/i.test(c.sql))).toBeUndefined();
	});
});

// ─── Happy paths + cache fan-out ──────────────────────────────────

describe("editThreadSubject — happy path", () => {
	it("active author on open thread updates subject and bumps three gens", async () => {
		const token = await createJwtForRole(0, 10);
		const { db, calls } = createMockDb({
			firstResults: dbRows({ authorId: 10, subject: "Old" }),
		});
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "New title" }, token);
		const res = await editThreadSubject(req, env);

		expect(res.status).toBe(200);
		const json = (await res.json()) as { data: { id: number; updated: boolean } };
		expect(json.data).toEqual({ id: 5, updated: true });

		// UPDATE called once with the new subject
		const update = calls.find((c) => c.sql.startsWith("UPDATE threads SET subject"));
		expect(update).toBeDefined();
		expect(update?.params).toEqual(["New title", 5]);

		// Three cache bumps, each exactly once
		expect(mockBumpMeta).toHaveBeenCalledTimes(1);
		expect(mockBumpMeta).toHaveBeenCalledWith(env, 5);
		expect(mockBumpList).toHaveBeenCalledTimes(1);
		expect(mockBumpList).toHaveBeenCalledWith(env, 1);
		expect(mockBumpSummary).toHaveBeenCalledTimes(1);

		// NO admin_logs write — this endpoint is user-facing, not admin
		// console. Freeze msg=a8ee78db, Directive 6 ("NO admin_logs").
		// Scanning every SQL keeps the assertion robust to refactors.
		const adminLogCall = calls.find((c) => /admin_logs/i.test(c.sql));
		expect(adminLogCall).toBeUndefined();
	});

	it("moderator can edit a CLOSED thread (closed gate does not apply to mods)", async () => {
		const token = await createJwtForRole(3, 10); // Mod role
		const { db } = createMockDb({
			firstResults: dbRows({
				authorId: 99, // not the requester
				closed: 1, // closed thread
				username: "alice", // the requester's username
				moderators: "alice", // requester is mod-in-forum
				userRole: 3,
			}),
		});
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "Moderator override" }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(200);
		expect(mockBumpMeta).toHaveBeenCalledWith(env, 5);
	});

	it("no-op when new subject equals existing subject after trim — no DB update, no bumps", async () => {
		const token = await createJwtForRole(0, 10);
		const { db, calls } = createMockDb({
			firstResults: dbRows({ authorId: 10, subject: "Same" }),
		});
		const env = makeEnv({ DB: db });
		const req = makeReq({ subject: "  Same  " }, token);
		const res = await editThreadSubject(req, env);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { data: { id: number; updated: boolean } };
		expect(json.data).toEqual({ id: 5, updated: false });

		expect(calls.find((c) => c.sql.startsWith("UPDATE threads SET subject"))).toBeUndefined();
		expect(mockBumpMeta).not.toHaveBeenCalled();
		expect(mockBumpList).not.toHaveBeenCalled();
		expect(mockBumpSummary).not.toHaveBeenCalled();
	});
});
