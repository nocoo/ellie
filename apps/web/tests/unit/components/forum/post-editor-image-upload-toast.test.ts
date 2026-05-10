// @vitest-environment happy-dom
// Tests for ImageUploadButton toast integration in PostEditor
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock parsePostImageUploadResponse
const mockParsePostImageUploadResponse = vi.fn();
vi.mock("@/viewmodels/forum/post-image-upload", () => ({
	parsePostImageUploadResponse: (...args: any[]) => mockParsePostImageUploadResponse(...args),
}));

// Mock email-not-verified dispatch
const mockDispatchEmailNotVerified = vi.fn();
vi.mock("@/viewmodels/forum/email-not-verified-dispatch", () => ({
	dispatchEmailNotVerified: (...args: any[]) => mockDispatchEmailNotVerified(...args),
	isEmailNotVerifiedPayloadClient: vi.fn(),
	pickDialogPayload: vi.fn(),
}));

// Mock next/navigation
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

// Mock next/link
vi.mock("next/link", () => ({
	default: ({ children, href }: { children: unknown; href: string }) =>
		createElement("a", { href }, children),
}));

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostEditor } from "@/components/forum/post-editor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderEditor() {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(PostEditor, {
				initialContent: "<p>Hello</p>",
				onSubmit: vi.fn(),
				placeholder: "Write...",
				maxLength: 10000,
				submitting: false,
				canSubmit: true,
			}),
		),
	);
}

function createFile(name = "test.png", type = "image/png"): File {
	return new File(["fakecontent"], name, { type });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ImageUploadButton toast integration", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockParsePostImageUploadResponse.mockReset();
		mockDispatchEmailNotVerified.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows success toast on image upload", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse(
				{ data: { url: "https://cdn.example.com/img.png", size: 1024, contentType: "image/png" } },
				200,
			),
		);
		mockParsePostImageUploadResponse.mockReturnValueOnce({
			kind: "success",
			url: "https://cdn.example.com/img.png",
			size: 1024,
			contentType: "image/png",
		});

		renderEditor();

		// Find the image upload input
		const input = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
		expect(input).toBeTruthy();

		await act(async () => {
			fireEvent.change(input, { target: { files: [createFile()] } });
		});

		await waitFor(() => {
			expect(screen.getByText("图片已上传")).toBeTruthy();
		});
	});

	it("shows error toast on parsed error response", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: "文件大小超过限制" } }, 413));
		mockParsePostImageUploadResponse.mockReturnValueOnce({
			kind: "error",
			message: "文件大小超过限制",
		});

		renderEditor();

		const input = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
		expect(input).toBeTruthy();

		await act(async () => {
			fireEvent.change(input, { target: { files: [createFile()] } });
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("文件大小超过限制"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("图片上传失败");
		});
	});

	it("shows error toast on email-not-verified response", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ error: "EMAIL_NOT_VERIFIED" }, 403));
		mockParsePostImageUploadResponse.mockReturnValueOnce({
			kind: "email-not-verified",
			detail: { verifyUrl: "/verify" },
		});

		renderEditor();

		const input = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
		expect(input).toBeTruthy();

		await act(async () => {
			fireEvent.change(input, { target: { files: [createFile()] } });
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("请先验证邮箱后再上传图片"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("图片上传失败");
		});
		expect(mockDispatchEmailNotVerified).not.toHaveBeenCalled();
	});

	it("shows error toast on fetch/network failure (catch branch)", async () => {
		mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

		renderEditor();

		const input = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
		expect(input).toBeTruthy();

		await act(async () => {
			fireEvent.change(input, { target: { files: [createFile()] } });
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("上传失败，请重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("图片上传失败");
		});
	});
});
