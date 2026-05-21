// flushSink-d1.test.ts — P5 D1 flush sink boundary tests.
//
// Pins:
//   1. Empty input → no D1 round-trip at all (no prepare, no batch).
//   2. Non-empty input → exactly one batch() call carrying N prepared
//      statements, each bound to the canonical 8-column tuple in the
//      pinned order.
//   3. SQL shape includes INSERT INTO analytics_daily_targets, the
//      INSERT column list, the ON CONFLICT target with the EXACT PK
//      column order (date_local, path_kind, target_id, user_id,
//      bot_class), and DO UPDATE SET clauses for count / first_seen_at
//      / last_seen_at. Reviewer-pinned: drift between this SQL and the
//      migration 0043 PK is a hard failure.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUpsertSql, d1FlushSink } from "../../../../src/lib/analytics/flushSink-d1";
import type { AggregateRow } from "../../../../src/lib/analytics/types";
import { makeEnv } from "../../../helpers";

function makeRow(overrides: Partial<AggregateRow> = {}): AggregateRow {
	return {
		dateLocal: "2026-05-20",
		pathKind: "thread",
		targetId: 42,
		userId: 7,
		botClass: "human",
		count: 1,
		firstSeenAt: 1_747_700_000,
		lastSeenAt: 1_747_700_000,
		...overrides,
	};
}

interface PreparedCall {
	sql: string;
	bound: unknown[];
}

function makeMockDb() {
	const preparedCalls: PreparedCall[] = [];
	const batchCalls: unknown[][] = [];
	const prepare = vi.fn((sql: string) => {
		const stmt = {
			bind: vi.fn((...args: unknown[]) => {
				preparedCalls.push({ sql, bound: args });
				return stmt;
			}),
		};
		return stmt;
	});
	const batch = vi.fn(async (stmts: unknown[]) => {
		batchCalls.push(stmts);
		return [];
	});
	const db = { prepare, batch } as unknown as D1Database;
	return { db, prepare, batch, preparedCalls, batchCalls };
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("buildUpsertSql", () => {
	it("targets analytics_daily_targets and lists all 8 columns in canonical order", () => {
		const sql = buildUpsertSql();
		expect(sql).toContain("INSERT INTO analytics_daily_targets");
		expect(sql).toMatch(
			/\(date_local,\s*path_kind,\s*target_id,\s*user_id,\s*bot_class,\s*count,\s*first_seen_at,\s*last_seen_at\)/,
		);
	});

	it("ON CONFLICT target mirrors the migration 0043 composite PK column order", () => {
		const sql = buildUpsertSql();
		expect(sql).toMatch(
			/ON\s+CONFLICT\(date_local,\s*path_kind,\s*target_id,\s*user_id,\s*bot_class\)\s+DO\s+UPDATE\s+SET/,
		);
	});

	it("UPSERT increments count and tracks min(first_seen_at) / max(last_seen_at)", () => {
		const sql = buildUpsertSql();
		expect(sql).toMatch(/count\s*=\s*count\s*\+\s*excluded\.count/);
		expect(sql).toMatch(/first_seen_at\s*=\s*MIN\(first_seen_at,\s*excluded\.first_seen_at\)/);
		expect(sql).toMatch(/last_seen_at\s*=\s*MAX\(last_seen_at,\s*excluded\.last_seen_at\)/);
	});
});

describe("d1FlushSink", () => {
	it("empty input → no prepare, no batch (no D1 round-trip)", async () => {
		const { db, prepare, batch } = makeMockDb();
		const env = makeEnv({ DB: db });
		await d1FlushSink(env, []);
		expect(prepare).not.toHaveBeenCalled();
		expect(batch).not.toHaveBeenCalled();
	});

	it("non-empty input → exactly one batch() call carrying N statements", async () => {
		const { db, prepare, batch, batchCalls } = makeMockDb();
		const env = makeEnv({ DB: db });
		const rows = [makeRow(), makeRow({ targetId: 43 }), makeRow({ targetId: 44 })];
		await d1FlushSink(env, rows);
		expect(prepare).toHaveBeenCalledTimes(3);
		expect(batch).toHaveBeenCalledTimes(1);
		expect(batchCalls[0]).toHaveLength(3);
	});

	it("each statement binds the canonical 8-column tuple in order", async () => {
		const { db, preparedCalls } = makeMockDb();
		const env = makeEnv({ DB: db });
		const row = makeRow({
			dateLocal: "2026-05-21",
			pathKind: "forum",
			targetId: 99,
			userId: 1234,
			botClass: "bot_search",
			count: 17,
			firstSeenAt: 1_747_700_100,
			lastSeenAt: 1_747_700_999,
		});
		await d1FlushSink(env, [row]);
		expect(preparedCalls).toHaveLength(1);
		expect(preparedCalls[0].bound).toEqual([
			"2026-05-21",
			"forum",
			99,
			1234,
			"bot_search",
			17,
			1_747_700_100,
			1_747_700_999,
		]);
	});

	it("each prepared statement uses the buildUpsertSql output verbatim", async () => {
		const { db, preparedCalls } = makeMockDb();
		const env = makeEnv({ DB: db });
		await d1FlushSink(env, [makeRow(), makeRow({ targetId: 43 })]);
		const expectedSql = buildUpsertSql();
		for (const call of preparedCalls) {
			expect(call.sql).toBe(expectedSql);
		}
	});

	it("propagates batch() failure (collector wrapper catches)", async () => {
		const failingDb = {
			prepare: vi.fn(() => ({ bind: vi.fn().mockReturnThis() })),
			batch: vi.fn(async () => {
				throw new Error("D1_ERROR: simulated batch failure");
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: failingDb });
		await expect(d1FlushSink(env, [makeRow()])).rejects.toThrow(/simulated batch failure/);
	});
});
