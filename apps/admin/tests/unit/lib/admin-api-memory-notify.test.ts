import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/web-memory-notify", () => ({ notifyWebDisplayInvalidation: vi.fn() }));
vi.mock("next/server", () => ({
	after: vi.fn((task: () => unknown) => {
		task();
	}),
}));

import { after } from "next/server";
import { adminApi, adminApiAs } from "@/lib/admin-api";
import { notifyWebDisplayInvalidation } from "@/lib/web-memory-notify";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let mockFetchFn: ReturnType<typeof vi.fn>;

function mockResponse(status: number, body: unknown) {
	mockFetchFn = vi.fn(() =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as any;
}

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com/";
	process.env.ADMIN_API_KEY = "test-key-123";
	process.env.WEB_MEMORY_ADMIN_URL = "https://web.example.com";
	process.env.MEMORY_CACHE_ADMIN_KEY = "memory-key";
	mockResponse(200, { data: { ok: true }, meta: { timestamp: 1, requestId: "r1" } });
	vi.mocked(notifyWebDisplayInvalidation).mockReset();
	vi.mocked(after).mockClear();
	vi.mocked(after).mockImplementation((task: () => unknown) => {
		task();
	});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
	process.env.WEB_MEMORY_ADMIN_URL = originalEnv.WEB_MEMORY_ADMIN_URL;
	process.env.MEMORY_CACHE_ADMIN_KEY = originalEnv.MEMORY_CACHE_ADMIN_KEY;
});

describe("adminApi central memory-notify hook", () => {
	it("fires after a successful typed mutation on a relevant path", async () => {
		await adminApi.post("/api/admin/threads/batch-delete", { ids: [1, 2] });
		expect(notifyWebDisplayInvalidation).toHaveBeenCalledTimes(1);
	});

	it("fires for typed patch and delete on relevant paths", async () => {
		await adminApi.patch("/api/admin/users/5", { role: 1 });
		await adminApi.delete("/api/admin/forums/3");
		expect(notifyWebDisplayInvalidation).toHaveBeenCalledTimes(2);
	});

	it("does not fire for reads even on relevant paths", async () => {
		await adminApi.get("/api/admin/users");
		await adminApi.getList("/api/admin/threads");
		expect(notifyWebDisplayInvalidation).not.toHaveBeenCalled();
	});

	it("does not fire for excluded KV-only tools", async () => {
		await adminApi.post("/api/admin/kv/refresh", { keys: ["a"] });
		await adminApi.raw("POST", "/api/admin/kv/rebuild", {});
		expect(notifyWebDisplayInvalidation).not.toHaveBeenCalled();
	});

	it("does not fire for admin checkin management routes", async () => {
		await adminApi.raw("POST", "/api/admin/users/7/checkins", {});
		expect(notifyWebDisplayInvalidation).not.toHaveBeenCalled();
	});

	it("does not fire when the Worker mutation fails", async () => {
		mockResponse(500, { error: { code: "INTERNAL", message: "boom" } });
		await expect(adminApi.post("/api/admin/threads/batch-delete", {})).rejects.toThrow();
		mockResponse(500, { error: { code: "INTERNAL", message: "boom" } });
		const res = await adminApi.raw("PATCH", "/api/admin/settings/1", {});
		expect(res.status).toBe(500);
		expect(notifyWebDisplayInvalidation).not.toHaveBeenCalled();
	});

	it("fires for successful raw mutations including actor-bound calls", async () => {
		await adminApi.raw("PATCH", "/api/admin/settings", { key: "x" });
		expect(notifyWebDisplayInvalidation).toHaveBeenCalledTimes(1);
		await adminApiAs({ email: "a@example.com", name: "A" }).raw(
			"POST",
			"/api/admin/forums/3/merge",
			{
				target: 4,
			},
		);
		expect(notifyWebDisplayInvalidation).toHaveBeenCalledTimes(2);
	});

	it("fires for admin post edits and deletes", async () => {
		await adminApi.patch("/api/admin/posts/9", { content: "x" });
		await adminApi.delete("/api/admin/posts/9");
		await adminApi.raw("POST", "/api/admin/posts/batch-delete", { ids: [9] });
		expect(notifyWebDisplayInvalidation).toHaveBeenCalledTimes(3);
	});

	it("does not fire for the posts list read", async () => {
		await adminApi.get("/api/admin/posts");
		expect(notifyWebDisplayInvalidation).not.toHaveBeenCalled();
	});

	it("invalidates cached attachments after single and batch deletes, preserving failures and reads", async () => {
		await adminApi.raw("DELETE", "/api/admin/attachments/9");
		await adminApi.raw("POST", "/api/admin/attachments/batch-delete", { ids: [9] });
		expect(notifyWebDisplayInvalidation).toHaveBeenCalledTimes(2);
		vi.mocked(notifyWebDisplayInvalidation).mockClear();
		await adminApi.raw("GET", "/api/admin/attachments/9");
		mockResponse(403, { error: { code: "FORBIDDEN", message: "Denied" } });
		await adminApi.raw("DELETE", "/api/admin/attachments/9");
		await adminApi.raw("POST", "/api/admin/attachments/batch-delete", { ids: [9] });
		expect(notifyWebDisplayInvalidation).not.toHaveBeenCalled();
	});

	it("fires for calibration, recalc jobs and thread recalculation that change cached numbers", async () => {
		await adminApi.post("/api/admin/stats/calibrate", { mode: "full" });
		await adminApi.post("/api/admin/statistics/recalc-forums");
		await adminApi.post("/api/admin/statistics/recalc-threads");
		expect(notifyWebDisplayInvalidation).toHaveBeenCalledTimes(3);
	});

	it("degrades to fire-and-forget when after() scheduling fails without erroring the write", async () => {
		vi.mocked(after).mockImplementationOnce(() => {
			throw new Error("after was called outside a request scope");
		});
		const result = await adminApi.post("/api/admin/threads/batch-delete", { ids: [1] });
		expect(result.data).toEqual({ ok: true });
		expect(notifyWebDisplayInvalidation).toHaveBeenCalledTimes(1);
	});
});
