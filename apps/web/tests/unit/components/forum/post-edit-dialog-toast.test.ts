// @vitest-environment happy-dom
// Tests for PostEditDialog toast integration
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock moderation API
const mockEditMyPost = vi.fn(async () => {});
const mockEditPost = vi.fn(async () => {});
vi.mock("@/lib/moderation-api", () => ({
	editMyPost: (...args: any[]) => mockEditMyPost(...args),
	editPost: (...args: any[]) => mockEditPost(...args),
	deleteMyPost: vi.fn(),
	deletePost: vi.fn(),
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

// Mock PostEditor — expose a ref with getHTML and trigger onSubmit via a button
let mockEditorContent = "<p>Valid edited content here</p>";
vi.mock("@/components/forum/post-editor", () => ({
	PostEditor: forwardRef(function MockPostEditor(props: any, ref: any) {
		useImperativeHandle(ref, () => ({
			getHTML: () => mockEditorContent,
		}));
		return createElement("div", { "data-testid": "mock-editor" }, [
			createElement(
				"button",
				{
					key: "submit",
					type: "button",
					onClick: () => props.onSubmit?.(mockEditorContent),
					"data-testid": "editor-submit",
				},
				"EditorSubmit",
			),
		]);
	}),
}));

vi.mock("@/lib/api-client", () => ({
	ApiError: class ApiError extends Error {
		message: string;
		constructor(m: string) {
			super(m);
			this.message = m;
		}
	},
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostEditDialog } from "@/components/forum/post-edit-dialog";
import { ApiError } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDialog(props: Partial<Parameters<typeof PostEditDialog>[0]> = {}) {
	const onOpenChange = vi.fn();
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(PostEditDialog, {
				open: true,
				onOpenChange,
				postId: 1,
				currentContent: "<p>Original</p>",
				isOwnPost: true,
				canModerate: false,
				...props,
			}),
		),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PostEditDialog toast integration", () => {
	beforeEach(() => {
		mockEditMyPost.mockReset();
		mockEditPost.mockReset();
		mockRefresh.mockReset();
		mockEditorContent = "<p>Valid edited content here</p>";
	});

	afterEach(() => {
		cleanup();
	});

	it("shows success toast on save", async () => {
		mockEditMyPost.mockResolvedValueOnce(undefined);

		renderDialog();

		const submitBtn = screen.getByTestId("editor-submit");
		await act(async () => {
			fireEvent.click(submitBtn);
		});

		await waitFor(() => {
			expect(screen.getByText("回复已保存")).toBeTruthy();
		});
		expect(mockRefresh).toHaveBeenCalled();
	});

	it("shows error toast with ApiError message on save failure", async () => {
		mockEditMyPost.mockRejectedValueOnce(new ApiError("内容包含敏感词"));

		renderDialog();

		const submitBtn = screen.getByTestId("editor-submit");
		await act(async () => {
			fireEvent.click(submitBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("内容包含敏感词"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("保存失败");
		});
	});

	it("shows fallback error toast on non-ApiError failure", async () => {
		mockEditMyPost.mockRejectedValueOnce(new Error("network"));

		renderDialog();

		const submitBtn = screen.getByTestId("editor-submit");
		await act(async () => {
			fireEvent.click(submitBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("保存失败，请稍后重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("保存失败");
		});
	});

	it("does not show toast on local validation failure (content too short)", async () => {
		mockEditorContent = "<p>A</p>";

		renderDialog();

		const submitBtn = screen.getByTestId("editor-submit");
		await act(async () => {
			fireEvent.click(submitBtn);
		});

		// Inline error should be shown
		await waitFor(() => {
			expect(screen.getByText("内容太短，请输入更多内容")).toBeTruthy();
		});
		// No toast
		const alert = screen.queryByRole("alert");
		expect(alert).toBeNull();
		expect(mockEditMyPost).not.toHaveBeenCalled();
	});

	it("does not show toast on no-permission branch", async () => {
		renderDialog({ isOwnPost: false, canModerate: false });

		const submitBtn = screen.getByTestId("editor-submit");
		await act(async () => {
			fireEvent.click(submitBtn);
		});

		// Inline error should be shown
		await waitFor(() => {
			expect(screen.getByText("没有编辑权限")).toBeTruthy();
		});
		// No toast
		const alert = screen.queryByRole("alert");
		expect(alert).toBeNull();
	});
});
