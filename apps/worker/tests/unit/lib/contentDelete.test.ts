import { describe, expect, it, vi } from "vitest";
import { buildDeleteThreadChildStatements } from "../../../src/lib/contentDelete";
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
			expect(c.params.every((p) => p === "[10,11,12]")).toBe(true);
		}
	});

	it("uses at most two bindings even for a thousand thread IDs", () => {
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
		expect(captured.every((s) => (s.match(/\?/g) ?? []).length <= 2)).toBe(true);
	});
});
