// Behavioral tests for GET /api/v1/post-comments after R1-C.
//
// R1-C goal: stop string-concatenating user-supplied query params into the
// Worker URL. We must call `forumApi.get(path, searchParams)` so the typed
// helper handles encoding and undefined/null/empty filtering for us.
//
// Tests assert:
//   - `forumApi.get` is invoked with the searchParams object form (never the
//     string-concatenated form)
//   - additional query params like `limit` are forwarded
//   - missing `postId` returns 400 INVALID_REQUEST
//   - ForumApiError is collapsed via the unified proxy-error helper

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForumApiError } from "@/lib/forum-api";

const getMock = vi.fn();

vi.mock("@/lib/forum-api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/forum-api")>("@/lib/forum-api");
	return {
		...actual,
		forumApi: {
			get: (...args: unknown[]) => getMock(...args),
		},
	};
});

beforeEach(() => {
	getMock.mockReset();
});

afterEach(() => {
	vi.resetModules();
});

function makeGetRequest(url: string): Request {
	return new Request(url, { method: "GET" });
}

describe("GET /api/v1/post-comments", () => {
	it("returns 400 INVALID_REQUEST when postId is missing", async () => {
		const { GET } = await import("@/app/api/v1/post-comments/route");
		const res = await GET(makeGetRequest("https://web.example.com/api/v1/post-comments"));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toEqual({
			error: { code: "INVALID_REQUEST", message: "postId is required" },
		});
		expect(getMock).not.toHaveBeenCalled();
	});

	it("calls forumApi.get with searchParams object form (no string concat)", async () => {
		getMock.mockResolvedValue({ data: [], meta: { timestamp: 0, requestId: "r1" } });
		const { GET } = await import("@/app/api/v1/post-comments/route");
		const res = await GET(
			makeGetRequest("https://web.example.com/api/v1/post-comments?postId=abc"),
		);
		expect(res.status).toBe(200);
		expect(getMock).toHaveBeenCalledTimes(1);
		const [path, params] = getMock.mock.calls[0];
		// Path must be the bare endpoint — no query string concatenated.
		expect(path).toBe("/api/v1/post-comments");
		expect(path).not.toContain("?");
		// SearchParams must be an object form passed as the second argument.
		expect(params).toBeTypeOf("object");
		expect(params).toMatchObject({ postId: "abc" });
	});

	it("forwards additional query params like limit through searchParams", async () => {
		getMock.mockResolvedValue({ data: [], meta: { timestamp: 0, requestId: "r1" } });
		const { GET } = await import("@/app/api/v1/post-comments/route");
		await GET(makeGetRequest("https://web.example.com/api/v1/post-comments?postId=abc&limit=20"));
		const [path, params] = getMock.mock.calls[0];
		expect(path).toBe("/api/v1/post-comments");
		expect(params).toMatchObject({ postId: "abc", limit: "20" });
	});

	it("does not concatenate hostile postId values into the URL string", async () => {
		// If GET ever string-concatenated, an attacker could try to break out of
		// the query string with `&` or `#`. With searchParams object form, the
		// helper URL-encodes the value safely.
		getMock.mockResolvedValue({ data: [], meta: { timestamp: 0, requestId: "r1" } });
		const { GET } = await import("@/app/api/v1/post-comments/route");
		await GET(
			makeGetRequest("https://web.example.com/api/v1/post-comments?postId=abc%26admin%3Dtrue"),
		);
		const [path, params] = getMock.mock.calls[0];
		expect(path).toBe("/api/v1/post-comments");
		expect(params.postId).toBe("abc&admin=true");
	});

	it("collapses ForumApiError into wrapped { error: { code, message } } and preserves status", async () => {
		const err = new ForumApiError(404, { code: "POST_NOT_FOUND", message: "Not found" });
		err.rawBody = { error: { code: "POST_NOT_FOUND", message: "Not found" } };
		getMock.mockRejectedValue(err);
		const { GET } = await import("@/app/api/v1/post-comments/route");
		const res = await GET(
			makeGetRequest("https://web.example.com/api/v1/post-comments?postId=abc"),
		);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "POST_NOT_FOUND", message: "Not found" } });
	});

	it("returns the Worker success body verbatim on 2xx", async () => {
		const ok = {
			data: [{ id: "c1", body: "hi" }],
			meta: { timestamp: 1, requestId: "r2", nextCursor: null },
		};
		getMock.mockResolvedValue(ok);
		const { GET } = await import("@/app/api/v1/post-comments/route");
		const res = await GET(
			makeGetRequest("https://web.example.com/api/v1/post-comments?postId=abc"),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual(ok);
	});
});
