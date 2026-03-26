import { describe, expect, it } from "bun:test";
import { corsHeaders, withCorsHeaders } from "../../../src/middleware/cors";

describe("corsHeaders", () => {
	it("should return base headers without origin", () => {
		const headers = corsHeaders();

		expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, PATCH, DELETE, OPTIONS");
		expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type, Authorization, X-API-Key");
		expect(headers["Access-Control-Max-Age"]).toBe("86400");
		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
	});

	it("should include Allow-Origin for allowed origin (production)", () => {
		const headers = corsHeaders("https://ellie.nocoo.cloud");

		expect(headers["Access-Control-Allow-Origin"]).toBe("https://ellie.nocoo.cloud");
	});

	it("should include Allow-Origin for allowed origin (localhost)", () => {
		const headers = corsHeaders("http://localhost:3000");

		expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
	});

	it("should NOT include Allow-Origin for disallowed origin", () => {
		const headers = corsHeaders("https://evil.com");

		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
	});

	it("should NOT include Allow-Origin for undefined origin", () => {
		const headers = corsHeaders(undefined);

		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
	});

	it("should NOT include Allow-Origin for empty string origin", () => {
		const headers = corsHeaders("");

		expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
	});

	it("should NOT match similar but different origins", () => {
		// Should not match subdomains or path-extended origins
		expect(
			corsHeaders("https://sub.ellie.nocoo.cloud")["Access-Control-Allow-Origin"],
		).toBeUndefined();
		expect(corsHeaders("http://localhost:3001")["Access-Control-Allow-Origin"]).toBeUndefined();
		expect(
			corsHeaders("https://ellie.nocoo.cloud.evil.com")["Access-Control-Allow-Origin"],
		).toBeUndefined();
	});
});

describe("withCorsHeaders", () => {
	it("should add CORS headers to an existing response", () => {
		const original = new Response("hello", { status: 200 });
		const result = withCorsHeaders(original);

		expect(result.headers.get("Access-Control-Allow-Methods")).toBe(
			"GET, POST, PATCH, DELETE, OPTIONS",
		);
		expect(result.headers.get("Access-Control-Allow-Headers")).toBe(
			"Content-Type, Authorization, X-API-Key",
		);
		expect(result.headers.get("Access-Control-Max-Age")).toBe("86400");
	});

	it("should preserve original response status", () => {
		const original = new Response("not found", { status: 404 });
		const result = withCorsHeaders(original);

		expect(result.status).toBe(404);
	});

	it("should preserve original response body", async () => {
		const original = new Response("test body", { status: 200 });
		const result = withCorsHeaders(original);

		const text = await result.text();
		expect(text).toBe("test body");
	});

	it("should preserve original response headers", () => {
		const original = new Response("hello", {
			status: 200,
			headers: { "Content-Type": "application/json", "X-Custom": "value" },
		});
		const result = withCorsHeaders(original);

		expect(result.headers.get("Content-Type")).toBe("application/json");
		expect(result.headers.get("X-Custom")).toBe("value");
	});

	it("should preserve statusText", () => {
		const original = new Response(null, { status: 204, statusText: "No Content" });
		const result = withCorsHeaders(original);

		expect(result.status).toBe(204);
		expect(result.statusText).toBe("No Content");
	});
});
