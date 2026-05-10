import { describe, expect, it, vi } from "vitest";
import { batchChunked } from "../../../src/lib/contentDelete";

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
