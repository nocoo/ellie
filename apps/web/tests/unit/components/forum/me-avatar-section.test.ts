// @vitest-environment happy-dom
// Tests for MeAvatarSection — verifies the avatar uploader landing point at
// /me#avatar wires AvatarUpload's onUploadComplete to avatar-version updates
// and router.refresh().
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

const mockUpdateVersion = vi.fn();
vi.mock("@/contexts/avatar-context", () => ({
	useAvatarUrl: (uid: number) => `/api/avatar/${uid}`,
	useAvatarVersion: () => ({ updateVersion: mockUpdateVersion }),
}));

// Capture the props handed to AvatarUpload so we can drive its callback.
const lastAvatarUploadProps: {
	currentUrl?: string;
	onUploadComplete?: (newUrl: string) => void;
} = {};

vi.mock("@/components/forum/avatar-upload", () => ({
	AvatarUpload: (props: {
		currentUrl: string;
		onUploadComplete: (newUrl: string) => void;
	}) => {
		lastAvatarUploadProps.currentUrl = props.currentUrl;
		lastAvatarUploadProps.onUploadComplete = props.onUploadComplete;
		return createElement(
			"div",
			{ "data-testid": "avatar-upload-stub" },
			`upload-for:${props.currentUrl}`,
		);
	},
}));

import { MeAvatarSection } from "@/components/forum/me-avatar-section";

afterEach(() => {
	cleanup();
	mockRefresh.mockReset();
	mockUpdateVersion.mockReset();
	lastAvatarUploadProps.currentUrl = undefined;
	lastAvatarUploadProps.onUploadComplete = undefined;
});

describe("MeAvatarSection", () => {
	it("renders heading and passes the user's avatar URL to AvatarUpload", () => {
		render(createElement(MeAvatarSection, { userId: 42 }));

		expect(screen.getByText("头像")).toBeTruthy();
		expect(screen.getByTestId("avatar-upload-stub")).toBeTruthy();
		expect(lastAvatarUploadProps.currentUrl).toBe("/api/avatar/42");
	});

	it("on upload complete: parses ?v= version, updates avatar version, refreshes router", () => {
		render(createElement(MeAvatarSection, { userId: 42 }));

		const cb = lastAvatarUploadProps.onUploadComplete;
		expect(cb).toBeTypeOf("function");
		cb?.("/api/avatar/42?v=1712678400000");

		expect(mockUpdateVersion).toHaveBeenCalledWith(42, 1712678400000);
		expect(mockRefresh).toHaveBeenCalledTimes(1);
	});

	it("falls back to Date.now() when the URL has no ?v= param", () => {
		const now = 1_700_000_000_000;
		const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			render(createElement(MeAvatarSection, { userId: 7 }));
			lastAvatarUploadProps.onUploadComplete?.("/api/avatar/7");
			expect(mockUpdateVersion).toHaveBeenCalledWith(7, now);
		} finally {
			dateSpy.mockRestore();
		}
	});
});
