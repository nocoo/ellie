// @vitest-environment happy-dom
// Tests for MeAvatarSection — verifies the avatar uploader landing point at
// /me#avatar wires AvatarUpload's onUploadComplete to saved-avatar updates
// and router.refresh().
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

const mockUpdateAvatar = vi.fn();
vi.mock("@/contexts/avatar-context", () => ({
	useAvatarUrl: (uid: number) => `/api/avatar/${uid}`,
	useAvatarContext: () => ({ updateAvatar: mockUpdateAvatar }),
}));

// Capture the props handed to AvatarUpload so we can drive its callback.
const lastAvatarUploadProps: {
	currentUrl?: string;
	onUploadComplete?: (newUrl: string) => void;
} = {};

vi.mock("@/components/forum/avatar-upload", () => ({
	AvatarUpload: (props: { currentUrl: string; onUploadComplete: (newUrl: string) => void }) => {
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
	mockUpdateAvatar.mockReset();
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

	it("propagates each uploaded immutable URL before refreshing server data", () => {
		render(createElement(MeAvatarSection, { userId: 42 }));
		for (const url of ["https://t.no.mt/avatars/first.jpg", "https://t.no.mt/avatars/second.jpg"]) {
			lastAvatarUploadProps.onUploadComplete?.(url);
			expect(mockUpdateAvatar).toHaveBeenLastCalledWith(42, url);
		}
		expect(mockRefresh).toHaveBeenCalledTimes(2);
	});
});
