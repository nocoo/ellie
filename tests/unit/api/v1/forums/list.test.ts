import { describe, expect, test } from "bun:test";
import { GET as listForums } from "@/app/api/v1/forums/route";

describe("GET /api/v1/forums", () => {
	test("returns JSON with data array", async () => {
		const response = await listForums();
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
	});

	test("returns non-empty forum list", async () => {
		const response = await listForums();
		const json = await response.json();
		expect(json.data.length).toBeGreaterThan(0);
	});

	test("each forum has required fields", async () => {
		const response = await listForums();
		const json = await response.json();
		for (const forum of json.data) {
			expect(typeof forum.id).toBe("number");
			expect(typeof forum.name).toBe("string");
		}
	});
});
