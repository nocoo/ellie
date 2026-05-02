// R2-C: lock the call shape for the PostComments fetch.
//
// Server R1-C already stopped the proxy from string-concatenating
// `?postId=...` into the Worker URL. The browser-side `apiClient.get` call
// must use the same searchParams object form so the helper handles encoding
// and undefined/null filtering instead of bypassing it. This test asserts
// the URL the browser actually emits — bare path + URLSearchParams query —
// without mounting the React component.

import { apiClient } from "@/lib/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function mockSuccess(data: unknown) {
	fetchMock = vi.fn(() =>
		Promise.resolve(
			new Response(JSON.stringify({ data, meta: { timestamp: 1, requestId: "r1" } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		),
	);
	globalThis.fetch = fetchMock as typeof fetch;
}

beforeEach(() => {
	mockSuccess([]);
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("PostComments fetch — apiClient call shape", () => {
	it("emits a request with searchParams encoded by URLSearchParams (no string concat)", async () => {
		await apiClient.get<unknown>("/api/v1/post-comments", { postId: 42 });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [urlArg] = fetchMock.mock.calls[0] as [string, RequestInit];
		const url = new URL(urlArg);
		expect(url.pathname).toBe("/api/v1/post-comments");
		// `URLSearchParams.set` always emits the key-value form; we should
		// see exactly one `postId=42` and no extras.
		expect(url.searchParams.get("postId")).toBe("42");
		expect([...url.searchParams.keys()]).toEqual(["postId"]);
	});

	it("URL-encodes hostile postId values instead of letting them break out of the query", async () => {
		// If the call site went back to string-concat (`?postId=${postId}`),
		// a value like `1&admin=true` would inject an extra param. With the
		// searchParams object form, the helper escapes `&` to `%26` so the
		// Worker sees the literal value.
		await apiClient.get<unknown>("/api/v1/post-comments", { postId: "1&admin=true" });
		const [urlArg] = fetchMock.mock.calls[0] as [string, RequestInit];
		const url = new URL(urlArg);
		expect(url.searchParams.get("postId")).toBe("1&admin=true");
		expect(url.searchParams.has("admin")).toBe(false);
		// Raw query string must contain the URL-encoded form.
		expect(url.search).toContain("postId=1%26admin%3Dtrue");
	});

	it("omits undefined/null/empty extras (apiClient skips them)", async () => {
		await apiClient.get<unknown>("/api/v1/post-comments", {
			postId: 7,
			limit: undefined,
			cursor: null,
			ignored: "",
		});
		const [urlArg] = fetchMock.mock.calls[0] as [string, RequestInit];
		const url = new URL(urlArg);
		expect([...url.searchParams.keys()]).toEqual(["postId"]);
	});
});
