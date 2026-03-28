import { describe, expect, it, mock } from "bun:test";
import { handleStats } from "../../../../src/handlers/admin/stats";
import { createAdminRequest, makeEnv } from "../../../helpers";

describe("admin stats handler", () => {
	function makeStatsMockDb() {
		const db = {
			prepare: mock((_sql: string) => ({
				bind: mock((..._params: unknown[]) => ({
					// bind returns itself for chaining in batch
				})),
			})),
			batch: mock(async () => [
				{ results: [{ cnt: 100 }] }, // total users
				{ results: [{ cnt: 5 }] }, // today users
				{ results: [{ cnt: 3 }] }, // banned users
				{ results: [{ cnt: 50 }] }, // total threads
				{ results: [{ cnt: 2 }] }, // today threads
				{ results: [{ cnt: 500 }] }, // total posts
				{ results: [{ cnt: 10 }] }, // today posts
				{ results: [{ cnt: 8 }] }, // total forums
				{ results: [{ cnt: 1 }] }, // hidden forums
			]),
		} as unknown as D1Database;

		return db;
	}

	it("should return correct stats structure", async () => {
		const db = makeStatsMockDb();
		const env = makeEnv({ DB: db });
		const request = await createAdminRequest("GET", "/api/admin/stats");

		const response = await handleStats(request, env);

		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		const data = body.data as Record<string, unknown>;

		expect(data.users).toEqual({ total: 100, today: 5, banned: 3 });
		expect(data.threads).toEqual({ total: 50, today: 2 });
		expect(data.posts).toEqual({ total: 500, today: 10 });
		expect(data.forums).toEqual({ total: 8, hidden: 1 });
	});

	it("should require auth (401 without token)", async () => {
		const db = makeStatsMockDb();
		const env = makeEnv({ DB: db });

		const response = await handleStats(new Request("https://api.example.com/api/admin/stats"), env);

		expect(response.status).toBe(401);
	});

	it("should require admin role (403 for non-admin)", async () => {
		const db = makeStatsMockDb();
		const env = makeEnv({ DB: db });
		const request = await createAdminRequest("GET", "/api/admin/stats", undefined, 0);

		const response = await handleStats(request, env);

		expect(response.status).toBe(403);
	});
});
