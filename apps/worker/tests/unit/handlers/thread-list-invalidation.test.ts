// Phase 3 commit C — explicit invalidation matrix coverage for moderation
// single-thread actions and admin-thread digest tracking. The pre-existing
// `forum-summary-invalidation.test.ts` covers DESTRUCTIVE writes; this file
// covers MUTATING writes that keep the row but change a list-affecting
// column (sticky / digest / closed / highlight) and admin update/delete
// digest bumps.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/cache/invalidate", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/cache/invalidate")>(
		"../../../src/lib/cache/invalidate",
	);
	const bumpForumSummaryGen = vi.fn(async () => "g1");
	const bumpThreadListGen = vi.fn(async () => "g1");
	const bumpThreadListGenAll = vi.fn(async () => "g1");
	const bumpDigestGen = vi.fn(async () => "g1");
	return {
		...actual,
		bumpForumSummaryGen,
		bumpThreadListGen,
		bumpThreadListGenAll,
		bumpDigestGen,
		invalidateForumSummaryV2: vi.fn(async () => {
			await bumpForumSummaryGen();
		}),
		invalidateForumVolatileV2: vi.fn(async (_e: unknown, fid: number) => {
			await Promise.all([bumpForumSummaryGen(), bumpThreadListGen(_e, fid)]);
		}),
		invalidateThreadListForForums: vi.fn(async (_e: unknown, fids: readonly number[]) => {
			const unique = Array.from(new Set(fids));
			await Promise.all(unique.map((id) => bumpThreadListGen(_e, id)));
		}),
		invalidateUserCaches: vi.fn(async () => {}),
	};
});

import { recalcThreads as adminRecalcThreads } from "../../../src/handlers/admin/statistics";
import { update as adminThreadUpdate } from "../../../src/handlers/admin/thread";
import { setClose, setDigest, setHighlight, setSticky } from "../../../src/handlers/moderation";
import {
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpThreadListGen,
	bumpThreadListGenAll,
} from "../../../src/lib/cache/invalidate";
import { createAdminRequest, createJwtForRole, createMockDb, makeEnv } from "../../helpers";

const mockSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockThreadList = bumpThreadListGen as ReturnType<typeof vi.fn>;
const mockThreadListAll = bumpThreadListGenAll as ReturnType<typeof vi.fn>;
const mockDigest = bumpDigestGen as ReturnType<typeof vi.fn>;

async function modToken(role: number, userId = 1): Promise<string> {
	return createJwtForRole(role, userId);
}

function modAuthRow(role = 1) {
	return {
		"SELECT role, status, email_verified_at FROM users WHERE id": {
			role,
			status: 0,
			email_verified_at: 1700000000,
		},
		"SELECT id, username, role, status FROM users": {
			id: 1,
			username: "admin",
			role,
			status: 0,
		},
		"SELECT id, moderators, moderator_ids FROM forums": {
			id: 1,
			moderators: "",
			moderator_ids: "",
		},
		"SELECT id, forum_id, author_id FROM threads WHERE id": {
			id: 1,
			forum_id: 7,
			author_id: 99,
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("moderation single-thread mutations bump per-forum thread-list gen", () => {
	it("setSticky bumps thread:list:gen for the thread's forum (no summary, no digest)", async () => {
		const token = await modToken(1);
		const { db } = createMockDb({ firstResults: modAuthRow(1) });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/sticky", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ level: "global" }),
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 7);
		expect(mockSummary).not.toHaveBeenCalled();
		expect(mockDigest).not.toHaveBeenCalled();
	});

	it("setDigest bumps thread:list:gen AND digest:gen", async () => {
		const token = await modToken(1);
		const { db } = createMockDb({ firstResults: modAuthRow(1) });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/digest", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ level: 2 }),
		});
		const res = await setDigest(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 7);
		expect(mockDigest).toHaveBeenCalled();
	});

	it("setClose bumps thread:list:gen for the thread's forum", async () => {
		const token = await modToken(1);
		const { db } = createMockDb({ firstResults: modAuthRow(1) });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/close", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ closed: true }),
		});
		const res = await setClose(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 7);
	});

	it("setHighlight bumps thread:list:gen for the thread's forum", async () => {
		const token = await modToken(1);
		const { db } = createMockDb({ firstResults: modAuthRow(1) });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/highlight", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ color: "#ff0000", bold: true }),
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 7);
	});
});

describe("admin thread update digest tracking", () => {
	function adminAuthRow() {
		return {
			"SELECT role, status, email_verified_at FROM users WHERE id": {
				role: 1,
				status: 0,
				email_verified_at: 1700000000,
			},
			"SELECT id, username, role, status FROM users": {
				id: 1,
				username: "admin",
				role: 1,
				status: 0,
			},
		};
	}

	it("update with digest field change bumps per-forum thread-list AND digest:gen", async () => {
		const { db } = createMockDb({
			firstResults: {
				...adminAuthRow(),
				"SELECT * FROM threads WHERE id": {
					id: 11,
					forum_id: 5,
					replies: 0,
					sticky: 0,
					digest: 0,
					closed: 0,
					highlight: 0,
					subject: "x",
				},
				"SELECT id FROM threads WHERE id": { id: 11 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("PATCH", "/api/admin/threads/11", { digest: 2 });
		const res = await adminThreadUpdate(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 5);
		expect(mockDigest).toHaveBeenCalled();
	});

	it("update with subject-only change bumps per-forum thread-list AND summary, NOT digest", async () => {
		const { db } = createMockDb({
			firstResults: {
				...adminAuthRow(),
				"SELECT * FROM threads WHERE id": {
					id: 11,
					forum_id: 5,
					replies: 0,
					sticky: 0,
					digest: 0,
					closed: 0,
					highlight: 0,
					subject: "x",
				},
				"SELECT id FROM threads WHERE id": { id: 11 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("PATCH", "/api/admin/threads/11", { subject: "new" });
		const res = await adminThreadUpdate(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 5);
		// Subject is part of `forum:summary:v2.lastThreadSubject`, so a
		// subject-only update MUST also bump forum:summary:gen.
		expect(mockSummary).toHaveBeenCalled();
		expect(mockDigest).not.toHaveBeenCalled();
	});

	it("update with sticky-only change bumps per-forum thread-list, NOT summary, NOT digest", async () => {
		const { db } = createMockDb({
			firstResults: {
				...adminAuthRow(),
				"SELECT * FROM threads WHERE id": {
					id: 11,
					forum_id: 5,
					replies: 0,
					sticky: 0,
					digest: 0,
					closed: 0,
					highlight: 0,
					subject: "x",
				},
				"SELECT id FROM threads WHERE id": { id: 11 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("PATCH", "/api/admin/threads/11", { sticky: 1 });
		const res = await adminThreadUpdate(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 5);
		// sticky/closed/digest/highlight do NOT touch lastThreadSubject,
		// so we don't pay the summary bump there — only subject does.
		expect(mockSummary).not.toHaveBeenCalled();
		expect(mockDigest).not.toHaveBeenCalled();
	});
});

describe("admin statistics recalc-threads gen invalidation", () => {
	function adminAuthRow() {
		return {
			"SELECT role, status, email_verified_at FROM users WHERE id": {
				role: 1,
				status: 0,
				email_verified_at: 1700000000,
			},
			"SELECT id, username, role, status FROM users": {
				id: 1,
				username: "admin",
				role: 1,
				status: 0,
			},
		};
	}

	it("recalc-threads with no forumId scope bumps thread:list:gen:all (global)", async () => {
		const { db } = createMockDb({
			firstResults: adminAuthRow(),
			allResults: {
				"SELECT id, created_at, author_name, author_id FROM threads": [
					{ id: 1, created_at: 1, author_name: "a", author_id: 1 },
				],
				"SELECT thread_id, COUNT(*) - 1 as cnt FROM posts": [],
				"SELECT p1.thread_id, p1.created_at": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/statistics/recalc-threads", {});
		const res = await adminRecalcThreads(req, env);
		expect(res.status).toBe(200);
		expect(mockSummary).toHaveBeenCalled();
		expect(mockThreadListAll).toHaveBeenCalled();
		expect(mockThreadList).not.toHaveBeenCalled();
	});

	it("recalc-threads scoped to forumId bumps per-forum gen, NOT global", async () => {
		const { db } = createMockDb({
			firstResults: adminAuthRow(),
			allResults: {
				"SELECT id, created_at, author_name, author_id FROM threads WHERE forum_id": [
					{ id: 1, created_at: 1, author_name: "a", author_id: 1 },
				],
				"SELECT thread_id, COUNT(*) - 1 as cnt FROM posts": [],
				"SELECT p1.thread_id, p1.created_at": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/statistics/recalc-threads", {
			forumId: 42,
		});
		const res = await adminRecalcThreads(req, env);
		expect(res.status).toBe(200);
		expect(mockSummary).toHaveBeenCalled();
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 42);
		expect(mockThreadListAll).not.toHaveBeenCalled();
	});
});
