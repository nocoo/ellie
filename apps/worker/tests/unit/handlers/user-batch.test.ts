import { describe, expect, it } from "vitest";
import { batchGet } from "../../../src/handlers/user";
import type { Env } from "../../../src/lib/env";
import { TEST_JWT_SECRET, createMockDb, createMockKV, makeD1UserRow } from "../../helpers";

describe("batchGet (GET /api/v1/users/batch)", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
	};

	function makeRequest(ids: string): Request {
		return new Request(`https://example.com/api/v1/users/batch?ids=${ids}`);
	}

	it("should return public profiles for multiple users", async () => {
		const user1 = makeD1UserRow({
			id: 1,
			username: "alice",
			status: 0,
			role: 0,
			avatar: "a.jpg",
			avatar_path: "avatars/a.jpg",
			campus: "四平路校区",
		});
		const user2 = makeD1UserRow({
			id: 2,
			username: "bob",
			status: 0,
			role: 0,
			avatar: "b.jpg",
			avatar_path: "avatars/b.jpg",
			campus: "校外人士",
		});
		const { db } = createMockDb({
			allResults: {
				"SELECT id, username, avatar": [user1, user2],
			},
		});
		const env = { ...mockEnv, DB: db };

		const response = await batchGet(makeRequest("1,2"), env);

		expect(response.status).toBe(200);
		const data = (await response.json()) as {
			data: Array<{ id: number; username: string; campus: string }>;
		};
		expect(data.data).toHaveLength(2);
		expect(data.data[0].username).toBe("alice");
		expect(data.data[0].campus).toBe("四平路校区");
		expect(data.data[1].username).toBe("bob");
		expect(data.data[1].campus).toBe("校外人士");
	});

	it("should filter out non-public users (status < 0)", async () => {
		const activeUser = makeD1UserRow({ id: 1, username: "alice", status: 0 });
		const bannedUser = makeD1UserRow({ id: 2, username: "banned", status: -1 });
		const { db } = createMockDb({
			allResults: {
				"SELECT id, username, avatar": [activeUser, bannedUser],
			},
		});
		const env = { ...mockEnv, DB: db };

		const response = await batchGet(makeRequest("1,2"), env);

		const data = (await response.json()) as { data: Array<{ id: number }> };
		expect(data.data).toHaveLength(1);
		expect(data.data[0].id).toBe(1);
	});

	it("should return 400 when ids parameter is missing", async () => {
		const { db } = createMockDb();
		const env = { ...mockEnv, DB: db };

		const response = await batchGet(new Request("https://example.com/api/v1/users/batch"), env);

		expect(response.status).toBe(400);
	});

	it("should return empty array for invalid IDs", async () => {
		const { db } = createMockDb();
		const env = { ...mockEnv, DB: db };

		const response = await batchGet(makeRequest("abc,def"), env);

		expect(response.status).toBe(200);
		const data = (await response.json()) as { data: unknown[] };
		expect(data.data).toEqual([]);
	});

	it("should return 400 when too many IDs requested", async () => {
		const { db } = createMockDb();
		const env = { ...mockEnv, DB: db };

		const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
		const response = await batchGet(makeRequest(ids), env);

		expect(response.status).toBe(400);
		const data = (await response.json()) as {
			error: { code: string; details?: { message: string } };
		};
		expect(data.error.code).toBe("INVALID_REQUEST");
		expect(data.error.details?.message).toContain("max");
	});

	it("should deduplicate IDs", async () => {
		const user1 = makeD1UserRow({ id: 1, username: "alice", status: 0 });
		const { db, calls } = createMockDb({
			allResults: {
				"SELECT id, username, avatar": [user1],
			},
		});
		const env = { ...mockEnv, DB: db };

		await batchGet(makeRequest("1,1,1"), env);

		// Should only query with 1 unique ID
		const query = calls.find((c) => c.sql.includes("SELECT id, username, avatar"));
		expect(query).toBeDefined();
		expect(query?.params).toEqual([1]);
	});

	it("should not leak sensitive fields (email, password_hash, etc.)", async () => {
		const user = makeD1UserRow({
			id: 1,
			username: "alice",
			status: 0,
			email: "secret@test.com",
			password_hash: "hash123",
			password_salt: "salt123",
		});
		const { db } = createMockDb({
			allResults: {
				"SELECT id, username, avatar": [user],
			},
		});
		const env = { ...mockEnv, DB: db };

		const response = await batchGet(makeRequest("1"), env);

		const data = (await response.json()) as { data: Array<Record<string, unknown>> };
		const result = data.data[0];
		expect(result.email).toBeUndefined();
		expect(result.password_hash).toBeUndefined();
		expect(result.passwordHash).toBeUndefined();
	});

	it("should only issue 1 D1 query for N users (no N+1)", async () => {
		const users = Array.from({ length: 10 }, (_, i) =>
			makeD1UserRow({ id: i + 1, username: `user${i}`, status: 0 }),
		);
		const { db, calls } = createMockDb({
			allResults: {
				"SELECT id, username, avatar": users,
			},
		});
		const env = { ...mockEnv, DB: db };

		await batchGet(makeRequest("1,2,3,4,5,6,7,8,9,10"), env);

		// Exactly 1 query regardless of how many users
		expect(calls.length).toBe(1);
	});
});
