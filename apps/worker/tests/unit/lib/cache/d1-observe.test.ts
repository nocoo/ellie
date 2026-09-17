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
				return { success: true, results: [{ id: 1 }], meta: { rows_read: 12, rows_written: 0 } };
			}),
			run: vi.fn(async function (this: unknown) {
				expect(this).toBe(value);
				return { success: true, meta: { rows_read: 1, rows_written: 3 } };
			}),
			first: vi.fn(async function (this: unknown) {
				expect(this).toBe(value);
				return { id: 1 };
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
	it("preserves bindings, result identity, and optional row metadata without extra queries", async () => {
		const f = fixture();
		const db = observeD1(f.db, "business");
		const stmt = db.prepare("SELECT id FROM threads WHERE id = ?").bind(7);
		expect((stmt as unknown as { tag: string }).tag).toBe("original");
		expect(await stmt.all()).toMatchObject({ results: [{ id: 1 }] });
		expect(f.original.prepare).toHaveBeenCalledOnce();
		const values = [...swapSnapshot().entries()];
		expect(values.find(([key]) => key.endsWith("d1-query"))?.[1]).toBe(1);
		expect(values.find(([key]) => key.endsWith("d1-rows-read"))?.[1]).toBe(12);
		await stmt.run();
		expect(count("d1-rows-written")).toBe(3);
		await stmt.first();
		const first = [...swapSnapshot().keys()];
		expect(first.some((key) => key.includes("rows-read"))).toBe(false);
		await stmt.raw();
		expect(count("d1-query")).toBe(1);
		await db.exec("PRAGMA test");
		expect(f.original.exec).toHaveBeenCalledOnce();
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
		expect(swapSnapshot().size).toBe(0);
		await db.batch([f.db.prepare("SELECT 1")]);
		expect(count("d1-query", "admin:d1")).toBe(1);
	});
	it("propagates failures while observing only query count and duration", async () => {
		const f = fixture();
		const db = observeD1(f.db, "business");
		const stmt = db.prepare("SELECT 1");
		const original = f.prepared.at(-1) as { first: ReturnType<typeof vi.fn> };
		original.first.mockRejectedValue(new Error("D1 failed"));
		await expect(stmt.first()).rejects.toThrow("D1 failed");
		const metrics = [...swapSnapshot().entries()];
		expect(metrics.find(([key]) => key.endsWith("d1-query"))?.[1]).toBe(1);
		expect(metrics.some(([key]) => key.includes("rows-read"))).toBe(false);
	});
});
