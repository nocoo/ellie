import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reorder } from "../../../../src/handlers/admin/forum";
import { batchRecalcCounters, batchRole, batchStatus } from "../../../../src/handlers/admin/user";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

describe("admin batch save receipts", () => {
	let f: ReturnType<typeof readingFixture>;
	beforeEach(() => {
		f = readingFixture();
	});
	afterEach(() => {
		f.close();
		vi.restoreAllMocks();
	});

	for (const operation of [
		{ handler: batchStatus, path: "batch-status", value: { status: -1 }, field: "count" },
		{ handler: batchRole, path: "batch-role", value: { role: 2 }, field: "count" },
		{ handler: batchRecalcCounters, path: "batch-recalc-counters", value: {}, field: "updated" },
	]) {
		it.each([
			{ ids: [10, 20, 999], count: 2 },
			{ ids: [10, 10, 20], count: 2 },
			{ ids: [998, 999], count: 0 },
		])(`${operation.path} reports confirmed rows for $ids`, async ({ ids, count }) => {
			const response = await operation.handler(
				createAdminRequest("POST", `/api/admin/users/${operation.path}`, {
					ids,
					...operation.value,
				}),
				f.env,
			);
			expect(response.status).toBe(200);
			expect((await response.json()).data[operation.field]).toBe(count);
			if (count === 0) {
				expect(f.env.KV.put).not.toHaveBeenCalled();
				expect(f.env.KV.delete).not.toHaveBeenCalled();
			}
			if (operation.path === "batch-status" && count > 0) {
				expect(f.sqlite.prepare("SELECT status FROM users WHERE id IN (10,20)").all()).toEqual([
					{ status: -1 },
					{ status: -1 },
				]);
			}
			if (operation.path === "batch-role" && count > 0) {
				expect(f.sqlite.prepare("SELECT role FROM users WHERE id IN (10,20)").all()).toEqual([
					{ role: 2 },
					{ role: 2 },
				]);
			}
		});
	}

	it.each([
		{ ids: [1, 2, 999], count: 2 },
		{ ids: [998, 999], count: 0 },
	])("forum reorder reports confirmed rows for $ids", async ({ ids, count }) => {
		const response = await reorder(
			createAdminRequest("POST", "/api/admin/forums/reorder", {
				orders: ids.map((id, index) => ({ id, displayOrder: index + 5 })),
			}),
			f.env,
		);
		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ updated: true, count });
		if (count > 0)
			expect(
				f.sqlite.prepare("SELECT display_order FROM forums WHERE id IN (1,2) ORDER BY id").all(),
			).toEqual([{ display_order: 5 }, { display_order: 6 }]);
	});
});
