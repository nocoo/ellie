import { describe, expect, test } from "bun:test";
import { GET as getAdminContent, POST as postAdminContent } from "@/app/api/admin/content/route";
import { GET as getAdminForums, POST as postAdminForums } from "@/app/api/admin/forums/route";
import { GET as getAdminUsers, POST as postAdminUsers } from "@/app/api/admin/users/route";
import { createRepositories } from "@/data/index";

// Get known IDs from mock data
const repos = createRepositories();
const firstUser = (await repos.users.list({ limit: 1 })).items[0];
if (!firstUser) throw new Error("No users in mock data");
const USER_ID = firstUser.id;

const firstThread = (await repos.threads.list({ limit: 1 })).items[0];
if (!firstThread) throw new Error("No threads in mock data");
const THREAD_ID = firstThread.id;

const firstForum = (await repos.forums.listAll())[0];
if (!firstForum) throw new Error("No forums in mock data");
const FORUM_ID = firstForum.id;

function adminGet(url: string, role?: number): Request {
	const headers: Record<string, string> = {};
	if (role !== undefined) headers["X-Mock-Role"] = String(role);
	return new Request(url, { headers });
}

function adminPost(url: string, body: Record<string, unknown>, role?: number): Request {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (role !== undefined) headers["X-Mock-Role"] = String(role);
	return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("Admin API — role guard", () => {
	test("GET /api/admin/users returns 403 without admin role", async () => {
		const response = await getAdminUsers(adminGet("http://localhost/api/admin/users"));
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/users returns 403 for Mod (3)", async () => {
		const response = await getAdminUsers(adminGet("http://localhost/api/admin/users", 3));
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/users returns 403 for User (0)", async () => {
		const response = await getAdminUsers(adminGet("http://localhost/api/admin/users", 0));
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/content returns 403 without admin role", async () => {
		const response = await getAdminContent(adminGet("http://localhost/api/admin/content"));
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/forums returns 403 without admin role", async () => {
		const response = await getAdminForums(adminGet("http://localhost/api/admin/forums"));
		expect(response.status).toBe(403);
	});
});

describe("GET /api/admin/users", () => {
	test("returns user list for Admin (1)", async () => {
		const response = await getAdminUsers(adminGet("http://localhost/api/admin/users", 1));
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("returns user list for SuperMod (2)", async () => {
		const response = await getAdminUsers(adminGet("http://localhost/api/admin/users", 2));
		expect(response.status).toBe(200);
	});
});

describe("POST /api/admin/users", () => {
	test("ban action works with admin role", async () => {
		const response = await postAdminUsers(
			adminPost("http://localhost/api/admin/users", { action: "ban", userId: USER_ID }, 1),
		);
		expect(response.status).toBe(200);
	});

	test("returns 403 for non-admin", async () => {
		const response = await postAdminUsers(
			adminPost("http://localhost/api/admin/users", { action: "ban", userId: USER_ID }, 3),
		);
		expect(response.status).toBe(403);
	});

	test("returns 400 for missing fields", async () => {
		const response = await postAdminUsers(
			adminPost("http://localhost/api/admin/users", { action: "ban" }, 1),
		);
		expect(response.status).toBe(400);
	});

	test("returns 400 for unknown action", async () => {
		const response = await postAdminUsers(
			adminPost("http://localhost/api/admin/users", { action: "unknown", userId: USER_ID }, 1),
		);
		expect(response.status).toBe(400);
	});
});

describe("GET /api/admin/content", () => {
	test("returns thread list for admin", async () => {
		const response = await getAdminContent(adminGet("http://localhost/api/admin/content", 1));
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("returns post list when type=posts and threadId provided", async () => {
		const response = await getAdminContent(
			adminGet(`http://localhost/api/admin/content?type=posts&threadId=${THREAD_ID}`, 1),
		);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("returns 400 when type=posts without threadId", async () => {
		const response = await getAdminContent(
			adminGet("http://localhost/api/admin/content?type=posts", 1),
		);
		expect(response.status).toBe(400);
	});
});

describe("POST /api/admin/content", () => {
	test("returns 400 for missing fields", async () => {
		const response = await postAdminContent(
			adminPost("http://localhost/api/admin/content", { type: "thread" }, 1),
		);
		expect(response.status).toBe(400);
	});

	test("returns 400 for unknown content type", async () => {
		const response = await postAdminContent(
			adminPost("http://localhost/api/admin/content", { type: "comment", id: 1 }, 1),
		);
		expect(response.status).toBe(400);
	});
});

describe("GET /api/admin/forums", () => {
	test("returns forum list for admin", async () => {
		const response = await getAdminForums(adminGet("http://localhost/api/admin/forums", 1));
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
	});
});

describe("POST /api/admin/forums", () => {
	test("updates forum with admin role", async () => {
		const response = await postAdminForums(
			adminPost(
				"http://localhost/api/admin/forums",
				{ forumId: FORUM_ID, name: "Updated Name" },
				1,
			),
		);
		expect(response.status).toBe(200);
	});

	test("returns 400 for missing forumId", async () => {
		const response = await postAdminForums(
			adminPost("http://localhost/api/admin/forums", { name: "Test" }, 1),
		);
		expect(response.status).toBe(400);
	});

	test("returns 404 for non-existent forum", async () => {
		const response = await postAdminForums(
			adminPost("http://localhost/api/admin/forums", { forumId: 99999 }, 1),
		);
		expect(response.status).toBe(404);
	});
});
