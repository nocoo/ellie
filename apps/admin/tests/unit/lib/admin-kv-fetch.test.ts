// readAdminKvJson — unit coverage for the KV monitor first-screen loader.
//
// The KV monitor page used to silently turn 401 / 500 / non-JSON responses
// into a blank table because its loader had no catch and no res.ok check.
// These tests pin the contract so a future refactor can't reintroduce that
// silent-failure mode.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAdminKvJson } from "../../../src/lib/admin-kv-fetch";

const originalFetch = globalThis.fetch;

function mockFetch(body: unknown, init: { status?: number; bodyIsString?: boolean } = {}): void {
	const status = init.status ?? 200;
	const ok = status >= 200 && status < 300;
	const responseBody = init.bodyIsString ? (body as string) : JSON.stringify(body);
	globalThis.fetch = vi.fn(async () => {
		// Build a Response-like with the methods readAdminKvJson actually uses.
		return {
			ok,
			status,
			json: async () => {
				if (init.bodyIsString) {
					// Simulate non-JSON body.
					throw new SyntaxError("Unexpected token in JSON");
				}
				return JSON.parse(responseBody);
			},
		} as Response;
	}) as typeof fetch;
}

beforeEach(() => {
	globalThis.fetch = originalFetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("readAdminKvJson", () => {
	it("returns the data field on a 200 + valid envelope", async () => {
		mockFetch({ ok: true, data: { families: [{ family: "auth.session" }] } });
		const result = await readAdminKvJson<{ families: Array<{ family: string }> }>(
			"/api/admin/kv/overview",
		);
		expect(result.families).toHaveLength(1);
		expect(result.families[0].family).toBe("auth.session");
	});

	it("returns data even when families is an empty array (caller decides anomaly)", async () => {
		// The helper itself does NOT treat empty arrays as errors — that's a
		// page-level decision. Helper only enforces transport-level contract.
		mockFetch({ ok: true, data: { families: [] } });
		const result = await readAdminKvJson<{ families: unknown[] }>("/api/admin/kv/overview");
		expect(result.families).toEqual([]);
	});

	it("throws with worker error envelope on 401", async () => {
		mockFetch({ ok: false, error: { code: "UNAUTHORIZED", message: "未登录" } }, { status: 401 });
		await expect(readAdminKvJson("/api/admin/kv/overview")).rejects.toThrow(
			/HTTP 401.*UNAUTHORIZED.*未登录/,
		);
	});

	it("throws with bare HTTP status when worker error envelope is absent", async () => {
		mockFetch(null, { status: 500, bodyIsString: true });
		await expect(readAdminKvJson("/api/admin/kv/overview")).rejects.toThrow(/HTTP 500/);
	});

	it("throws on 200 with non-JSON body", async () => {
		mockFetch("<html>nginx 502</html>", { status: 200, bodyIsString: true });
		await expect(readAdminKvJson("/api/admin/kv/overview")).rejects.toThrow(/响应不是合法 JSON/);
	});

	it("throws when 200 envelope is missing the data field", async () => {
		mockFetch({ ok: true });
		await expect(readAdminKvJson("/api/admin/kv/overview")).rejects.toThrow(/响应缺少 data 字段/);
	});

	it("propagates network throw without swallowing", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new TypeError("Failed to fetch");
		}) as typeof fetch;
		await expect(readAdminKvJson("/api/admin/kv/overview")).rejects.toThrow(/Failed to fetch/);
	});
});
