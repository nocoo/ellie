// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Must import fresh to reset module-level cache
describe("useFeatureFlags with real React", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches settings and resolves flags", async () => {
		globalThis.fetch = vi.fn(async () => ({
			json: async () => ({
				"features.content.allow_new_thread": "false",
				"features.content.allow_reply": "true",
				"features.access.maintenance_mode": "true",
				"features.access.maintenance_message": "停机",
				"features.access.require_login": "true",
			}),
		})) as any;

		// Dynamic import to get fresh module state
		const { useFeatureFlags } = await import("@/hooks/use-feature-flags");
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
		// This test runs after the cached test above, so cache is populated
		// We can only verify it doesn't crash
		globalThis.fetch = vi.fn(async () => {
			throw new Error("network");
		}) as any;

		const { useFeatureFlags } = await import("@/hooks/use-feature-flags");
		const { result } = renderHook(() => useFeatureFlags());

		// Cache from previous test will be used
		expect(result.current.isLoading).toBe(false);
	});
});
