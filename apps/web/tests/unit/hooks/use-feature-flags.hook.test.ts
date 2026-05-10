// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { featureFlagsCache, useFeatureFlags } from "@/hooks/use-feature-flags";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("useFeatureFlags with real React", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Explicit reset — do not rely on test ordering for cache state.
		featureFlagsCache.clear();
	});

	it("fetches settings and resolves flags", async () => {
		// `apiClient.getRaw` (used by `fetchFeatureFlags`) reads via
		// `Response.text()`, so we mock a real Response — not a bare object.
		globalThis.fetch = vi.fn(async () =>
			jsonResponse({
				"features.content.allow_new_thread": "false",
				"features.content.allow_reply": "true",
				"features.access.maintenance_mode": "true",
				"features.access.maintenance_message": "停机",
				"features.access.require_login": "true",
			}),
		) as unknown as typeof fetch;

		const { result } = renderHook(() => useFeatureFlags());

		await waitFor(() => {
			expect(result.current.isLoading).toBe(false);
		});

		expect(result.current.canCreateThread).toBe(false);
		expect(result.current.canReply).toBe(true);
		expect(result.current.isMaintenanceMode).toBe(true);
		expect(result.current.maintenanceMessage).toBe("停机");
		expect(result.current.requireLogin).toBe(true);
	});

	it("handles fetch error and stops loading", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("network");
		}) as unknown as typeof fetch;

		const { result } = renderHook(() => useFeatureFlags());

		// Cold cache → effect rejects → loading clears.
		await waitFor(() => {
			expect(result.current.isLoading).toBe(false);
		});
	});

	it("seeds state from cached value on second mount (no loading frame)", async () => {
		globalThis.fetch = vi.fn(async () =>
			jsonResponse({
				"features.content.allow_new_thread": "true",
				"features.access.require_login": "false",
			}),
		) as unknown as typeof fetch;

		// Prime the cache with a successful load.
		const first = renderHook(() => useFeatureFlags());
		await waitFor(() => expect(first.result.current.isLoading).toBe(false));

		// Second mount must NOT show isLoading=true even for one render.
		const second = renderHook(() => useFeatureFlags());
		expect(second.result.current.isLoading).toBe(false);
		expect(second.result.current.canCreateThread).toBe(true);
	});
});
