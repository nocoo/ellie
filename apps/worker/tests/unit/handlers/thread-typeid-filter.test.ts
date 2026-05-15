// Tests for `?typeId=` filter on GET /api/v1/threads.
//
// Coverage:
//   - typeId=0/empty/missing → unfiltered (existing path, with global
//     announcement merge — sanity)
//   - typeId !== 0 with disabled forum → 400 (forumDisabled)
//   - typeId !== 0 with no matching enabled row → 400 (notFound)
//   - typeId !== 0 with cross-forum synthetic id → 400 (notFound)
//   - typeId !== 0 with matching row → SQL is `forum_id=? AND type_id=?`,
//     NO `sticky=STICKY_GLOBAL` merge → no site-wide announcements
//   - typeId-filtered request bypasses the page1 KV cache

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the forum-meta gate. We control `threadTypes.enabled` per test.
const { metaForumPayload, page1Loader } = vi.hoisted(() => ({
	metaForumPayload: { enabled: true },
	page1Loader: vi.fn(async (_env, _ctx, _forumId, _limit, loader: () => Promise<unknown>) =>
		loader(),
	),
}));

vi.mock("../../../src/lib/cache/forum-read", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../../../src/lib/cache/forum-read",
	);
	return {
		...actual,
		getForumMetaV2: vi.fn(async (_env, _ctx, id: number) => ({
			kind: "ok",
			forum: {
				id,
				status: 1,
				visibility: "public",
				name: "F",
				threadTypes: {
					enabled: metaForumPayload.enabled,
					required: false,
					listable: true,
					prefix: false,
				},
			},
		})),
	};
});

vi.mock("../../../src/lib/cache/thread-list-read", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../../../src/lib/cache/thread-list-read",
	);
	return {
		...actual,
		getThreadListPageOneV2: page1Loader,
	};
});

import { list } from "../../../src/handlers/thread";
import type { Env } from "../../../src/lib/env";
import { TEST_JWT_SECRET, createMockCtx, createMockKV, makeD1ThreadRow } from "../../helpers";

const mockEnv: Env = {
	API_KEY: "k",
	DB: {} as D1Database,
	ENVIRONMENT: "test",
	JWT_SECRET: TEST_JWT_SECRET,
	KV: createMockKV(),
	USE_KV_USER_CACHE: "false",
};

interface PrepareCall {
	sql: string;
	binds: unknown[];
}

/**
 * Build a D1 mock that:
 *   - Returns `typeRow` for the `forum_thread_types WHERE id=? AND
 *     forum_id=? AND enabled=1` lookup
 *   - Returns `{total: countRow}` for any COUNT(*) read
 *   - Returns `{results: rows}` for any other SELECT
 *   - Records every prepare/bind call in `calls`
 */
function makeDb({
	typeRow,
	countTotal = 1,
	rows = [],
}: {
	typeRow: { id: number; forum_id: number; name: string } | null;
	countTotal?: number;
	rows?: unknown[];
}): { db: D1Database; calls: PrepareCall[] } {
	const calls: PrepareCall[] = [];
	const prepare = vi.fn((sql: string) => ({
		bind: vi.fn((...binds: unknown[]) => {
			calls.push({ sql, binds });
			return {
				first: vi.fn(async () => {
					if (sql.includes("forum_thread_types")) return typeRow;
					if (sql.includes("COUNT(*)")) return { total: countTotal };
					return null;
				}),
				all: vi.fn(async () => ({ results: rows })),
			};
		}),
	}));
	return { db: { prepare } as unknown as D1Database, calls };
}

describe("GET /api/v1/threads — typeId filter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		metaForumPayload.enabled = true;
	});

	it("typeId=0 is treated as unfiltered (no D1 lookup, original SQL with global announcement merge)", async () => {
		const { db, calls } = makeDb({ typeRow: null, rows: [makeD1ThreadRow()] });
		const env = { ...mockEnv, DB: db };
		const res = await list(
			new Request("https://x/api/v1/threads?forumId=1&typeId=0"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(200);
		// No forum_thread_types lookup performed.
		expect(calls.find((c) => c.sql.includes("forum_thread_types"))).toBeUndefined();
		// List query uses unfiltered shape (sticky=STICKY_GLOBAL merge present).
		const listCall = calls.find((c) => c.sql.includes("ORDER BY"));
		expect(listCall?.sql).toContain("sticky =");
	});

	it("typeId=abc → 400 INVALID_REQUEST", async () => {
		const { db } = makeDb({ typeRow: null });
		const env = { ...mockEnv, DB: db };
		const res = await list(
			new Request("https://x/api/v1/threads?forumId=1&typeId=abc"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(400);
	});

	it("typeId !== 0 with forum thread_types_enabled=0 → 400 (forumDisabled, no D1 row lookup)", async () => {
		metaForumPayload.enabled = false;
		const { db, calls } = makeDb({ typeRow: null });
		const env = { ...mockEnv, DB: db };
		const res = await list(
			new Request("https://x/api/v1/threads?forumId=1&typeId=11"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(400);
		// No row lookup nor list query when the gate trips.
		expect(calls.find((c) => c.sql.includes("forum_thread_types"))).toBeUndefined();
		expect(calls.find((c) => c.sql.includes("ORDER BY"))).toBeUndefined();
	});

	it("typeId !== 0 with no matching enabled row → 400 (notFound)", async () => {
		const { db, calls } = makeDb({ typeRow: null });
		const env = { ...mockEnv, DB: db };
		const res = await list(
			new Request("https://x/api/v1/threads?forumId=1&typeId=11"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(400);
		// Lookup ran (correct call shape) but list query did NOT.
		const lookup = calls.find((c) => c.sql.includes("forum_thread_types"));
		expect(lookup).toBeDefined();
		expect(lookup?.binds).toEqual([11, 1]);
		expect(calls.find((c) => c.sql.includes("ORDER BY"))).toBeUndefined();
	});

	it("typeId !== 0 with cross-forum row → 400 (lookup binds forumId so it returns null)", async () => {
		// Synthetic id 11 only exists in forum 99. Caller asks forumId=1.
		// The lookup is bound to (typeId=11, forumId=1) so D1 returns null.
		const { db, calls } = makeDb({ typeRow: null });
		const env = { ...mockEnv, DB: db };
		const res = await list(
			new Request("https://x/api/v1/threads?forumId=1&typeId=11"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(400);
		const lookup = calls.find((c) => c.sql.includes("forum_thread_types"));
		expect(lookup?.binds).toEqual([11, 1]);
	});

	it("typeId match: SQL is `forum_id=? AND type_id=?`, NO global announcement merge", async () => {
		const { db, calls } = makeDb({
			typeRow: { id: 11, forum_id: 1, name: "Question" },
			rows: [makeD1ThreadRow()],
		});
		const env = { ...mockEnv, DB: db };
		const res = await list(
			new Request("https://x/api/v1/threads?forumId=1&typeId=11"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(200);
		const listCall = calls.find(
			(c) => c.sql.includes("ORDER BY") && !c.sql.includes("forum_thread_types"),
		);
		expect(listCall).toBeDefined();
		// Filtered shape: forum_id=? AND type_id=?
		expect(listCall?.sql).toMatch(/t\.forum_id\s*=\s*\?\s+AND\s+t\.type_id\s*=\s*\?/i);
		// Reviewer pin (msg 11e374e8): filtered list MUST NOT include
		// site-wide announcements via the WHERE-side `OR sticky = N` merge.
		// (The ORDER-BY-side `CASE WHEN t.sticky = ... THEN ... END` is a
		// sort rank, not a row inclusion filter, so it's allowed to stay.)
		expect(listCall?.sql).not.toMatch(/OR\s+t?\.?sticky\s*=/i);
		// Bind order: forumId, typeId, ..., limit
		expect(listCall?.binds[0]).toBe(1);
		expect(listCall?.binds[1]).toBe(11);
	});

	it("typeId-filtered request bypasses the page1 KV cache", async () => {
		const { db } = makeDb({
			typeRow: { id: 11, forum_id: 1, name: "Q" },
			rows: [],
		});
		const env = { ...mockEnv, DB: db };
		await list(new Request("https://x/api/v1/threads?forumId=1&typeId=11"), env, createMockCtx());
		expect(page1Loader).not.toHaveBeenCalled();
	});

	it("unfiltered request still uses the page1 KV cache", async () => {
		const { db } = makeDb({ typeRow: null, rows: [] });
		const env = { ...mockEnv, DB: db };
		await list(new Request("https://x/api/v1/threads?forumId=1"), env, createMockCtx());
		expect(page1Loader).toHaveBeenCalled();
	});

	it("typeId-filtered COUNT also drops the global announcement merge", async () => {
		const { db, calls } = makeDb({
			typeRow: { id: 11, forum_id: 1, name: "Q" },
			countTotal: 7,
			rows: [],
		});
		const env = { ...mockEnv, DB: db };
		const res = await list(
			new Request("https://x/api/v1/threads?forumId=1&typeId=11&page=1&limit=20"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(200);
		const countCall = calls.find((c) => c.sql.includes("COUNT(*)"));
		expect(countCall).toBeDefined();
		expect(countCall?.sql).toMatch(/forum_id\s*=\s*\?\s+AND\s+type_id\s*=\s*\?/i);
		expect(countCall?.sql).not.toMatch(/OR\s+sticky\s*=/i);
		expect(countCall?.binds).toEqual([1, 11]);
	});
});
