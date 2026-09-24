import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-auth", () => ({ getWorkerJwt: vi.fn(async () => "verified-jwt") }));
vi.mock("@/lib/memory-runtime", () => ({ getMemoryRuntime: vi.fn(() => ({ clear: vi.fn() })) }));

import { POST as upload } from "@/app/api/v1/upload/route";
import { getMemoryRuntime } from "@/lib/memory-runtime";

// Real 1x1 JPEG generated through the same sharp the route uses.
const sharp = require("sharp") as typeof import("sharp");
const JPEG_1PX: Buffer = await sharp({
	create: { width: 1, height: 1, channels: 3, background: "#ffffff" },
})
	.jpeg()
	.toBuffer();

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const clear = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

function workerResponse(status: number): Response {
	return new Response(JSON.stringify({ data: { url: "avatars/guid.jpg" } }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function buildRequest(purpose: string): NextRequest {
	const formData = new FormData();
	formData.append("file", new Blob([new Uint8Array(JPEG_1PX)], { type: "image/jpeg" }), "a.jpg");
	formData.append("purpose", purpose);
	return new NextRequest("https://web.example.com/api/v1/upload", {
		method: "POST",
		headers: { Origin: "https://web.example.com" },
		body: formData,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getMemoryRuntime).mockReturnValue({ clear } as ReturnType<typeof getMemoryRuntime>);
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.FORUM_API_KEY = "forum-key";
	process.env.AUTH_URL = "https://web.example.com";
	fetchMock = vi.fn(async () => workerResponse(200));
	globalThis.fetch = fetchMock as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.FORUM_API_KEY = originalEnv.FORUM_API_KEY;
	process.env.AUTH_URL = originalEnv.AUTH_URL;
});

describe("upload route avatar display invalidation", () => {
	it("clears forum-summary and home-display after a successful avatar upload", async () => {
		const res = await upload(buildRequest("avatar"));

		expect(res.status).toBe(200);
		expect(clear.mock.calls).toEqual([
			["forum-summary"],
			["home-display"],
			["forum-list"],
			["thread-detail"],
		]);
	});

	it("does not invalidate for post-image uploads", async () => {
		const res = await upload(buildRequest("post-image"));

		expect(res.status).toBe(200);
		expect(clear).not.toHaveBeenCalled();
	});

	it("does not invalidate when the Worker rejects an avatar upload", async () => {
		fetchMock.mockResolvedValueOnce(workerResponse(413));

		const res = await upload(buildRequest("avatar"));

		expect(res.status).toBe(413);
		expect(clear).not.toHaveBeenCalled();
	});
});
