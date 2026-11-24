// @vitest-environment happy-dom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchFeatureSettings } = vi.hoisted(() => ({
	mockFetchFeatureSettings: vi.fn(),
}));

vi.mock("@/viewmodels/admin/features", async () => {
	const actual = await vi.importActual<typeof import("@/viewmodels/admin/features")>(
		"@/viewmodels/admin/features",
	);
	return {
		...actual,
		fetchFeatureSettings: mockFetchFeatureSettings,
	};
});

import {
	settingsFromMap,
	useWritePermissionSettings,
} from "@/viewmodels/admin/use-write-permission-settings";

describe("settingsFromMap", () => {
	it("applies FEATURE_DEFAULTS when map is empty", () => {
		expect(settingsFromMap({})).toEqual({
			allowNewThread: true,
			allowReply: true,
			postingRestrictionsEnabled: true,
			minRegistrationDays: 1,
			requireAvatar: true,
		});
	});

	it("maps explicit string overrides", () => {
		expect(
			settingsFromMap({
				"features.content.allow_new_thread": "false",
				"features.content.allow_reply": "false",
				"features.posting.enabled": "false",
				"features.posting.min_registration_days": "7",
				"features.posting.require_avatar": "false",
			}),
		).toEqual({
			allowNewThread: false,
			allowReply: false,
			postingRestrictionsEnabled: false,
			minRegistrationDays: 7,
			requireAvatar: false,
		});
	});
});

describe("useWritePermissionSettings", () => {
	beforeEach(() => {
		mockFetchFeatureSettings.mockReset();
	});

	it("loads and maps feature settings on mount", async () => {
		mockFetchFeatureSettings.mockResolvedValueOnce({
			"features.content.allow_new_thread": { value: "false", type: "boolean", updatedAt: 1 },
			"features.posting.min_registration_days": { value: "3", type: "number", updatedAt: 1 },
		});

		const { result } = renderHook(() => useWritePermissionSettings());
		expect(result.current.loading).toBe(true);

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.error).toBeNull();
		expect(result.current.settings.allowNewThread).toBe(false);
		expect(result.current.settings.minRegistrationDays).toBe(3);
	});

	it("surfaces Error message on failure and keeps defaults", async () => {
		mockFetchFeatureSettings.mockRejectedValueOnce(new Error("Network failure"));

		const { result } = renderHook(() => useWritePermissionSettings());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.error).toBe("Network failure");
		expect(result.current.settings).toEqual(settingsFromMap({}));
	});

	it("falls back to default Chinese error on non-Error rejection", async () => {
		mockFetchFeatureSettings.mockRejectedValueOnce("unexpected");

		const { result } = renderHook(() => useWritePermissionSettings());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.error).toBe("settings 读取失败，使用默认值");
	});

	it("ignores late resolution after unmount", async () => {
		let resolvePending!: (
			val: Record<string, { value: string; type: "string"; updatedAt: number }>,
		) => void;
		mockFetchFeatureSettings.mockReturnValueOnce(
			new Promise((resolve) => {
				resolvePending = resolve;
			}),
		);

		const { result, unmount } = renderHook(() => useWritePermissionSettings());
		unmount();
		resolvePending({
			"features.content.allow_reply": { value: "false", type: "string", updatedAt: 1 },
		});
		await Promise.resolve();
		expect(result.current.loading).toBe(true);
	});
});
