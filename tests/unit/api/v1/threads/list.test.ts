import { describe, expect, test } from "bun:test";
import { GET, POST } from "@/app/api/v1/threads/route";

describe("GET /api/v1/threads", () => {
	test("returns paginated thread list", async () => {
		const request = new Request("http://localhost/api/v1/threads");
		const response = await GET(request);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(Array.isArray(json.data.items)).toBe(true);
		expect(typeof json.data.total).toBe("number");
	});

	test("filters by forumId", async () => {
		const request = new Request("http://localhost/api/v1/threads?forumId=2");
		const response = await GET(request);
		const json = await response.json();
		for (const thread of json.data.items) {
			expect(thread.forumId).toBe(2);
		}
	});

	test("supports search by title", async () => {
		const request = new Request("http://localhost/api/v1/threads?search=test");
		const response = await GET(request);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("supports search by author", async () => {
		const request = new Request("http://localhost/api/v1/threads?author=admin");
		const response = await GET(request);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	test("supports limit parameter", async () => {
		const request = new Request("http://localhost/api/v1/threads?limit=1");
		const response = await GET(request);
		const json = await response.json();
		expect(json.data.items.length).toBeLessThanOrEqual(1);
	});
});

describe("POST /api/v1/threads", () => {
	test("creates thread with valid body", async () => {
		const request = new Request("http://localhost/api/v1/threads", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				forumId: 2,
				subject: "Test Thread",
				content: "Test content",
			}),
		});
		const response = await POST(request);
		expect(response.status).toBe(201);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(json.data.subject).toBe("Test Thread");
	});

	test("returns 400 for missing fields", async () => {
		const request = new Request("http://localhost/api/v1/threads", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ forumId: 2 }),
		});
		const response = await POST(request);
		expect(response.status).toBe(400);
	});

	test("returns 400 for invalid JSON", async () => {
		const request = new Request("http://localhost/api/v1/threads", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		const response = await POST(request);
		expect(response.status).toBe(400);
	});
});
