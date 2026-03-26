import { describe, expect, test } from "bun:test";
import { POST } from "@/app/api/v1/moderation/route";
import { createRepositories } from "@/data/index";
import { isAdminRole, isModRole } from "@/lib/api-utils";

// Get a known thread ID from mock data
const repos = createRepositories();
const firstThread = (await repos.threads.list({ limit: 1 })).items[0];
if (!firstThread) throw new Error("No threads in mock data");
const THREAD_ID = firstThread.id;

function modRequest(body: Record<string, unknown>, role?: number): Request {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (role !== undefined) {
		headers["X-Mock-Role"] = String(role);
	}
	return new Request("http://localhost/api/v1/moderation", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

describe("role guard helpers", () => {
	test("isModRole allows Admin (1)", () => {
		expect(isModRole(1)).toBe(true);
	});

	test("isModRole allows SuperMod (2)", () => {
		expect(isModRole(2)).toBe(true);
	});

	test("isModRole allows Mod (3)", () => {
		expect(isModRole(3)).toBe(true);
	});

	test("isModRole denies User (0)", () => {
		expect(isModRole(0)).toBe(false);
	});

	test("isAdminRole allows Admin (1)", () => {
		expect(isAdminRole(1)).toBe(true);
	});

	test("isAdminRole allows SuperMod (2)", () => {
		expect(isAdminRole(2)).toBe(true);
	});

	test("isAdminRole denies Mod (3)", () => {
		expect(isAdminRole(3)).toBe(false);
	});

	test("isAdminRole denies User (0)", () => {
		expect(isAdminRole(0)).toBe(false);
	});
});

describe("POST /api/v1/moderation", () => {
	test("returns 403 without role header", async () => {
		const response = await POST(modRequest({ action: "sticky", threadId: THREAD_ID }));
		expect(response.status).toBe(403);
	});

	test("returns 403 for regular user (role 0)", async () => {
		const response = await POST(modRequest({ action: "sticky", threadId: THREAD_ID }, 0));
		expect(response.status).toBe(403);
	});

	test("allows mod role (3) to perform actions", async () => {
		const response = await POST(modRequest({ action: "sticky", threadId: THREAD_ID }, 3));
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.success).toBe(true);
	});

	test("allows admin role (1) to perform actions", async () => {
		const response = await POST(modRequest({ action: "digest", threadId: THREAD_ID }, 1));
		expect(response.status).toBe(200);
	});

	test("returns 400 for missing action", async () => {
		const response = await POST(modRequest({ threadId: THREAD_ID }, 1));
		expect(response.status).toBe(400);
	});

	test("returns 400 for unknown action", async () => {
		const response = await POST(modRequest({ action: "unknown", threadId: THREAD_ID }, 1));
		expect(response.status).toBe(400);
	});

	test("returns 404 for non-existent thread", async () => {
		const response = await POST(modRequest({ action: "sticky", threadId: 99999 }, 1));
		expect(response.status).toBe(404);
	});

	test("close action works", async () => {
		const response = await POST(
			modRequest({ action: "close", threadId: THREAD_ID, closed: true }, 2),
		);
		expect(response.status).toBe(200);
	});

	test("move action requires targetForumId", async () => {
		const response = await POST(modRequest({ action: "move", threadId: THREAD_ID }, 1));
		expect(response.status).toBe(400);
	});
});
