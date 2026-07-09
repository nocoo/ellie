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

vi.mock("../../../../src/lib/adminLog", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../../src/lib/adminLog")>();
	return {
		...actual,
		writeAdminLog: vi.fn(async () => {}),
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
import { writeAdminLog } from "../../../../src/lib/adminLog";
import {
	bumpForumSummaryGen,
	bumpForumTreeGen,
	bumpThreadListGen,
} from "../../../../src/lib/cache/invalidate";
import { createMockDb, makeEnv } from "../../../helpers";

const mockTree = bumpForumTreeGen as ReturnType<typeof vi.fn>;
const mockSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockList = bumpThreadListGen as ReturnType<typeof vi.fn>;
const mockAudit = writeAdminLog as ReturnType<typeof vi.fn>;

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

	it("inserts row, rewrites source_typeid=newId, bumps tree+thread-list", async () => {
		// Reviewer pin (msg fefddfcc, P0): admin-created row with default
		// sourceTypeid=0 must do INSERT (placeholder 0) + UPDATE
		// source_typeid=newId so the (forum_id, source_typeid) UNIQUE
		// INDEX from migration 0039 doesn't blow up on the second create.
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM forums WHERE id": forumGateRow(),
				"forum_thread_types WHERE id = ?": typeRow({ id: 100, source_typeid: 100, name: "X" }),
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
		const body = await res.json<{ data: { id: number; sourceTypeid: number; name: string } }>();
		expect(body.data.id).toBe(100);
		// Returned DTO must carry sourceTypeid=newId (not the transient 0).
		expect(body.data.sourceTypeid).toBe(100);

		// Pin: INSERT writes placeholder source_typeid=0; admin-created
		// rows still default to enabled=1.
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO forum_thread_types"));
		expect(insertCall).toBeDefined();
		expect(insertCall?.params).toEqual([1, 0, "X", 2, "", 1]);

		// Pin: the placeholder is rewritten to the synthetic id immediately
		// after, with bind order (newId, newId).
		const updateCall = calls.find((c) =>
			c.sql.includes("UPDATE forum_thread_types SET source_typeid"),
		);
		expect(updateCall).toBeDefined();
		expect(updateCall?.params).toEqual([100, 100]);

		expect(mockTree).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith(expect.anything(), 1);
	});

	it("create with explicit non-zero sourceTypeid → no placeholder rewrite", async () => {
		// When admin explicitly carries a Discuz-side sourceTypeid (e.g.
		// during a manual backfill), INSERT keeps that value and we must
		// NOT issue the placeholder UPDATE — the natural key is already
		// pinned to the supplied number.
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM forums WHERE id": forumGateRow(),
				"WHERE forum_id = ? AND source_typeid": null, // no dup
				"forum_thread_types WHERE id = ?": typeRow({
					id: 100,
					source_typeid: 7,
					name: "X",
				}),
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
				body: JSON.stringify({ name: "X", sourceTypeid: 7 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(201);
		// Pin: INSERT carried the supplied 7; no source_typeid UPDATE.
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO forum_thread_types"));
		expect(insertCall?.params).toEqual([1, 7, "X", 0, "", 0]);
		expect(
			calls.find((c) => c.sql.includes("UPDATE forum_thread_types SET source_typeid")),
		).toBeUndefined();
	});

	it("two consecutive default creates in same forum each get unique source_typeid", async () => {
		// Behavioral pin: the second admin-default-create in the same
		// forum cannot collide on the (forum_id, source_typeid) UNIQUE
		// INDEX. We can't run a real D1 from here, but we can pin that
		// the rewrite UPDATE fires for BOTH calls with bind order
		// (newId, newId) — which is what makes the natural key safe.
		const insertedIds = [101, 102];
		let n = 0;
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM forums WHERE id": forumGateRow(),
				"forum_thread_types WHERE id = ?": typeRow({ id: 999, source_typeid: 999 }),
			},
			runResults: {
				"INSERT INTO forum_thread_types": {
					success: true,
					meta: { last_row_id: 0, changes: 1 },
				},
			},
		});
		// Override INSERT's run() to advance last_row_id per call.
		const origPrepare = db.prepare;
		(db as unknown as { prepare: typeof origPrepare }).prepare = ((sql: string) => {
			const stmt = origPrepare.call(db, sql) as ReturnType<typeof origPrepare>;
			if (sql.includes("INSERT INTO forum_thread_types")) {
				const origBind = stmt.bind.bind(stmt);
				stmt.bind = ((...args: unknown[]) => {
					const ret = origBind(...args);
					const id = insertedIds[n++] ?? 0;
					ret.run = vi.fn(async () => ({ success: true, meta: { last_row_id: id } }));
					return ret;
				}) as typeof stmt.bind;
			}
			return stmt;
		}) as typeof origPrepare;

		await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "A" }),
			}),
			adminEnv(db),
		);
		await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "B" }),
			}),
			adminEnv(db),
		);

		const updates = calls.filter((c) =>
			c.sql.includes("UPDATE forum_thread_types SET source_typeid"),
		);
		expect(updates).toHaveLength(2);
		expect(updates[0]?.params).toEqual([101, 101]);
		expect(updates[1]?.params).toEqual([102, 102]);
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

describe("admin/forumThreadType.reorder (full-set semantics)", () => {
	// Reviewer pin (msg fefddfcc, P1 + earlier 4b64ac64): the payload
	// is the COMPLETE ordered set of ids for this forum. Partial /
	// extra / duplicate / cross-forum lists are all rejected; happy
	// path rewrites display_order = i for the i-th id.

	it("400 on empty array", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 when payload is partial (missing one of the canonical ids)", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE forum_id": [{ id: 11 }, { id: 22 }, { id: 33 }],
			},
		});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [22, 11] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { details?: { message?: string } } }>();
		expect(body.error.details?.message).toMatch(/got 2.*expected 3/);
		expect(mockTree).not.toHaveBeenCalled();
	});

	it("400 when payload contains an extra id (more than canonical)", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE forum_id": [{ id: 11 }, { id: 22 }],
			},
		});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [11, 22, 33] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		expect(mockTree).not.toHaveBeenCalled();
	});

	it("400 on duplicate ids", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [11, 22, 11] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { details?: { message?: string } } }>();
		expect(body.error.details?.message).toMatch(/Duplicate id/);
	});

	it("rejects an id from another forum (no silent move)", async () => {
		// Canonical set for forum 1 is { 11, 22 }. A request that swaps
		// in id 99 (which doesn't belong to this forum) must 400.
		const { db } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE forum_id": [{ id: 11 }, { id: 22 }],
			},
		});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [11, 99] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("THREAD_TYPE_FORUM_MISMATCH");
		expect(mockTree).not.toHaveBeenCalled();
	});

	it("happy path: writes display_order = array index for each id; bumps tree + thread-list", async () => {
		const { db, calls, batchCalls } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE forum_id": [{ id: 11 }, { id: 22 }, { id: 33 }],
			},
		});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [22, 33, 11] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(batchCalls).toHaveLength(1);

		// Pin: each UPDATE binds (idx, id) — so the array order becomes
		// the dense display_order 0..N-1.
		const updateCalls = calls.filter((c) =>
			c.sql.includes("UPDATE forum_thread_types SET display_order"),
		);
		expect(updateCalls).toHaveLength(3);
		expect(updateCalls[0]?.params).toEqual([0, 22]);
		expect(updateCalls[1]?.params).toEqual([1, 33]);
		expect(updateCalls[2]?.params).toEqual([2, 11]);

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
				body: JSON.stringify({ ids: [1] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 when over MAX_REORDER_ITEMS", async () => {
		const { db } = createMockDb({});
		const ids = Array.from({ length: 201 }, (_, i) => i + 1);
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
	});

	it("400 when an id is not a positive integer (string)", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: ["x"] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 when id is 0 (must be positive)", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [0] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});

	it("400 on non-array ids", async () => {
		const { db } = createMockDb({});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: "nope" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});
});

describe("admin/forumThreadType — unknown field rejection (P2)", () => {
	it("create rejects unknown fields", async () => {
		const { db } = createMockDb({});
		const res = await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "X", bogus: 1 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { details?: { message?: string } } }>();
		expect(body.error.details?.message).toMatch(/Unknown field/);
	});

	it("update rejects sourceTypeid (structural identity, never editable)", async () => {
		const { db } = createMockDb({});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sourceTypeid: 99 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { details?: { message?: string } } }>();
		expect(body.error.details?.message).toMatch(/Unknown field: sourceTypeid/);
	});

	it("update rejects unknown fields generally", async () => {
		const { db } = createMockDb({});
		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ bogus: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(400);
	});
});

// ─── G: admin_logs audit ───────────────────────────────────────────
//
// Pins (msg 1f794df4): each write path emits an admin_logs entry via
// writeAdminLog AFTER the mutation commits. Payload must carry forumId
// + (when row-scoped) threadTypeId + sourceTypeid + the action's key
// summary (changedFields/before/after/mode/mutated/changedFlags).
// Validation failures must NOT audit (writeAdminLog is post-mutation).

describe("admin/forumThreadType — G audit", () => {
	it("create: emits thread_type.create with forumId/threadTypeId/sourceTypeid/name", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forums WHERE id": forumGateRow(),
				"forum_thread_types WHERE id = ?": typeRow({
					id: 100,
					source_typeid: 100,
					name: "X",
					display_order: 2,
					moderator_only: 0,
					icon: "",
				}),
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
				body: JSON.stringify({ name: "X", displayOrder: 2 }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(201);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		const call = mockAudit.mock.calls[0]?.[2];
		expect(call).toMatchObject({
			action: "thread_type.create",
			targetType: "forum_thread_type",
			targetId: 100,
			details: expect.objectContaining({
				forumId: 1,
				threadTypeId: 100,
				sourceTypeid: 100,
				name: "X",
				displayOrder: 2,
				moderatorOnly: false,
				iconLength: 0,
			}),
		});
	});

	it("create: validation failure (empty name) does NOT audit", async () => {
		const { db } = createMockDb({});
		await create(
			new Request("https://api.example.com/api/admin/forums/1/thread-types", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "" }),
			}),
			adminEnv(db),
		);
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("update: emits thread_type.update with changedFields/before/after diff", async () => {
		// Pre-row name="old", post-row name="new" + display_order changed
		// (handled via the "WHERE id = ?" SELECT being shared between
		// loadTypeRow pre and re-read post — both return the same stub,
		// so we instead simulate a name-only diff via a fresh mock).
		let nthRead = 0;
		const { db } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({
					id: 11,
					forum_id: 1,
					source_typeid: 7,
					name: "old",
					display_order: 0,
					icon: "",
					moderator_only: 0,
					enabled: 1,
				}),
			},
		});
		// Override loadTypeRow re-read so 2nd call returns the post-update row.
		const origPrepare = db.prepare;
		(db as unknown as { prepare: typeof origPrepare }).prepare = ((sql: string) => {
			const stmt = origPrepare.call(db, sql) as ReturnType<typeof origPrepare>;
			if (sql.includes("FROM forum_thread_types WHERE id")) {
				const origBind = stmt.bind.bind(stmt);
				stmt.bind = ((...args: unknown[]) => {
					const ret = origBind(...args);
					ret.first = vi.fn(async () => {
						nthRead++;
						return nthRead === 1
							? typeRow({
									id: 11,
									forum_id: 1,
									source_typeid: 7,
									name: "old",
									display_order: 0,
									icon: "",
									moderator_only: 0,
									enabled: 1,
								})
							: typeRow({
									id: 11,
									forum_id: 1,
									source_typeid: 7,
									name: "new",
									display_order: 0,
									icon: "",
									moderator_only: 0,
									enabled: 1,
								});
					});
					return ret;
				}) as typeof stmt.bind;
			}
			return stmt;
		}) as typeof origPrepare;

		const res = await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/11", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "new" }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		const call = mockAudit.mock.calls[0]?.[2];
		expect(call).toMatchObject({
			action: "thread_type.update",
			targetType: "forum_thread_type",
			targetId: 11,
			details: expect.objectContaining({
				forumId: 1,
				threadTypeId: 11,
				sourceTypeid: 7,
				changedFields: ["name"],
				before: { name: "old" },
				after: { name: "new" },
			}),
		});
	});

	it("update: pure no-op (no actual UPDATE) does NOT audit (matches PATCH-elsewhere early return)", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({
					id: 11,
					forum_id: 1,
					source_typeid: 0,
					name: "x",
				}),
			},
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
		// Pin: when collectUpdateFields filters all fields out (incoming
		// values == existing), the handler returns early before audit.
		// updateConfig + soft-disable still audit no-ops because their
		// admin intent is more semantically meaningful.
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("update: 404 on missing row does NOT audit", async () => {
		const { db } = createMockDb({ firstResults: {} });
		await update(
			new Request("https://api.example.com/api/admin/forum-thread-types/99", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "x" }),
			}),
			adminEnv(db),
		);
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("delete (hard): emits thread_type.delete with mode=hard_delete + mutated=true", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({
					id: 11,
					forum_id: 1,
					source_typeid: 7,
					name: "Q",
				}),
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
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(mockAudit.mock.calls[0]?.[2]).toMatchObject({
			action: "thread_type.delete",
			targetType: "forum_thread_type",
			targetId: 11,
			details: expect.objectContaining({
				forumId: 1,
				threadTypeId: 11,
				sourceTypeid: 7,
				name: "Q",
				mode: "hard_delete",
				mutated: true,
				threadCount: 0,
			}),
		});
	});

	it("delete (soft-disable): emits mode=soft_disable + mutated=true + threadCount", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({
					id: 11,
					forum_id: 1,
					source_typeid: 7,
					name: "Q",
					enabled: 1,
				}),
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
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(mockAudit.mock.calls[0]?.[2]).toMatchObject({
			action: "thread_type.delete",
			targetType: "forum_thread_type",
			targetId: 11,
			details: expect.objectContaining({
				forumId: 1,
				threadTypeId: 11,
				sourceTypeid: 7,
				mode: "soft_disable",
				mutated: true,
				threadCount: 42,
			}),
		});
	});

	it("delete (already-disabled with refs): audits with mutated=false", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM forum_thread_types WHERE id": typeRow({
					id: 11,
					forum_id: 1,
					source_typeid: 7,
					enabled: 0,
				}),
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
		expect(mockAudit).toHaveBeenCalledTimes(1);
		const details = mockAudit.mock.calls[0]?.[2]?.details as {
			mutated: boolean;
			mode: string;
		};
		expect(details.mode).toBe("soft_disable");
		expect(details.mutated).toBe(false);
	});

	it("reorder: emits thread_type.reorder with target=forum + orderedIds", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE forum_id": [{ id: 11 }, { id: 22 }, { id: 33 }],
			},
		});
		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [22, 33, 11] }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(mockAudit.mock.calls[0]?.[2]).toMatchObject({
			action: "thread_type.reorder",
			targetType: "forum",
			targetId: 1,
			details: expect.objectContaining({
				forumId: 1,
				count: 3,
				orderedIds: [22, 33, 11],
			}),
		});
	});

	it("reorder: validation failure (foreign id) does NOT audit", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM forum_thread_types WHERE forum_id": [{ id: 11 }, { id: 22 }],
			},
		});
		await reorder(
			new Request("https://api.example.com/api/admin/forums/1/thread-types/reorder", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [11, 99] }),
			}),
			adminEnv(db),
		);
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("updateConfig: real change emits thread_type.config with changedFlags + before/after", async () => {
		// Pre: enabled=0, listable=0. Post: enabled=1, listable=1.
		let nth = 0;
		const { db } = createMockDb({
			firstResults: { "FROM forums WHERE id": forumGateRow({ enabled: 0, required: 0 }) },
		});
		const origPrepare = db.prepare;
		(db as unknown as { prepare: typeof origPrepare }).prepare = ((sql: string) => {
			const stmt = origPrepare.call(db, sql) as ReturnType<typeof origPrepare>;
			if (sql.includes("FROM forums WHERE id")) {
				const origBind = stmt.bind.bind(stmt);
				stmt.bind = ((...args: unknown[]) => {
					const ret = origBind(...args);
					ret.first = vi.fn(async () => {
						nth++;
						return nth === 1
							? forumGateRow({ enabled: 0, required: 0, listable: 0 })
							: forumGateRow({ enabled: 1, required: 0, listable: 1 });
					});
					return ret;
				}) as typeof stmt.bind;
			}
			return stmt;
		}) as typeof origPrepare;

		const res = await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: true, listable: true }),
			}),
			adminEnv(db),
		);
		expect(res.status).toBe(200);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		const audited = mockAudit.mock.calls[0]?.[2];
		expect(audited).toMatchObject({
			action: "thread_type.config",
			targetType: "forum",
			targetId: 1,
			details: expect.objectContaining({
				forumId: 1,
				mutated: true,
				before: { enabled: false, required: false, listable: false, prefix: false },
				after: { enabled: true, required: false, listable: true, prefix: false },
			}),
		});
		const flags = (audited as { details: { changedFlags: string[] } }).details.changedFlags;
		expect(new Set(flags)).toEqual(new Set(["enabled", "listable"]));
	});

	it("updateConfig: no-op still audits with mutated=false + empty changedFlags", async () => {
		const { db } = createMockDb({
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
		expect(mockAudit).toHaveBeenCalledTimes(1);
		const details = mockAudit.mock.calls[0]?.[2]?.details as {
			mutated: boolean;
			changedFlags: string[];
		};
		expect(details.mutated).toBe(false);
		expect(details.changedFlags).toEqual([]);
	});

	it("updateConfig: validation failure does NOT audit", async () => {
		const { db } = createMockDb({
			firstResults: { "FROM forums WHERE id": forumGateRow({ enabled: 0, required: 0 }) },
		});
		await updateConfig(
			new Request("https://api.example.com/api/admin/forums/1/thread-types-config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ required: true }),
			}),
			adminEnv(db),
		);
		expect(mockAudit).not.toHaveBeenCalled();
	});
});
