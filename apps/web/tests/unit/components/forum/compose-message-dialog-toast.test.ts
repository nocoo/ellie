// @vitest-environment happy-dom
// Tests for ComposeMessageDialog toast integration
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the viewmodel module
vi.mock("@/viewmodels/forum/messages", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		sendMessage: vi.fn(),
		searchUsers: vi.fn().mockResolvedValue([]),
	};
});

// Mock next/link as a passthrough
vi.mock("next/link", () => ({
	default: ({ children, href }: { children: unknown; href: string }) =>
		createElement("a", { href }, children),
}));

import { ComposeMessageDialog } from "@/components/forum/compose-message-dialog";
import { ForumToastProvider } from "@/components/forum/forum-toast";
import { ApiError } from "@/lib/api-error";
import { sendMessage } from "@/viewmodels/forum/messages";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECIPIENT = { id: 10, username: "Alice" };

function renderDialog(props: { open?: boolean; onSuccess?: () => void } = {}) {
	const onOpenChange = vi.fn();
	const onSuccess = props.onSuccess ?? vi.fn();
	const result = render(
		createElement(
			ForumToastProvider,
			null,
			createElement(ComposeMessageDialog, {
				open: props.open ?? true,
				onOpenChange,
				initialRecipient: RECIPIENT,
				onSuccess,
			}),
		),
	);
	return { ...result, onOpenChange, onSuccess };
}

function getContentTextarea(): HTMLTextAreaElement {
	const el = document.getElementById("content");
	expect(el).toBeTruthy();
	return el as HTMLTextAreaElement;
}

function getSendButton(): HTMLElement {
	const btn = screen.getByRole("button", { name: /发送/ });
	expect(btn).toBeTruthy();
	return btn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ComposeMessageDialog toast integration", () => {
	beforeEach(() => {
		vi.mocked(sendMessage).mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows success toast on send", async () => {
		vi.mocked(sendMessage).mockResolvedValueOnce({ id: 1, receiverId: 10 } as any);

		const { onSuccess } = renderDialog();
		await act(async () => {});

		const textarea = getContentTextarea();
		await act(async () => {
			fireEvent.change(textarea, { target: { value: "Hello Alice" } });
		});

		await act(async () => {
			fireEvent.click(getSendButton());
		});

		await waitFor(() => {
			expect(screen.getByText("站内信已发送")).toBeTruthy();
		});
		expect(onSuccess).toHaveBeenCalled();
	});

	it("shows error toast with ApiError message on send failure", async () => {
		vi.mocked(sendMessage).mockRejectedValueOnce(
			new ApiError(400, "RECIPIENT_BLOCKED", "对方已将你拉黑"),
		);

		renderDialog();
		await act(async () => {});

		const textarea = getContentTextarea();
		await act(async () => {
			fireEvent.change(textarea, { target: { value: "Hello" } });
		});

		await act(async () => {
			fireEvent.click(getSendButton());
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("对方已将你拉黑"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("发送失败");
		});
	});

	it("shows fallback error toast on send non-ApiError failure", async () => {
		vi.mocked(sendMessage).mockRejectedValueOnce(new Error("network"));

		renderDialog();
		await act(async () => {});

		const textarea = getContentTextarea();
		await act(async () => {
			fireEvent.change(textarea, { target: { value: "Hello" } });
		});

		await act(async () => {
			fireEvent.click(getSendButton());
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("发送失败，请重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("发送失败");
		});
	});

	it("does not show toast on local validation error (empty content)", async () => {
		renderDialog();
		await act(async () => {});

		// Content is empty, recipient is pre-filled — submit should trigger inline error only
		await act(async () => {
			fireEvent.click(getSendButton());
		});

		// Inline error should exist
		await waitFor(() => {
			expect(screen.getByText("请输入站内信内容")).toBeTruthy();
		});
		// No toast should appear
		const alerts = screen.queryAllByRole("alert");
		const toastAlert = alerts.find(
			(el) => el.textContent?.includes("发送失败") || el.textContent?.includes("请输入站内信内容"),
		);
		expect(toastAlert).toBeFalsy();
		expect(sendMessage).not.toHaveBeenCalled();
	});
});
