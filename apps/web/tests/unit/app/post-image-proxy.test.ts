// Behavioral tests for the public same-origin post-image proxy.
//
// Requirements (review msg=d57926b5 + msg=a4a60df3):
//   - Only call Worker /api/v1/post-images/{path} with FORUM_API_KEY.
//   - Path encoding cannot inject extra URL segments / query / fragment.
//   - Reject anything that doesn't match `{uuid}.{whitelisted-ext}`
//     before touching the Worker (no traversal, no extra segments, no
//     non-whitelisted extension).
//   - Preserve image headers (Content-Type, X-Content-Type-Options,
//     Cache-Control) from the Worker — never serve text/html.
//   - 200 on hit, 404 on miss, 502 on network error, 5xx pass-through
//     wrapped (never bare upstream body).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

async function callRoute(segments: string[]): Promise<Response> {
	const { GET } = await import("@/app/api/post-image/[...path]/route");
	const path = segments.join("/");
	const req = new Request(`https://web.example.com/api/post-image/${path}`, {
		method: "GET",
	}) as unknown as import("next/server").NextRequest;
	return await GET(req, { params: Promise.resolve({ path: segments }) });
}

beforeEach(() => {
	fetchMock.mockReset();
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.FORUM_API_KEY = "test-key";
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("GET /api/post-image/[...path]", () => {
	describe("path validation (no Worker call)", () => {
		it("404s on traversal '..'", async () => {
			const res = await callRoute([".."]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("404s on multi-segment path", async () => {
			const res = await callRoute(["sub", `${VALID_UUID}.jpg`]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("404s on non-UUID basename", async () => {
			const res = await callRoute(["not-a-uuid.jpg"]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("404s on non-whitelisted extension (svg)", async () => {
			const res = await callRoute([`${VALID_UUID}.svg`]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("404s on non-whitelisted extension (html)", async () => {
			const res = await callRoute([`${VALID_UUID}.html`]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("404s on missing extension", async () => {
			const res = await callRoute([VALID_UUID]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("404s on path with embedded query/fragment", async () => {
			// Catch-all only sees the segment; this proves a fishy segment
			// (with `?` or `#`) is rejected outright by the regex.
			const res = await callRoute([`${VALID_UUID}.jpg?evil=1`]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("404s on uppercase UUID (mirrors Worker's lowercase-only UUID_RE)", async () => {
			const res = await callRoute([`${VALID_UUID.toUpperCase()}.jpg`]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("404s on uppercase extension", async () => {
			const res = await callRoute([`${VALID_UUID}.JPG`]);
			expect(res.status).toBe(404);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe("upstream call shape", () => {
		it("calls Worker with X-API-Key and the encoded segment, no external URL accepted", async () => {
			fetchMock.mockResolvedValueOnce(
				new Response("img", {
					status: 200,
					headers: {
						"Content-Type": "image/jpeg",
						"X-Content-Type-Options": "nosniff",
						"Cache-Control": "public, max-age=31536000, immutable",
					},
				}),
			);

			const res = await callRoute([`${VALID_UUID}.jpg`]);
			expect(res.status).toBe(200);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe(
				`https://worker.example.com/api/v1/post-images/${encodeURIComponent(`${VALID_UUID}.jpg`)}`,
			);
			const headers = init.headers as Record<string, string>;
			expect(headers["X-API-Key"]).toBe("test-key");
			expect(init.method).toBe("GET");
			expect(init.cache).toBe("no-store");
		});

		it("preserves Worker's Content-Type, nosniff, and immutable cache headers", async () => {
			fetchMock.mockResolvedValueOnce(
				new Response("img", {
					status: 200,
					headers: {
						"Content-Type": "image/png",
						"X-Content-Type-Options": "nosniff",
						"Cache-Control": "public, max-age=31536000, immutable",
					},
				}),
			);

			const res = await callRoute([`${VALID_UUID}.png`]);
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("image/png");
			expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
		});
	});

	describe("upstream errors", () => {
		it("404s when Worker returns 404", async () => {
			fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
			const res = await callRoute([`${VALID_UUID}.jpg`]);
			expect(res.status).toBe(404);
		});

		it("wraps non-200/404 upstream into UPSTREAM_ERROR JSON (never bare upstream body)", async () => {
			fetchMock.mockResolvedValueOnce(
				new Response("<html>upstream broke</html>", {
					status: 500,
					headers: { "Content-Type": "text/html" },
				}),
			);

			const res = await callRoute([`${VALID_UUID}.jpg`]);
			expect(res.status).toBe(500);
			expect(res.headers.get("Content-Type")?.startsWith("application/json")).toBe(true);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe("UPSTREAM_ERROR");
		});

		it("502s on fetch failure", async () => {
			fetchMock.mockRejectedValueOnce(new Error("network down"));
			const res = await callRoute([`${VALID_UUID}.jpg`]);
			expect(res.status).toBe(502);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
		});
	});
});
