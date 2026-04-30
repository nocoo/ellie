import { describe, expect, it } from "vitest";
import { jsonResponse, paginatedResponse } from "../../../src/lib/response";

describe("jsonResponse", () => {
	it("should return 200 status by default", () => {
		const res = jsonResponse({ foo: "bar" });
		expect(res.status).toBe(200);
	});

	it("should include data and meta with timestamp and requestId", async () => {
		const res = jsonResponse({ id: 1 });
		const body = await res.json();
		expect(body.data).toEqual({ id: 1 });
		expect(body.meta.timestamp).toBeTypeOf("number");
		expect(body.meta.requestId).toBeTypeOf("string");
	});

	it("should accept custom status code", () => {
		const res = jsonResponse({ id: 1 }, undefined, undefined, 201);
		expect(res.status).toBe(201);
	});

	it("should include CORS headers when origin is provided", () => {
		const res = jsonResponse({ id: 1 }, "https://ellie.nocoo.cloud");
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
	});

	it("should set Content-Type to application/json", () => {
		const res = jsonResponse({ id: 1 });
		expect(res.headers.get("Content-Type")).toBe("application/json");
	});

	it("should merge custom meta fields", async () => {
		const res = jsonResponse({ id: 1 }, undefined, { nextCursor: "abc" });
		const body = await res.json();
		expect(body.meta.nextCursor).toBe("abc");
		expect(body.meta.timestamp).toBeDefined();
	});

	it("should handle array data", async () => {
		const res = jsonResponse([1, 2, 3]);
		const body = await res.json();
		expect(body.data).toEqual([1, 2, 3]);
	});

	it("should handle null data", async () => {
		const res = jsonResponse(null);
		const body = await res.json();
		expect(body.data).toBeNull();
	});
});

describe("paginatedResponse", () => {
	it("should include total, page, limit, and pages in meta", async () => {
		const res = paginatedResponse([{ id: 1 }], 50, 1, 20);
		const body = await res.json();
		expect(body.meta.total).toBe(50);
		expect(body.meta.page).toBe(1);
		expect(body.meta.limit).toBe(20);
		expect(body.meta.pages).toBe(3);
	});

	it("should calculate pages correctly for exact division", async () => {
		const res = paginatedResponse([], 100, 1, 20);
		const body = await res.json();
		expect(body.meta.pages).toBe(5);
	});

	it("should calculate pages correctly for non-exact division", async () => {
		const res = paginatedResponse([], 101, 1, 20);
		const body = await res.json();
		expect(body.meta.pages).toBe(6);
	});

	it("should return 200 status", () => {
		const res = paginatedResponse([], 0, 1, 20);
		expect(res.status).toBe(200);
	});

	it("should include CORS headers when origin is provided", () => {
		const res = paginatedResponse([], 0, 1, 20, "http://localhost:3000");
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
	});

	it("should handle empty data with zero total", async () => {
		const res = paginatedResponse([], 0, 1, 20);
		const body = await res.json();
		expect(body.data).toEqual([]);
		expect(body.meta.total).toBe(0);
		expect(body.meta.pages).toBe(0);
	});
});
