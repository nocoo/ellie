import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeD1 } from "../../../../src/lib/cache/d1-observe";
import { __resetMetricsForTest, swapSnapshot } from "../../../../src/lib/cache/metrics";

beforeEach(__resetMetricsForTest);
afterEach(() => vi.restoreAllMocks());

function fixture() {
	const prepared: object[] = [];
	function statement() {
		const value = {
			bind: vi.fn(function (this: unknown, ..._args: unknown[]) {
				expect(this).toBe(value);
				return statement();
			}),
			all: vi.fn(async function (this: unknown) {
				expect(this).toBe(value);
				return {
					success: true,
					results: [{ id: 1, name: "thread-1" }],
					meta: { rows_read: 12, rows_written: 0 },
				};
			}),
			run: vi.fn(async function (this: unknown) {
				expect(this).toBe(value);
				return { success: true, meta: { rows_read: 1, rows_written: 3 } };
			}),
			first: vi.fn(async function (this: unknown) {
				expect(this).toBe(value);
				return { id: 1, name: "thread-1" };
			}),
			raw: vi.fn(async () => [[1]]),
			tag: "original",
		};
		prepared.push(value);
		return value;
	}
	const db = {
		prepare: vi.fn(function (this: unknown, _sql: string) {
			expect(this).toBe(db);
			return statement();
		}),
		batch: vi.fn(async function (this: unknown, values: ReturnType<typeof statement>[]) {
			expect(this).toBe(db);
			for (const value of values) expect(prepared.includes(value)).toBe(true);
			return Promise.all(values.map((v) => v.all()));
		}),
		exec: vi.fn(async function (this: unknown) {
			expect(this).toBe(db);
			return { count: 1 };
		}),
	};
	return { db: db as unknown as D1Database, original: db, prepared };
}
function count(op: string, family = "application:d1") {
	return [...swapSnapshot().entries()]
		.filter(([key]) => key.startsWith(`${family}\u0001`) && key.endsWith(`\u0001${op}`))
		.reduce((sum, [, value]) => sum + value, 0);
}

describe("observation of existing D1 calls", () => {
	it("preserves bindings, result identity, and captures row metadata without extra queries", async () => {
		const f = fixture();
		const db = observeD1(f.db, "business");
		const stmt = db.prepare("SELECT id FROM threads WHERE id = ?").bind(7);
		expect((stmt as unknown as { tag: string }).tag).toBe("original");
		expect(await stmt.all()).toMatchObject({ results: [{ id: 1, name: "thread-1" }] });
		expect(f.original.prepare).toHaveBeenCalledOnce();
		const allValues = [...swapSnapshot().entries()];
		expect(allValues.find(([key]) => key.endsWith("d1-query"))?.[1]).toBe(1);
		expect(allValues.find(([key]) => key.endsWith("d1-rows-read"))?.[1]).toBe(12);

		await stmt.run();
		const runValues = [...swapSnapshot().entries()];
		expect(runValues.find(([key]) => key.endsWith("d1-rows-written"))?.[1]).toBe(3);

		// .first() returns row while capturing rows_read from underlying call
		expect(await stmt.first()).toEqual({ id: 1, name: "thread-1" });
		const firstValues = [...swapSnapshot().entries()];
		expect(firstValues.find(([key]) => key.endsWith("d1-query"))?.[1]).toBe(1);
		expect(firstValues.find(([key]) => key.endsWith("d1-rows-read"))?.[1]).toBe(12);

		// .first('id') returns single column value
		expect(await stmt.first("id")).toBe(1);
		const colValues = [...swapSnapshot().entries()];
		expect(colValues.find(([key]) => key.endsWith("d1-query"))?.[1]).toBe(1);
		expect(colValues.find(([key]) => key.endsWith("d1-rows-read"))?.[1]).toBe(12);

		// raw keeps query count and duration observation without fabricated metadata
		await stmt.raw();
		const rawValues = [...swapSnapshot().entries()];
		expect(rawValues.find(([key]) => key.endsWith("d1-query"))?.[1]).toBe(1);
		expect(rawValues.some(([key]) => key.includes("rows-read"))).toBe(false);

		await db.exec("PRAGMA test");
		expect(f.original.exec).toHaveBeenCalledOnce();
	});

	it("observes native first() semantics: empty results, missing column, prototype properties, and errors", async () => {
		const f = fixture();
		const db = observeD1(f.db, "business");
		const stmt1 = db.prepare("SELECT id FROM threads WHERE id = -1");
		const original = f.prepared.at(-1) as { all: ReturnType<typeof vi.fn> };

		// Empty results -> first() returns null
		original.all.mockResolvedValueOnce({
			success: true,
			results: [],
			meta: { rows_read: 1, rows_written: 0 },
		});
		expect(await stmt1.first()).toBeNull();
		expect(count("d1-rows-read")).toBe(1);

		// Empty results with column name -> first("id") returns null
		original.all.mockResolvedValueOnce({
			success: true,
			results: [],
			meta: { rows_read: 1, rows_written: 0 },
		});
		expect(await stmt1.first("id")).toBeNull();
		expect(count("d1-rows-read")).toBe(1);

		// Missing column throws D1_COLUMN_NOTFOUND error with cause
		original.all.mockResolvedValueOnce({
			success: true,
			results: [{ id: 1 }],
			meta: { rows_read: 3, rows_written: 0 },
		});
		await expect(stmt1.first("missing")).rejects.toMatchObject({
			message: "D1_COLUMN_NOTFOUND: Column not found (missing)",
			cause: expect.objectContaining({ message: "Column not found" }),
		});
		expect(count("d1-rows-read")).toBe(3);

		// Column name referring to inherited property (e.g. toString) returns property value
		original.all.mockResolvedValueOnce({
			success: true,
			results: [{ id: 1 }],
			meta: { rows_read: 1, rows_written: 0 },
		});
		const inherited = await stmt1.first("toString");
		expect(typeof inherited).toBe("function");

		// Column with null / 0 / empty string name
		original.all.mockResolvedValueOnce({
			success: true,
			results: [{ "": "empty-name", nullCol: null, zero: 0 }],
			meta: { rows_read: 1, rows_written: 0 },
		});
		expect(await stmt1.first("")).toBe("empty-name");
		original.all.mockResolvedValueOnce({
			success: true,
			results: [{ nullCol: null }],
			meta: { rows_read: 1, rows_written: 0 },
		});
		expect(await stmt1.first("nullCol")).toBeNull();
		original.all.mockResolvedValueOnce({
			success: true,
			results: [{ zero: 0 }],
			meta: { rows_read: 1, rows_written: 0 },
		});
		expect(await stmt1.first("zero")).toBe(0);

		// Explicitly reject false-success adapter result so it never becomes a null or auth row
		original.all.mockResolvedValueOnce({
			success: false,
			error: "D1_ERROR: simulated adapter failure",
			results: [],
			meta: { rows_read: 0, rows_written: 0 },
		} as unknown as D1Result);
		await expect(stmt1.first()).rejects.toThrow("D1_ERROR: simulated adapter failure");

		// A malformed adapter response must not be mistaken for an authoritative missing row.
		original.all.mockResolvedValueOnce({ success: true, meta: {} });
		await expect(stmt1.first()).rejects.toThrow("D1_ERROR: malformed query result");
		expect(original.all).toHaveBeenCalledTimes(9);
		expect((f.prepared.at(-1) as { first: ReturnType<typeof vi.fn> }).first).not.toHaveBeenCalled();
	});

	it("unwraps native batch statements and excludes the metrics store from observation", async () => {
		const f = fixture();
		const db = observeD1(f.db, "admin");
		await db.batch([
			db.prepare("SELECT id FROM threads"),
			db.prepare("INSERT INTO kv_cache_metrics_minute VALUES (?)").bind(1),
		]);
		const metrics = [...swapSnapshot().entries()];
		expect(metrics.every(([key]) => key.startsWith("admin:d1\u0001"))).toBe(true);
		expect(metrics.find(([key]) => key.endsWith("d1-query"))?.[1]).toBe(1);
		expect(metrics.find(([key]) => key.endsWith("d1-rows-read"))?.[1]).toBe(12);
		await db.batch([db.prepare("SELECT count FROM kv_cache_metrics_minute").bind(2)]);
		await db.prepare("SELECT count FROM kv_cache_metrics_minute").all();
		await db.prepare("SELECT count FROM kv_cache_metrics_hour").all();
		await db.batch([db.prepare("INSERT INTO kv_cache_metrics_hour VALUES (?)").bind(1)]);
		expect(swapSnapshot().size).toBe(0);
		await db.batch([f.db.prepare("SELECT 1")]);
		expect(count("d1-query", "admin:d1")).toBe(1);
	});

	it("propagates failures while observing only query count and duration", async () => {
		const f = fixture();
		const db = observeD1(f.db, "business");
		const stmt = db.prepare("SELECT 1");
		const original = f.prepared.at(-1) as { all: ReturnType<typeof vi.fn> };
		original.all.mockRejectedValue(new Error("D1 failed"));
		await expect(stmt.first()).rejects.toThrow("D1 failed");
		const metrics = [...swapSnapshot().entries()];
		expect(metrics.find(([key]) => key.endsWith("d1-query"))?.[1]).toBe(1);
		expect(metrics.some(([key]) => key.includes("rows-read"))).toBe(false);
	});
});
