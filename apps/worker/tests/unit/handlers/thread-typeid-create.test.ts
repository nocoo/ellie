// Tests for `body.typeId` validation + denorm write on POST /api/v1/threads.
//
// Coverage:
//   - typeId malformed (non-integer / partial) → 400 INVALID_BODY before
//     any forum / users SQL hits
//   - thread_types_required=1 + missing typeId → 400 INVALID_BODY
//   - thread_types_enabled=0 + non-zero typeId → 400 INVALID_BODY
//   - typeId resolves to an enabled row → INSERT writes both
//     `type_id = synthetic` and `type_name = row.name`
//   - typeId absent on a non-required forum → INSERT writes
//     `type_id = 0`, `type_name = ""` (no NULL, reviewer pin msg 4f1464c8)
//   - cross-forum synthetic id → 400 (lookup binds forum_id)

import { beforeEach, describe, expect, it, vi } from "vitest";

import { create } from "../../../src/handlers/thread";
import type { Env } from "../../../src/lib/env";
import {
	createJwtForRole,
	createMockKV,
	makeD1ForumRow,
	makeD1ThreadRow,
	TEST_JWT_SECRET,
} from "../../helpers";

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
 * D1 `.first()` dispatcher — pulled out of the prepare/bind closure so
 * the per-call branch tree doesn't blow biome's cognitive complexity
 * budget. Maps SQL substrings to the canned row each handler step
 * expects to see.
 */
function dispatchFirst(
	sql: string,
	forum: ReturnType<typeof makeD1ForumRow>,
	typeRow: { id: number; forum_id: number; name: string } | null,
	createdThread: Record<string, unknown>,
): unknown {
	if (sql.includes("SELECT role, status, email_verified_at FROM users")) {
		return { role: 0, status: 0, email_verified_at: 1700000000 };
	}
	if (sql.includes("SELECT key, value FROM settings")) return null;
	if (sql.includes("SELECT status, avatar_path, has_avatar, reg_date, role FROM users")) {
		return {
			status: 0,
			avatar_path: "avatars/x.jpg",
			has_avatar: 1,
			reg_date: 0,
			role: 0,
		};
	}
	if (sql.includes("FROM forums WHERE id")) return forum;
	if (sql.includes("forum_thread_types")) return typeRow;
	if (sql.includes("SELECT username FROM users")) return { username: "alice" };
	if (sql.includes("SELECT * FROM threads WHERE id")) return createdThread;
	return null;
}

/**
 * Build a D1 mock that:
 *   - Returns the auth row for `SELECT role, status, email_verified_at`
 *   - Returns a posting-permission row for the `users` SELECT
 *   - Returns the forum row (with thread_types_* flags) for `FROM forums`
 *   - Returns `typeRow` for the `forum_thread_types WHERE id=? AND
 *     forum_id=? AND enabled=1` lookup
 *   - Returns `{ username }` for the create-handler `SELECT username FROM
 *     users` lookup
 *   - Returns the created thread row for the post-INSERT `SELECT * FROM
 *     threads WHERE id`
 *   - Records every prepare/bind call in `calls`
 */
function makeDb({
	forum,
	typeRow,
	createdThread = makeD1ThreadRow({ id: 100 }),
}: {
	forum: ReturnType<typeof makeD1ForumRow>;
	typeRow: { id: number; forum_id: number; name: string } | null;
	createdThread?: Record<string, unknown>;
}): { db: D1Database; calls: PrepareCall[]; batchCalls: unknown[][] } {
	const calls: PrepareCall[] = [];
	const batchCalls: unknown[][] = [];
	const prepare = vi.fn((sql: string) => {
		const stmt = {
			bind: vi.fn((...binds: unknown[]) => {
				calls.push({ sql, binds });
				return {
					first: vi.fn(async () => dispatchFirst(sql, forum, typeRow, createdThread)),
					all: vi.fn(async () => ({ results: [] })),
					run: vi.fn(async () => ({ success: true, meta: { last_row_id: 100 } })),
				};
			}),
			// Some code paths call `.first()` / `.run()` / `.all()` directly on
			// the prepared statement without `.bind()`.
			first: vi.fn(async () => null),
			run: vi.fn(async () => ({ success: true, meta: { last_row_id: 100 } })),
			all: vi.fn(async () => ({ results: [] })),
		};
		return stmt;
	});
	const db = {
		prepare,
		batch: vi.fn(async (stmts: unknown[]) => {
			batchCalls.push(stmts);
			return [{ success: true }, { success: true }, { success: true }];
		}),
	} as unknown as D1Database;
	return { db, calls, batchCalls };
}

async function postCreate(env: Env, body: unknown): Promise<Response> {
	const token = await createJwtForRole(0, 42);
	return create(
		new Request("https://example.com/api/v1/threads", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		}),
		env,
	);
}

describe("POST /api/v1/threads — typeId validation + denorm write", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("typeId=1abc → 400 INVALID_BODY (strict parse, no DB hit)", async () => {
		// Reviewer pin (msg b4221d27): the strict parser must hold on the
		// create path too — a typo'd typeId must NOT silently dispatch
		// to category 1.
		const { db, calls } = makeDb({ forum: makeD1ForumRow({ id: 1 }), typeRow: null });
		const env = { ...mockEnv, DB: db };
		const res = await postCreate(env, {
			forumId: 1,
			subject: "x",
			content: "y",
			typeId: "1abc",
		});
		expect(res.status).toBe(400);
		// No forum_thread_types lookup, no INSERT into threads.
		expect(calls.find((c) => c.sql.includes("forum_thread_types"))).toBeUndefined();
		expect(calls.find((c) => c.sql.includes("INSERT INTO threads"))).toBeUndefined();
	});

	it("forum.thread_types_required=1 + no typeId → 400", async () => {
		const { db, calls } = makeDb({
			forum: makeD1ForumRow({ id: 1, thread_types_enabled: 1, thread_types_required: 1 }),
			typeRow: null,
		});
		const env = { ...mockEnv, DB: db };
		const res = await postCreate(env, { forumId: 1, subject: "x", content: "y" });
		expect(res.status).toBe(400);
		const body = await res.json<{ error: { details?: { message?: string } } }>();
		expect(body.error.details?.message).toBe("Forum requires a thread type");
		expect(calls.find((c) => c.sql.includes("INSERT INTO threads"))).toBeUndefined();
	});

	it("forum.thread_types_enabled=0 + non-zero typeId → 400 (forumDisabled)", async () => {
		const { db, calls } = makeDb({
			forum: makeD1ForumRow({ id: 1, thread_types_enabled: 0 }),
			typeRow: null,
		});
		const env = { ...mockEnv, DB: db };
		const res = await postCreate(env, {
			forumId: 1,
			subject: "x",
			content: "y",
			typeId: 11,
		});
		expect(res.status).toBe(400);
		// No row lookup, no INSERT (resolver shorted on the gate).
		expect(calls.find((c) => c.sql.includes("forum_thread_types"))).toBeUndefined();
		expect(calls.find((c) => c.sql.includes("INSERT INTO threads"))).toBeUndefined();
	});

	it("typeId resolves to an enabled row → INSERT writes synthetic id + denorm name", async () => {
		const { db, calls } = makeDb({
			forum: makeD1ForumRow({ id: 1, thread_types_enabled: 1, thread_types_required: 0 }),
			typeRow: { id: 11, forum_id: 1, name: "Question" },
		});
		const env = { ...mockEnv, DB: db };
		const res = await postCreate(env, {
			forumId: 1,
			subject: "x",
			content: "y",
			typeId: 11,
		});
		expect(res.status).toBe(201);

		// Lookup ran with bind order (typeId, forumId).
		const lookup = calls.find((c) => c.sql.includes("forum_thread_types"));
		expect(lookup).toBeDefined();
		expect(lookup?.binds).toEqual([11, 1]);

		// INSERT pinned: type_id + type_name appear in the column list and
		// are bound as the trailing two parameters (synthetic id 11 and
		// the row's name).
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO threads"));
		expect(insertCall).toBeDefined();
		expect(insertCall?.sql).toMatch(/type_id\s*,\s*type_name/);
		const binds = insertCall?.binds ?? [];
		expect(binds[binds.length - 2]).toBe(11);
		expect(binds[binds.length - 1]).toBe("Question");
	});

	it("typeId absent on non-required forum → INSERT writes type_id=0, type_name='' (no NULLs)", async () => {
		// Reviewer pin (msg 4f1464c8): denorm columns must always be the
		// non-null default — never undefined / null — so legacy renderers
		// don't see `null` where they expect string/int.
		const { db, calls } = makeDb({
			forum: makeD1ForumRow({ id: 1, thread_types_enabled: 1, thread_types_required: 0 }),
			typeRow: null,
		});
		const env = { ...mockEnv, DB: db };
		const res = await postCreate(env, { forumId: 1, subject: "x", content: "y" });
		expect(res.status).toBe(201);

		// No D1 row lookup (typeId absent shortcuts to noTypeRequested).
		expect(calls.find((c) => c.sql.includes("forum_thread_types"))).toBeUndefined();

		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO threads"));
		expect(insertCall).toBeDefined();
		const binds = insertCall?.binds ?? [];
		expect(binds[binds.length - 2]).toBe(0);
		expect(binds[binds.length - 1]).toBe("");
	});

	it("typeId=0 explicit → treated as absent; non-required forum still creates with 0/''", async () => {
		const { db, calls } = makeDb({
			forum: makeD1ForumRow({ id: 1, thread_types_enabled: 1, thread_types_required: 0 }),
			typeRow: null,
		});
		const env = { ...mockEnv, DB: db };
		const res = await postCreate(env, {
			forumId: 1,
			subject: "x",
			content: "y",
			typeId: 0,
		});
		expect(res.status).toBe(201);
		// 0 short-circuits noTypeRequested — no D1 row lookup either.
		expect(calls.find((c) => c.sql.includes("forum_thread_types"))).toBeUndefined();
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO threads"));
		const binds = insertCall?.binds ?? [];
		expect(binds[binds.length - 2]).toBe(0);
		expect(binds[binds.length - 1]).toBe("");
	});

	it("cross-forum synthetic typeId → 400 notFound (lookup binds forum_id so D1 returns null)", async () => {
		const { db, calls } = makeDb({
			forum: makeD1ForumRow({ id: 1, thread_types_enabled: 1, thread_types_required: 0 }),
			typeRow: null, // simulate id 11 only exists in another forum
		});
		const env = { ...mockEnv, DB: db };
		const res = await postCreate(env, {
			forumId: 1,
			subject: "x",
			content: "y",
			typeId: 11,
		});
		expect(res.status).toBe(400);
		const lookup = calls.find((c) => c.sql.includes("forum_thread_types"));
		expect(lookup?.binds).toEqual([11, 1]);
		expect(calls.find((c) => c.sql.includes("INSERT INTO threads"))).toBeUndefined();
	});

	it("forum SELECT widened to include thread_types_enabled / thread_types_required", async () => {
		// Pin: the create path no longer goes through the cached forum
		// reader, so the inline SELECT must hand-pick both gate columns.
		// Drop them and validation silently disables.
		const { db, calls } = makeDb({
			forum: makeD1ForumRow({ id: 1, thread_types_enabled: 1, thread_types_required: 0 }),
			typeRow: { id: 11, forum_id: 1, name: "Q" },
		});
		const env = { ...mockEnv, DB: db };
		await postCreate(env, { forumId: 1, subject: "x", content: "y", typeId: 11 });
		const forumCall = calls.find((c) => c.sql.includes("FROM forums WHERE id"));
		expect(forumCall?.sql).toMatch(/thread_types_enabled/);
		expect(forumCall?.sql).toMatch(/thread_types_required/);
	});
});
