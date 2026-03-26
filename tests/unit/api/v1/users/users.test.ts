import { describe, expect, test } from "bun:test";
import { GET as getUserById } from "@/app/api/v1/users/[id]/route";
import { GET as listUsers } from "@/app/api/v1/users/route";
import { createRepositories } from "@/data/index";

// Get a known user ID from mock data
const repos = createRepositories();
const firstUser = (await repos.users.list({ limit: 1 })).items[0];
if (!firstUser) throw new Error("No users in mock data");
const USER_ID = String(firstUser.id);

describe("GET /api/v1/users", () => {
	test("returns paginated user list", async () => {
		const request = new Request("http://localhost/api/v1/users");
		const response = await listUsers(request);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(Array.isArray(json.data.items)).toBe(true);
		expect(typeof json.data.total).toBe("number");
	});

	test("supports search parameter", async () => {
		const request = new Request(`http://localhost/api/v1/users?search=${firstUser.username}`);
		const response = await listUsers(request);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("supports limit parameter", async () => {
		const request = new Request("http://localhost/api/v1/users?limit=1");
		const response = await listUsers(request);
		const json = await response.json();
		expect(json.data.items.length).toBeLessThanOrEqual(1);
	});
});

describe("GET /api/v1/users/:id", () => {
	test("returns user by valid ID", async () => {
		const request = new Request(`http://localhost/api/v1/users/${USER_ID}`);
		const response = await getUserById(request, {
			params: Promise.resolve({ id: USER_ID }),
		});
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(json.data.id).toBe(firstUser.id);
	});

	test("returns 404 for non-existent user", async () => {
		const request = new Request("http://localhost/api/v1/users/99999");
		const response = await getUserById(request, {
			params: Promise.resolve({ id: "99999" }),
		});
		expect(response.status).toBe(404);
	});

	test("returns 400 for invalid ID", async () => {
		const request = new Request("http://localhost/api/v1/users/abc");
		const response = await getUserById(request, {
			params: Promise.resolve({ id: "abc" }),
		});
		expect(response.status).toBe(400);
	});
});
