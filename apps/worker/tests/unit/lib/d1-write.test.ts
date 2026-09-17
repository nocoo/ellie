import { describe, expect, it, vi } from "vitest";
import { confirmedBatch, confirmedRun } from "../../../src/lib/d1-write";

describe("confirmed D1 writes", () => {
	it.each([0, 3])(
		"returns the original run result with changes=%s using one call",
		async (changes) => {
			const result = { success: true, results: [{ id: 7 }], meta: { changes, last_row_id: 7 } };
			const statement = { run: vi.fn(async () => result) } as unknown as D1PreparedStatement;
			expect(await confirmedRun(statement)).toBe(result);
			expect(statement.run).toHaveBeenCalledExactlyOnceWith();
		},
	);

	it("rejects a reported run failure even if metadata looks successful", async () => {
		const statement = {
			run: vi.fn(async () => ({ success: false, meta: { changes: 1 } })),
		} as unknown as D1PreparedStatement;
		await expect(confirmedRun(statement)).rejects.toThrow("D1 write was not confirmed");
	});

	it("propagates a rejected run without retrying", async () => {
		const failure = new Error("D1 unavailable");
		const statement = { run: vi.fn().mockRejectedValue(failure) } as unknown as D1PreparedStatement;
		await expect(confirmedRun(statement)).rejects.toBe(failure);
		expect(statement.run).toHaveBeenCalledTimes(1);
	});

	it("returns original batch metadata with one unchanged batch call", async () => {
		const statements = [{}, {}] as D1PreparedStatement[];
		const results = [
			{ success: true, results: [], meta: { changes: 1 } },
			{ success: true, results: [{ id: 9 }], meta: { changes: 0 } },
		];
		const env = { DB: { batch: vi.fn(async () => results) } as unknown as D1Database };
		expect(await confirmedBatch(env, statements)).toBe(results);
		expect(env.DB.batch).toHaveBeenCalledExactlyOnceWith(statements);
	});

	it.each([
		["missing", [true]],
		["extra", [true, true, true]],
		["first failed", [false, true]],
		["last failed", [true, false]],
	] as const)("rejects %s batch results", async (_label, flags) => {
		const statements = [{}, {}] as D1PreparedStatement[];
		const env = {
			DB: {
				batch: vi.fn(async () => flags.map((success) => ({ success, results: [], meta: {} }))),
			} as unknown as D1Database,
		};
		await expect(confirmedBatch(env, statements)).rejects.toThrow(
			"D1 batch writes were not confirmed",
		);
		expect(env.DB.batch).toHaveBeenCalledTimes(1);
	});

	it("propagates a rejected batch without retrying or splitting it", async () => {
		const failure = new Error("D1 rolled back");
		const statements = [{}, {}] as D1PreparedStatement[];
		const env = { DB: { batch: vi.fn().mockRejectedValue(failure) } as unknown as D1Database };
		await expect(confirmedBatch(env, statements)).rejects.toBe(failure);
		expect(env.DB.batch).toHaveBeenCalledExactlyOnceWith(statements);
	});
});
