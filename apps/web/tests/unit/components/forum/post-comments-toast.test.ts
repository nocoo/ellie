// @vitest-environment happy-dom
// Tests for CommentDialog toast integration in post-comments.tsx
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock apiClient before importing component
vi.mock("@/lib/api-client", () => ({
	apiClient: {
		post: vi.fn(),
		get: vi.fn(),
	},
}));

// Mock next/link as a passthrough
vi.mock("next/link", () => ({
	default: ({ children, href }: { children: unknown; href: string }) =>
		createElement("a", { href }, children),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostComments } from "@/components/forum/post-comments";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPostComments() {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(PostComments, {
				postId: 1,
				isLoggedIn: true,
				threadClosed: false,
				dialogOpen: true,
				onDialogOpenChange: vi.fn(),
			}),
		),
	);
}

/** Set input value in a way that triggers React onChange */
function setInputValue(input: HTMLElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	fireEvent.input(input, { target: { value } });
	fireEvent.change(input, { target: { value } });
}

function pressEnter(input: HTMLElement, ctrlKey = false) {
	fireEvent.keyDown(input, { key: "Enter", ctrlKey });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CommentDialog toast integration", () => {
	beforeEach(() => {
		vi.mocked(apiClient.get).mockResolvedValue({ data: [] } as any);
		vi.mocked(apiClient.post).mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows success toast on successful submit", async () => {
		vi.mocked(apiClient.post).mockResolvedValueOnce({
			data: { id: 99, postId: 1, authorId: 1, authorName: "t", content: "hi", createdAt: 1 },
		} as any);

		renderPostComments();
		await act(async () => {});

		const input = screen.getByPlaceholderText("写下你的点评（最多255字）");
		await act(async () => {
			setInputValue(input, "测试点评");
		});

		pressEnter(input);
		expect(apiClient.post).not.toHaveBeenCalled();

		await act(async () => {
			pressEnter(input, true);
		});

		await waitFor(() => {
			expect(screen.getByText("点评已发送")).toBeTruthy();
		});
	});

	it("shows error toast with ApiError message on failure", async () => {
		// ApiError(status, code, message)
		vi.mocked(apiClient.post).mockRejectedValueOnce(
			new ApiError(400, "CONTENT_FORBIDDEN", "内容包含违禁词"),
		);

		renderPostComments();
		await act(async () => {});

		const input = screen.getByPlaceholderText("写下你的点评（最多255字）");
		await act(async () => {
			setInputValue(input, "违禁内容");
		});

		await act(async () => {
			pressEnter(input, true);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("点评发送失败"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("内容包含违禁词");
		});
		expect(
			(screen.getByPlaceholderText("写下你的点评（最多255字）") as HTMLTextAreaElement).value,
		).toBe("违禁内容");
	});

	it("shows fallback error toast for non-ApiError failures", async () => {
		vi.mocked(apiClient.post).mockRejectedValueOnce(new Error("network timeout"));

		renderPostComments();
		await act(async () => {});

		const input = screen.getByPlaceholderText("写下你的点评（最多255字）");
		await act(async () => {
			setInputValue(input, "test");
		});

		await act(async () => {
			pressEnter(input, true);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("点评发送失败"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("发送失败，请稍后重试");
		});
	});

	it("retains inline error in dialog alongside toast", async () => {
		vi.mocked(apiClient.post).mockRejectedValueOnce(
			new ApiError(400, "CONTENT_TOO_LONG", "字数超限"),
		);

		renderPostComments();
		await act(async () => {});

		const input = screen.getByPlaceholderText("写下你的点评（最多255字）");
		await act(async () => {
			setInputValue(input, "too long");
		});

		await act(async () => {
			pressEnter(input, true);
		});

		await waitFor(() => {
			// Inline error <p> in dialog + toast description both show the message
			const matches = screen.getAllByText("字数超限");
			expect(matches.length).toBeGreaterThanOrEqual(2);
		});
		expect(
			(screen.getByPlaceholderText("写下你的点评（最多255字）") as HTMLTextAreaElement).value,
		).toBe("too long");
	});

	it("shows an inline error without toast when the comment is empty", async () => {
		renderPostComments();
		await act(async () => {});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		expect(screen.getByText("请输入点评内容")).toBeTruthy();
		expect(screen.queryByText("点评发送失败")).toBeNull();
		expect(apiClient.post).not.toHaveBeenCalled();
	});
});
