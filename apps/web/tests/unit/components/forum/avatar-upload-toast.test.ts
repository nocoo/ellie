// @vitest-environment happy-dom
// Tests for AvatarUpload toast integration
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock parseAvatarUploadResponse
const mockParseAvatarUploadResponse = vi.fn();
vi.mock("@/viewmodels/forum/avatar-upload", () => ({
	parseAvatarUploadResponse: (...args: any[]) => mockParseAvatarUploadResponse(...args),
}));

// Mock email-not-verified dispatch
const mockDispatchEmailNotVerified = vi.fn();
vi.mock("@/viewmodels/forum/email-not-verified-dispatch", () => ({
	dispatchEmailNotVerified: (...args: any[]) => mockDispatchEmailNotVerified(...args),
	isEmailNotVerifiedPayloadClient: vi.fn(),
	pickDialogPayload: vi.fn(),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import { AvatarUpload } from "@/components/forum/avatar-upload";
import { ForumToastProvider } from "@/components/forum/forum-toast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderUpload(props: Partial<Parameters<typeof AvatarUpload>[0]> = {}) {
	const onUploadComplete = vi.fn();
	return {
		onUploadComplete,
		...render(
			createElement(
				ForumToastProvider,
				null,
				createElement(AvatarUpload, {
					currentUrl: "/avatars/default.png",
					onUploadComplete,
					...props,
				}),
			),
		),
	};
}

function createFile(name = "avatar.png", type = "image/png", size = 1024): File {
	const content = new Array(size).fill("a").join("");
	return new File([content], name, { type });
}

function getFileInput(): HTMLInputElement {
	const input = document.querySelector('input[type="file"]') as HTMLInputElement;
	if (!input) throw new Error("File input not found");
	return input;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AvatarUpload toast integration", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockParseAvatarUploadResponse.mockReset();
		mockDispatchEmailNotVerified.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows success toast on avatar upload", async () => {
		mockFetch.mockResolvedValueOnce({
			status: 200,
			json: async () => ({ data: { url: "/avatars/new.png", size: 1024 } }),
		});
		mockParseAvatarUploadResponse.mockReturnValueOnce({
			kind: "success",
			url: "/avatars/new.png",
			size: 1024,
		});

		renderUpload();
		const input = getFileInput();

		await act(async () => {
			fireEvent.change(input, { target: { files: [createFile()] } });
		});

		await waitFor(() => {
			expect(screen.getByText("头像已上传")).toBeTruthy();
		});
	});

	it("shows error toast on invalid file format", async () => {
		renderUpload();
		const input = getFileInput();

		// BMP is not in ALLOWED_TYPES
		const bmpFile = createFile("avatar.bmp", "image/bmp", 1024);

		await act(async () => {
			fireEvent.change(input, { target: { files: [bmpFile] } });
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("仅支持 JPG 和 PNG 格式"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("头像上传失败");
		});
		// Should not call fetch
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("shows error toast on file too large", async () => {
		renderUpload();
		const input = getFileInput();

		// 300 KB > 200 KB limit
		const largeFile = createFile("avatar.png", "image/png", 300 * 1024);

		await act(async () => {
			fireEvent.change(input, { target: { files: [largeFile] } });
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("文件大小不能超过 200 KB"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("头像上传失败");
		});
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("shows error toast on parsed error response", async () => {
		mockFetch.mockResolvedValueOnce({
			status: 413,
			json: async () => ({ error: { message: "服务器拒绝了该文件" } }),
		});
		mockParseAvatarUploadResponse.mockReturnValueOnce({
			kind: "error",
			message: "服务器拒绝了该文件",
		});

		renderUpload();
		const input = getFileInput();

		await act(async () => {
			fireEvent.change(input, { target: { files: [createFile()] } });
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("服务器拒绝了该文件"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("头像上传失败");
		});
	});

	it("shows error toast on email-not-verified response", async () => {
		mockFetch.mockResolvedValueOnce({
			status: 403,
			json: async () => ({ error: "EMAIL_NOT_VERIFIED" }),
		});
		mockParseAvatarUploadResponse.mockReturnValueOnce({
			kind: "email-not-verified",
			detail: { verifyUrl: "/verify" },
		});

		renderUpload();
		const input = getFileInput();

		await act(async () => {
			fireEvent.change(input, { target: { files: [createFile()] } });
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("请先验证邮箱后再上传头像"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("头像上传失败");
		});
		expect(mockDispatchEmailNotVerified).toHaveBeenCalled();
	});

	it("shows error toast on network failure (catch branch)", async () => {
		mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

		renderUpload();
		const input = getFileInput();

		await act(async () => {
			fireEvent.change(input, { target: { files: [createFile()] } });
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("上传失败，请重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("头像上传失败");
		});
	});
});
