import { describe, expect, test } from "bun:test";
import { DELETE } from "@/app/api/v1/posts/[id]/route";
import { GET, POST } from "@/app/api/v1/posts/route";
import { createRepositories } from "@/data/index";

// Get a known thread ID from mock data
const repos = createRepositories();
const firstThread = (await repos.threads.list({ limit: 1 })).items[0];
if (!firstThread) throw new Error("No threads in mock data");
const THREAD_ID = firstThread.id;

describe("GET /api/v1/posts", () => {
	test("returns paginated post list", async () => {
		const request = new Request(`http://localhost/api/v1/posts?threadId=${THREAD_ID}`);
		const response = await GET(request);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(Array.isArray(json.data.items)).toBe(true);
		expect(typeof json.data.total).toBe("number");
	});

	test("filters by threadId", async () => {
		const request = new Request(`http://localhost/api/v1/posts?threadId=${THREAD_ID}`);
		const response = await GET(request);
		const json = await response.json();
		for (const post of json.data.items) {
			expect(post.threadId).toBe(THREAD_ID);
		}
	});

	test("supports limit parameter", async () => {
		const request = new Request(`http://localhost/api/v1/posts?threadId=${THREAD_ID}&limit=1`);
		const response = await GET(request);
		const json = await response.json();
		expect(json.data.items.length).toBeLessThanOrEqual(1);
	});
});

describe("POST /api/v1/posts", () => {
	test("creates post with valid body and auth", async () => {
		const request = new Request("http://localhost/api/v1/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Mock-Uid": "1" },
			body: JSON.stringify({
				threadId: THREAD_ID,
				content: "Test reply content",
			}),
		});
		const response = await POST(request);
		expect(response.status).toBe(201);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(json.data.content).toBe("Test reply content");
	});

	test("returns 401 without auth header", async () => {
		const request = new Request("http://localhost/api/v1/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				threadId: THREAD_ID,
				content: "Should fail",
			}),
		});
		const response = await POST(request);
		expect(response.status).toBe(401);
	});

	test("returns 400 for missing fields", async () => {
		const request = new Request("http://localhost/api/v1/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Mock-Uid": "1" },
			body: JSON.stringify({ threadId: THREAD_ID }),
		});
		const response = await POST(request);
		expect(response.status).toBe(400);
	});

	test("returns 400 for invalid JSON", async () => {
		const request = new Request("http://localhost/api/v1/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Mock-Uid": "1" },
			body: "not json",
		});
		const response = await POST(request);
		expect(response.status).toBe(400);
	});
});

describe("DELETE /api/v1/posts/:id", () => {
	test("returns 400 for invalid ID", async () => {
		const request = new Request("http://localhost/api/v1/posts/abc", {
			method: "DELETE",
		});
		const response = await DELETE(request, {
			params: Promise.resolve({ id: "abc" }),
		});
		expect(response.status).toBe(400);
	});
});
