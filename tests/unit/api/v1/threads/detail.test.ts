import { describe, expect, test } from "bun:test";
import { DELETE, GET } from "@/app/api/v1/threads/[id]/route";
import { createRepositories } from "@/data/index";

function params(id: string) {
	return { params: Promise.resolve({ id }) };
}

// Get a known thread ID from mock data
const repos = createRepositories();
const firstThread = (await repos.threads.list({ limit: 1 })).items[0];
if (!firstThread) throw new Error("No threads in mock data");
const THREAD_ID = String(firstThread.id);

describe("GET /api/v1/threads/:id", () => {
	test("returns thread by valid ID", async () => {
		const request = new Request(`http://localhost/api/v1/threads/${THREAD_ID}`);
		const response = await GET(request, params(THREAD_ID));
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(json.data.id).toBe(firstThread.id);
	});

	test("returns 404 for non-existent thread", async () => {
		const request = new Request("http://localhost/api/v1/threads/99999");
		const response = await GET(request, params("99999"));
		expect(response.status).toBe(404);
	});

	test("returns 400 for invalid ID", async () => {
		const request = new Request("http://localhost/api/v1/threads/abc");
		const response = await GET(request, params("abc"));
		expect(response.status).toBe(400);
	});
});

describe("DELETE /api/v1/threads/:id", () => {
	test("deletes existing thread", async () => {
		const request = new Request(`http://localhost/api/v1/threads/${THREAD_ID}`, {
			method: "DELETE",
		});
		const response = await DELETE(request, params(THREAD_ID));
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.success).toBe(true);
	});

	test("returns 404 for non-existent thread", async () => {
		const request = new Request("http://localhost/api/v1/threads/99999", { method: "DELETE" });
		const response = await DELETE(request, params("99999"));
		expect(response.status).toBe(404);
	});

	test("returns 400 for invalid ID", async () => {
		const request = new Request("http://localhost/api/v1/threads/abc", { method: "DELETE" });
		const response = await DELETE(request, params("abc"));
		expect(response.status).toBe(400);
	});
});
