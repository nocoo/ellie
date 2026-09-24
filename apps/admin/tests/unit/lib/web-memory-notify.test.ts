import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { notifyWebDisplayInvalidation } from "@/lib/web-memory-notify";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function overview(id: string): Response {
	return jsonResponse(200, { data: { instance: { id } } });
}

beforeEach(() => {
	process.env.WEB_MEMORY_ADMIN_URL = "https://web.example.com";
	process.env.MEMORY_CACHE_ADMIN_KEY = "memory-key";
	fetchMock = vi.fn();
	globalThis.fetch = fetchMock as typeof fetch;
	warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WEB_MEMORY_ADMIN_URL = originalEnv.WEB_MEMORY_ADMIN_URL;
	process.env.MEMORY_CACHE_ADMIN_KEY = originalEnv.MEMORY_CACHE_ADMIN_KEY;
	vi.restoreAllMocks();
});

describe("notifyWebDisplayInvalidation", () => {
	it("clears all display families in one family-less clear after fetching the instance", async () => {
		fetchMock
			.mockResolvedValueOnce(overview("inst-1"))
			.mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));

		await notifyWebDisplayInvalidation();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [getUrl, getOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(String(getUrl)).toBe("https://web.example.com/api/internal/memory-cache?page=1&limit=1");
		expect(getOpts.method).toBeUndefined();
		expect((getOpts.headers as Record<string, string>)["X-Ellie-Memory-Key"]).toBe("memory-key");
		const [postUrl, postOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(String(postUrl)).toBe("https://web.example.com/api/internal/memory-cache");
		expect(postOpts.method).toBe("POST");
		expect(JSON.parse(String(postOpts.body))).toEqual({ instanceId: "inst-1", action: "clear" });
		expect(warn).not.toHaveBeenCalled();
	});

	it("retries once with a fresh instance id after a 409 conflict", async () => {
		fetchMock
			.mockResolvedValueOnce(overview("inst-1"))
			.mockResolvedValueOnce(jsonResponse(409, { error: { code: "INSTANCE_CONFLICT" } }))
			.mockResolvedValueOnce(overview("inst-2"))
			.mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));

		await notifyWebDisplayInvalidation();

		expect(fetchMock).toHaveBeenCalledTimes(4);
		const [, retryOpts] = fetchMock.mock.calls[3] as [string, RequestInit];
		expect(JSON.parse(String(retryOpts.body))).toEqual({ instanceId: "inst-2", action: "clear" });
		expect(warn).not.toHaveBeenCalled();
	});

	it("falls back to TTL convergence after a persistent conflict without looping", async () => {
		const conflict = () => jsonResponse(409, { error: { code: "INSTANCE_CONFLICT" } });
		fetchMock
			.mockResolvedValueOnce(overview("inst-1"))
			.mockImplementationOnce(() => Promise.resolve(conflict()))
			.mockResolvedValueOnce(overview("inst-1"))
			.mockImplementationOnce(() => Promise.resolve(conflict()));

		await notifyWebDisplayInvalidation();

		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(warn).toHaveBeenCalled();
	});

	it("warns and swallows when the overview request fails", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: "UPSTREAM_UNAVAILABLE" } }));

		await expect(notifyWebDisplayInvalidation()).resolves.toBeUndefined();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalled();
	});

	it("is a silent no-op without configuration", async () => {
		delete process.env.WEB_MEMORY_ADMIN_URL;

		await notifyWebDisplayInvalidation();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it("rejects a malformed web origin without any request", async () => {
		process.env.WEB_MEMORY_ADMIN_URL = "https://web.example.com/some/path";

		await notifyWebDisplayInvalidation();

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
