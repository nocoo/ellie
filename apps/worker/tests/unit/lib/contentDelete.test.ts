import { describe, expect, it, vi } from "vitest";
import { batchChunked, buildDeleteThreadChildStatements } from "../../../src/lib/contentDelete";
import type { Env } from "../../../src/lib/env";

describe("buildDeleteThreadChildStatements", () => {
	it("returns empty array for empty input (no statements)", () => {
		const env = { DB: { prepare: vi.fn() } } as unknown as Env;
		const stmts = buildDeleteThreadChildStatements(env, []);
		expect(stmts).toEqual([]);
		expect(env.DB.prepare as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});

	it("emits attachments + post_comments + recommended cleanup with a JSON snapshot", () => {
		const captured: { sql: string; params: unknown[] }[] = [];
		const env = {
			DB: {
				prepare: vi.fn((sql: string) => ({
					bind: vi.fn((...params: unknown[]) => {
						captured.push({ sql, params });
						return {} as D1PreparedStatement;
					}),
				})),
			},
		} as unknown as Env;

		const stmts = buildDeleteThreadChildStatements(env, [10, 11, 12]);
		expect(stmts).toHaveLength(3);

		const sqls = captured.map((c) => c.sql);
		expect(
			sqls.some((s) =>
				/DELETE FROM attachments WHERE thread_id IN \(SELECT value FROM json_each\(\?\)\)/.test(s),
			),
		).toBe(true);
		expect(
			sqls.some((s) =>
				/DELETE FROM post_comments WHERE thread_id IN \(SELECT value FROM json_each\(\?\)\)/.test(
					s,
				),
			),
		).toBe(true);
		// Per migration 0045 contract: deleting a thread must also purge
		// `forum_recommended_threads`, otherwise the (forum_id, thread_id)
		// PK slot would block a future re-recommend on the same id.
		expect(
			sqls.some((s) =>
				/DELETE FROM forum_recommended_threads WHERE thread_id IN \(SELECT value FROM json_each\(\?\)\)/.test(
					s,
				),
			),
		).toBe(true);

		// Every bind got the exact thread id list.
		for (const c of captured) {
			expect(c.params).toEqual(["[10,11,12]"]);
		}
	});

	it("uses one binding even for a thousand thread IDs", () => {
		const captured: string[] = [];
		const env = {
			DB: {
				prepare: vi.fn((sql: string) => ({
					bind: vi.fn(() => {
						captured.push(sql);
						return {} as D1PreparedStatement;
					}),
				})),
			},
		} as unknown as Env;
		buildDeleteThreadChildStatements(
			env,
			Array.from({ length: 1000 }, (_, i) => i + 1),
		);
		// Binding count stays constant, below the D1 limit.
		expect(captured.every((s) => (s.match(/\?/g) ?? []).length === 1)).toBe(true);
	});
});

describe("batchChunked", () => {
	it("does nothing for empty array", async () => {
		const db = { batch: vi.fn() } as unknown as D1Database;
		await batchChunked(db, []);
		expect(db.batch).not.toHaveBeenCalled();
	});

	it("runs a single batch when under chunk size", async () => {
		const db = {
			batch: vi.fn(async () => []),
		} as unknown as D1Database;
		const stmts = Array.from({ length: 10 }, () => ({}) as D1PreparedStatement);
		await batchChunked(db, stmts);
		expect(db.batch).toHaveBeenCalledTimes(1);
		expect((db.batch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(10);
	});

	it("chunks into multiple batches of 80", async () => {
		const db = {
			batch: vi.fn(async () => []),
		} as unknown as D1Database;
		const stmts = Array.from({ length: 200 }, () => ({}) as D1PreparedStatement);
		await batchChunked(db, stmts);
		expect(db.batch).toHaveBeenCalledTimes(3);
		expect((db.batch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(80);
		expect((db.batch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toHaveLength(80);
		expect((db.batch as ReturnType<typeof vi.fn>).mock.calls[2][0]).toHaveLength(40);
	});

	it("handles exactly chunk-size boundary", async () => {
		const db = {
			batch: vi.fn(async () => []),
		} as unknown as D1Database;
		const stmts = Array.from({ length: 80 }, () => ({}) as D1PreparedStatement);
		await batchChunked(db, stmts);
		expect(db.batch).toHaveBeenCalledTimes(1);
		expect((db.batch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(80);
	});
});
