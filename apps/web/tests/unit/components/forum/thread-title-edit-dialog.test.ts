// @vitest-environment happy-dom
// Tests for ThreadTitleEditDialog — submit / empty / overlong / error /
// success paths. Reviewer freeze msg=a8ee78db Directive 9 demands the
// dialog calls `editThreadSubject(threadId, trimmedSubject)` exactly once
// on success and `router.refresh()` afterwards; rejects empty / >200-char
// inputs; and surfaces API errors inline.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

const editThreadSubjectMock = vi.fn(async () => ({ id: 5, updated: true }));
vi.mock("@/lib/moderation-api", () => ({
	editThreadSubject: (...args: unknown[]) => editThreadSubjectMock(...args),
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

const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: routerRefreshMock, push: vi.fn() }),
}));

// Stub the heavy dialog primitives — happy-dom can't drive the real
// Base-UI dialog reliably, and we only care about the form behaviour.
vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
		open ? createElement("div", { role: "dialog" }, children) : null,
	DialogContent: ({ children }: { children: React.ReactNode }) =>
		createElement("div", null, children),
	DialogHeader: ({ children }: { children: React.ReactNode }) =>
		createElement("div", null, children),
	DialogFooter: ({ children }: { children: React.ReactNode }) =>
		createElement("div", null, children),
	DialogTitle: ({ children }: { children: React.ReactNode }) => createElement("h2", null, children),
	DialogDescription: ({ children }: { children: React.ReactNode }) =>
		createElement("p", null, children),
	DialogClose: ({ children }: { children: React.ReactNode }) =>
		createElement("button", { type: "button" }, children),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { ThreadTitleEditDialog } from "@/components/forum/thread-title-edit-dialog";
import { ApiError } from "@/lib/api-client";

// ── Helpers ────────────────────────────────────────────────────────────

function renderDialog(props: Partial<Parameters<typeof ThreadTitleEditDialog>[0]> = {}) {
	const onOpenChange = vi.fn();
	const utils = render(
		createElement(
			ForumToastProvider,
			null,
			createElement(ThreadTitleEditDialog, {
				open: true,
				onOpenChange,
				threadId: 5,
				currentSubject: "Original title",
				...props,
			}),
		),
	);
	return { ...utils, onOpenChange };
}

function getInput(): HTMLInputElement {
	return screen.getByPlaceholderText("输入新的主题标题") as HTMLInputElement;
}

function getSaveButton(): HTMLButtonElement {
	return screen.getByRole("button", { name: /保存/ }) as HTMLButtonElement;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("ThreadTitleEditDialog", () => {
	it("submit happy path: calls editThreadSubject + closes dialog + router.refresh()", async () => {
		const { onOpenChange } = renderDialog();
		fireEvent.change(getInput(), { target: { value: "Brand new title" } });
		await act(async () => {
			fireEvent.click(getSaveButton());
		});
		await waitFor(() => {
			expect(editThreadSubjectMock).toHaveBeenCalledTimes(1);
		});
		expect(editThreadSubjectMock).toHaveBeenCalledWith(5, "Brand new title");
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(routerRefreshMock).toHaveBeenCalledTimes(1);
	});

	it("empty input keeps Save disabled (input trimmed to whitespace)", async () => {
		renderDialog();
		fireEvent.change(getInput(), { target: { value: "   " } });
		expect(getSaveButton().disabled).toBe(true);
		// Even forcing a click should not fire the API
		await act(async () => {
			fireEvent.click(getSaveButton());
		});
		expect(editThreadSubjectMock).not.toHaveBeenCalled();
	});

	it("overlong input (>200 chars) keeps Save disabled and shows over-limit hint", () => {
		renderDialog();
		const tooLong = "a".repeat(201);
		fireEvent.change(getInput(), { target: { value: tooLong } });
		expect(getSaveButton().disabled).toBe(true);
		expect(screen.getByText(/已超出 200 字符上限/)).toBeTruthy();
	});

	it("unchanged input keeps Save disabled (semantic no-op guarded client-side)", () => {
		renderDialog({ currentSubject: "Stay the same" });
		// open useEffect resets value to currentSubject — already 'unchanged'
		expect(getSaveButton().disabled).toBe(true);
		expect(screen.getByText("标题未发生变化")).toBeTruthy();
	});

	it("API error surfaces inline error banner; dialog stays open", async () => {
		editThreadSubjectMock.mockRejectedValueOnce(new ApiError("Content is banned"));
		const { onOpenChange } = renderDialog();
		fireEvent.change(getInput(), { target: { value: "Spam attempt" } });
		await act(async () => {
			fireEvent.click(getSaveButton());
		});
		await waitFor(() => {
			expect(screen.getByText("Content is banned")).toBeTruthy();
		});
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
		expect(routerRefreshMock).not.toHaveBeenCalled();
	});

	it("generic non-ApiError still produces a fallback message", async () => {
		editThreadSubjectMock.mockRejectedValueOnce(new Error("Network down"));
		renderDialog();
		fireEvent.change(getInput(), { target: { value: "New" } });
		await act(async () => {
			fireEvent.click(getSaveButton());
		});
		await waitFor(() => {
			expect(screen.getByText("保存失败，请稍后重试")).toBeTruthy();
		});
	});
});
