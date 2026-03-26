import { describe, expect, test } from "bun:test";
import { GET as getForumById } from "@/app/api/v1/forums/[id]/route";

function makeRequest(url: string): Request {
	return new Request(url);
}

describe("GET /api/v1/forums/:id", () => {
	test("returns forum by valid ID", async () => {
		const request = makeRequest("http://localhost/api/v1/forums/2");
		const response = await getForumById(request, { params: Promise.resolve({ id: "2" }) });
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
		expect(json.data.id).toBe(2);
	});

	test("returns 404 for non-existent forum", async () => {
		const request = makeRequest("http://localhost/api/v1/forums/99999");
		const response = await getForumById(request, { params: Promise.resolve({ id: "99999" }) });
		expect(response.status).toBe(404);
		const json = await response.json();
		expect(json.error).toBe("Forum not found");
	});

	test("returns 400 for invalid ID", async () => {
		const request = makeRequest("http://localhost/api/v1/forums/abc");
		const response = await getForumById(request, { params: Promise.resolve({ id: "abc" }) });
		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.error).toBe("Invalid forum ID");
	});
});
