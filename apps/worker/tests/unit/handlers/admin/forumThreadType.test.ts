// F (Phase 2) — admin CRUD for `forum_thread_types` + 4-switch config.
//
// Reviewer pins covered:
//   • required ⇒ enabled invariant rejects bad combos at admin layer.
//   • enabled-set / display_order / name changes bump the per-forum
//     thread-list gen so the public picker / typeId-filter cache stays
//     consistent (msg 2935495a).
//   • Switch updates bump forum:tree:gen + forum:summary:gen (the
//     latter rolls forum:meta:v2 because meta keys embed
//     `forum:summary:gen`; see invalidate.ts:bumpForumSummaryGen).
//   • Delete with referencing threads soft-disables (enabled=0) and
//     fires the same invalidation as a hard delete.
//   • sourceTypeid surfaced on admin payloads only.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/lib/cache/invalidate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../../src/lib/cache/invalidate")>();
	return {
		...actual,
		bumpForumTreeGen: vi.fn(async () => "g"),
		bumpForumSummaryGen: vi.fn(async () => "g"),
		bumpThreadListGen: vi.fn(async () => "g"),
	};
});

import {
	create,
	list,
	remove,
	reorder,
	update,
	updateConfig,
} from "../../../../src/handlers/admin/forumThreadType";
import {
	bumpForumSummaryGen,
	bumpForumTreeGen,
	bumpThreadListGen,
} from "../../../../src/lib/cache/invalidate";
import { createMockDb, makeEnv } from "../../../helpers";

const mockTree = bumpForumTreeGen as ReturnType<typeof vi.fn>;
const mockSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockList = bumpThreadListGen as ReturnType<typeof vi.fn>;

interface ForumGateOverrides {
	id?: number;
	enabled?: number;
	required?: number;
	listable?: number;
	prefix?: number;
}

function forumGateRow(o: ForumGateOverrides = {}): Record<string, unknown> {
	return {
		id: o.id ?? 1,
		thread_types_enabled: o.enabled ?? 1,
		thread_types_required: o.required ?? 0,
		thread_types_listable: o.listable ?? 0,
		thread_types_prefix: o.prefix ?? 0,
	};
}

function typeRow(o: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		id: 100,
		forum_id: 1,
		source_typeid: 0,
		name: "Question",
		display_order: 0,
		icon: "",
		enabled: 1,
		moderator_only: 0,
		...o,
	};
}

const adminEnv = (db: D1Database) => makeEnv({ DB: db });

beforeEach(() => {
	vi.clearAllMocks();
});

// ─── list ─────────────────────────────────────────────────────────

describe("admin/forumThreadType.list", () => {
	it("returns 404 when forum doesn't exist", async () => {
		const { db } = createMockDb({ firstResults: {} });
		const res = await list(
			new Request("https://api.example.com/api/admin/forums/9/thread-types"),
			adminEnv(db),
		);
		expect(res.status).toBe(404);
	});

	it("returns config + admin DTOs including sourceTypeid + tombstones", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forums WHERE id": forumGateRow({
					enabled: 1,
					required: 1,
					listable: 1,
					prefix: 0,
				}),
			},
			allResults: {
				"FROM forum_thread_types": [
					typeRow({ id: 11, source_typeid: 7, name: "Q", display_order: 1 }),
					typeRow({ id: 12, source_typeid: 0, name: "old", enabled: 0 }),
				],
			},
		});
		const res = await list(
			new Request("https://api.example.com/api/admin/forums/1/thread-types"),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		const body = await res.json<{
			data: {
				forumId: number;
				config: { enabled: boolean; required: boolean };
				types: Array<{ id: number; sourceTypeid: number; enabled: boolean }>;
			};
		}>();
		expect(body.data.forumId).toBe(1);
		expect(body.data.config.enabled).toBe(true);
		expect(body.data.config.required).toBe(true);
		// Admin list keeps tombstones AND sourceTypeid.
		expect(body.data.types).toHaveLength(2);
		expect(body.data.types[0]).toMatchObject({ id: 11, sourceTypeid: 7, enabled: true });
		expect(body.data.types[1]).toMatchObject({ id: 12, sourceTypeid: 0, enabled: false });
	});
});

// ─── create ───────────────────────────────────────────────────────

describe("admin/forumThreadType.create", () => {
	it("rejects empty name", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("404 when forum doesn't exist", async () => {
		const { db } = createMockDb({ firstResults: {} });
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/9/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Q" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(404);
	});

	it("409 on duplicate sourceTypeid in same forum", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forums WHERE id": forumGateRow(),
				"WHERE forum_id = ? AND source_typeid": { id: 50 },
			},
		});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X", sourceTypeid: 7 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(409);
	});

	it("inserts row and bumps tree+thread-list (enabled-set changed)", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM forums WHERE id": forumGateRow(),
				"forum_thread_types WHERE id = ?": typeRow({ id: 100, name: "X" }),
			},
			runResults: {
				"INSERT INTO forum_thread_types": {
					success: true,
					meta: { last_row_id: 100, changes: 1 },
				},
			},
		});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X", displayOrder: 2, moderatorOnly: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(201);
		const body = await res.json<{ data: { id: number; name: string } }>();
		expect(body.data.id).toBe(100);

		// Pin the INSERT shape — admin-created rows have sourceTypeid=0
		// and enabled=1 by default.
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO forum_thread_types"));
		expect(insertCall).toBeDefined();
		expect(insertCall?.params).toEqual([1, 0, "X", 2, "", 1]);

		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});
});

// ─── update ───────────────────────────────────────────────────────

describe("admin/forumThreadType.update", () => {
	it("404 when row missing", async () => {
		const { db } = createMockDb({ firstResults: {} });
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/99", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "x" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(404);
	});

	it("name change → bump tree + thread-list", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11, name: "old" }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "new" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});

	it("icon-only change → bump tree only (no thread-list)", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11, icon: "" }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ icon: "https://example.com/i.png" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).not.toHaveBeenCalled();
	});

	it("toggling enabled bumps tree + thread-list (enabled-set change)", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11, enabled: 1 }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: false }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});

	it("no-op (same name) does not bump anything", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11, name: "x" }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "x" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockTree).not.toHaveBeenCalled();
		expect(mockList).not.toHaveBeenCalled();
	});
});

// ─── remove ───────────────────────────────────────────────────────

describe("admin/forumThreadType.remove", () => {
	it("404 when row missing", async () => {
		const { db } = createMockDb({ firstResults: {} });
		const res = await remove(
			new Request("https://api.example.com/api/admin/forum-thread-types/99", {
				method: "DELETE",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(404);
	});

	it("hard-deletes when no threads reference it; bumps tree + thread-list", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({ id: 11 }),
				"COUNT(*) as cnt FROM threads": { cnt: 0 },
			},
		});
		const res = await remove(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "DELETE",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		const body = await res.json<{ data: { deleted: boolean; softDisabled: boolean } }>();
		expect(body.data).toMatchObject({ deleted: true, softDisabled: false });
		expect(calls.find((c) => c.sql.includes("DELETE FROM forum_thread_types"))).toBeDefined();
		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});

	it("soft-disables when threads reference it; same invalidation as hard delete", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({ id: 11, enabled: 1 }),
				"COUNT(*) as cnt FROM threads": { cnt: 42 },
			},
		});
		const res = await remove(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "DELETE",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		const body = await res.json<{
			data: { deleted: boolean; softDisabled: boolean; threadCount: number };
		}>();
		expect(body.data).toMatchObject({ deleted: false, softDisabled: true, threadCount: 42 });
		// Soft-disable issues an UPDATE, NOT a DELETE.
		const upd = calls.find((c) => c.sql.includes("UPDATE forum_thread_types SET enabled = 0"));
		expect(upd).toBeDefined();
		expect(calls.find((c) => c.sql.includes("DELETE FROM forum_thread_types"))).toBeUndefined();
		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});

	it("already-disabled row with refs → no UPDATE, no invalidation", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({ id: 11, enabled: 0 }),
				"COUNT(*) as cnt FROM threads": { cnt: 5 },
			},
		});
		const res = await remove(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "DELETE",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(
			calls.find((c) => c.sql.includes("UPDATE forum_thread_types SET enabled = 0")),
		).toBeUndefined();
		expect(mockTree).not.toHaveBeenCalled();
		expect(mockList).not.toHaveBeenCalled();
	});
});

// ─── reorder ──────────────────────────────────────────────────────

describe("admin/forumThreadType.reorder", () => {
	it("400 on empty array", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ orders: [] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects rows belonging to a different forum (no silent move)", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE id IN": [
					{ id: 11, forum_id: 1 },
					{ id: 22, forum_id: 99 },
				],
			},
		});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					orders: [
						{ id: 11, displayOrder: 0 },
						{ id: 22, displayOrder: 1 },
					],
				}),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		expect(mockTree).not.toHaveBeenCalled();
		expect(mockList).not.toHaveBeenCalled();
	});

	it("happy path: bumps tree + thread-list", async () => {
		const { db, batchCalls } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE id IN": [
					{ id: 11, forum_id: 1 },
					{ id: 22, forum_id: 1 },
				],
			},
		});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					orders: [
						{ id: 11, displayOrder: 0 },
						{ id: 22, displayOrder: 1 },
					],
				}),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(batchCalls).toHaveLength(1);
		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});
});

// ─── updateConfig (4-switch) ──────────────────────────────────────

describe("admin/forumThreadType.updateConfig", () => {
	it("404 when forum missing", async () => {
		const { db } = createMockDb({ firstResults: {} });
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/9/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(404);
	});

	it("rejects unknown fields", async () => {
		const { db } = createMockDb({});
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: true, bogus: 1 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects required=1 when merged enabled would be 0", async () => {
		// existing: enabled=0 — incoming sends required=1 only.
		const { db } = createMockDb({
			firstResults: { "FROM forums WHERE id": forumGateRow({ enabled: 0, required: 0 }) },
		});
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ required: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("THREAD_TYPE_REQUIRED_NEEDS_ENABLED");
	});

	it("rejects flipping enabled=0 while existing required=1", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forums WHERE id": forumGateRow({ enabled: 1, required: 1 }) },
		});
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: false }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("happy path: bumps tree + summary + thread-list", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "FROM forums WHERE id": forumGateRow({ enabled: 0, required: 0 }) },
		});
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: true, listable: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);

		const upd = calls.find((c) => c.sql.includes("UPDATE forums SET"));
		expect(upd).toBeDefined();
		// Pin: the SET clause should mention BOTH switched columns.
		expect(upd?.sql).toMatch(/thread_types_enabled = \?/);
		expect(upd?.sql).toMatch(/thread_types_listable = \?/);

		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockSummary).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});

	it("no-op (same value) does not write or bump", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "FROM forums WHERE id": forumGateRow({ enabled: 1 }) },
		});
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(calls.find((c) => c.sql.includes("UPDATE forums SET"))).toBeUndefined();
		expect(mockTree).not.toHaveBeenCalled();
		expect(mockSummary).not.toHaveBeenCalled();
		expect(mockList).not.toHaveBeenCalled();
	});

	it("rejects non-boolean flag value", async () => {
		const { db } = createMockDb({});
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: 1 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { details?: { message?: string } } }>();
		expect(body.error.details?.message).toMatch(/enabled.*boolean/);
	});

	it("rejects invalid JSON body", async () => {
		const { db } = createMockDb({});
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: "{not-json",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 when forum id is invalid", async () => {
		const { db } = createMockDb({});
		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/abc/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});
});

// ─── Edge / branch coverage ──────────────────────────────────────

describe("admin/forumThreadType.create — extra validation branches", () => {
	it("rejects invalid JSON body", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{not-json",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 when forum id segment is non-numeric", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/abc/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects non-string name (number)", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: 42 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects oversized name (> MAX_NAME_LEN)", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "a".repeat(101) }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects negative displayOrder", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X", displayOrder: -1 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects non-string icon", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X", icon: 5 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects oversized icon (> MAX_ICON_LEN)", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X", icon: "a".repeat(201) }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects non-boolean moderatorOnly", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X", moderatorOnly: "yes" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects negative sourceTypeid", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X", sourceTypeid: -1 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("500 when INSERT meta.last_row_id is missing", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forums WHERE id": forumGateRow() },
			runResults: {
				"INSERT INTO forum_thread_types": { success: true, meta: {} },
			},
		});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(500);
	});

	it("500 when re-read after INSERT returns null", async () => {
		// firstResults only stubs the forum gate; the loadTypeRow re-read
		// goes against an unstubbed key → returns null.
		const { db } = createMockDb({
			firstResults: { "FROM forums WHERE id": forumGateRow() },
			runResults: {
				"INSERT INTO forum_thread_types": {
					success: true,
					meta: { last_row_id: 100, changes: 1 },
				},
			},
		});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(500);
	});
});

describe("admin/forumThreadType.update — extra validation branches", () => {
	it("rejects invalid JSON body", async () => {
		const { db } = createMockDb({});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: "{nope",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 when id segment is non-numeric", async () => {
		const { db } = createMockDb({});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/abc", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "x" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects invalid displayOrder (negative)", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11 }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ displayOrder: -1 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects invalid icon (non-string)", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11 }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ icon: 5 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects invalid moderatorOnly (non-boolean)", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11 }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ moderatorOnly: "no" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects invalid enabled (non-boolean)", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11 }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: "yes" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("rejects invalid name (empty)", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11 }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("displayOrder change → bumps tree + thread-list", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({ id: 11, display_order: 0 }),
			},
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ displayOrder: 5 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});

	it("moderatorOnly toggle → bumps tree only", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({ id: 11, moderator_only: 0 }),
			},
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ moderatorOnly: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).not.toHaveBeenCalled();
	});

	it("empty body → no-op (no UPDATE, no bump)", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "FROM forum_thread_types WHERE id": typeRow({ id: 11 }) },
		});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(calls.find((c) => c.sql.includes("UPDATE forum_thread_types SET"))).toBeUndefined();
		expect(mockTree).not.toHaveBeenCalled();
	});
});

describe("admin/forumThreadType.list — invalid id branch", () => {
	it("400 when forum id segment is non-numeric", async () => {
		const { db } = createMockDb({});
		const res = await list(
			new Request("https://api.example.com/api/admin/forums/abc/thread-types"),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});
});

describe("admin/forumThreadType.remove — invalid id branch", () => {
	it("400 when id segment is non-numeric", async () => {
		const { db } = createMockDb({});
		const res = await remove(
			new Request("https://api.example.com/api/admin/forum-thread-types/abc", {
				method: "DELETE",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});
});

describe("admin/forumThreadType.reorder — extra branches", () => {
	it("rejects invalid JSON body", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: "{nope",
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 when forum id segment is non-numeric", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/abc/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ orders: [{ id: 1, displayOrder: 0 }] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 when over MAX_REORDER_ITEMS", async () => {
		const { db } = createMockDb({});
		const orders = Array.from({ length: 201 }, (_, i) => ({ id: i + 1, displayOrder: i }));
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ orders }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
	});

	it("400 when an item has invalid shape (non-int id)", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ orders: [{ id: "x", displayOrder: 0 }] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("404 when an id is missing from the DB", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE id IN": [{ id: 11, forum_id: 1 }],
			},
		});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					orders: [
						{ id: 11, displayOrder: 0 },
						{ id: 999, displayOrder: 1 },
					],
				}),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(404);
	});

	it("400 on non-array orders", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ orders: "nope" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});
});
