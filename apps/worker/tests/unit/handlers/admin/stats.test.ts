import { describe, expect, it, vi } from "vitest";
import { handleStats } from "../../../../src/handlers/admin/stats";
import { createAdminRequest, makeEnv } from "../../../helpers";

describe("admin stats handler", () => {
	function makeStatsMockDb() {
		const db = {
			prepare: vi.fn((_sql: string) => ({
				bind: vi.fn((..._params: unknown[]) => ({
					// bind returns itself for chaining in batch
				})),
			})),
			batch: vi.fn(async () => [
				{ success: true, results: [{ cnt: 100 }] },
				{ success: true, results: [{ cnt: 5 }] },
				{ success: true, results: [{ cnt: 3 }] },
				{ success: true, results: [{ cnt: 50 }] },
				{ success: true, results: [{ cnt: 2 }] },
				{ success: true, results: [{ cnt: 500 }] },
				{ success: true, results: [{ cnt: 10 }] },
				{ success: true, results: [{ cnt: 8 }] },
				{ success: true, results: [{ cnt: 1 }] },
			]),
		} as unknown as D1Database;

		return db;
	}

	it("should return correct stats structure", async () => {
		const db = makeStatsMockDb();
		const env = makeEnv({ DB: db });
		const request = createAdminRequest("GET", "/api/admin/stats");

		const response = await handleStats(request, env);

		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		const data = body.data as Record<string, unknown>;

		expect(data.users).toEqual({ total: 100, today: 5, banned: 3 });
		expect(data.threads).toEqual({ total: 50, today: 2 });
		expect(data.posts).toEqual({ total: 500, today: 10 });
		expect(data.forums).toEqual({ total: 8, hidden: 1 });
	});
});
