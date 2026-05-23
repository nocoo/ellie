// @vitest-environment happy-dom
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

const mockPost = vi.fn(async () => ({ data: { id: 42 } }));
vi.mock("@/lib/api-client", () => ({
	apiClient: { post: (...args: any[]) => mockPost(...args) },
	ApiError: class ApiError extends Error {
		code?: string;
		constructor(m: string, c?: string) {
			super(m);
			this.code = c;
		}
	},
}));

vi.mock("@/lib/error-messages", () => ({
	getErrorMessage: vi.fn((_code: string | undefined, context: string) => `Error: ${context}`),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { useReplySubmit } from "@/viewmodels/forum/use-reply-submit";

function wrapper({ children }: { children: ReactNode }) {
	return createElement(ForumToastProvider, null, children);
}

describe("useReplySubmit hook", () => {
	beforeEach(() => vi.clearAllMocks());

	afterEach(() => {
		cleanup();
	});

	it("returns initial state", () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }), { wrapper });
		expect(result.current.state.submitting).toBe(false);
		expect(result.current.state.error).toBeNull();
	});

	it("validates content and shows error for short content", async () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }), { wrapper });
		await act(async () => {
			await result.current.actions.handleSubmit("<p>A</p>");
		});
		expect(result.current.state.error).toBe("内容太短，请输入更多内容");
		expect(mockPost).not.toHaveBeenCalled();
	});

	it("submits valid content and navigates to last page", async () => {
		const onClose = vi.fn();
		const { result } = renderHook(() => useReplySubmit({ threadId: 123, onClose }), { wrapper });
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Hello World!</p>");
		});
		expect(mockPost).toHaveBeenCalledWith("/api/v1/posts", {
			threadId: 123,
			content: "<p>Hello World!</p>",
		});
		expect(onClose).toHaveBeenCalled();
		expect(mockPush).toHaveBeenCalledWith("/threads/123?last=1#post-42");
		expect(mockRefresh).toHaveBeenCalled();
		expect(result.current.state.submitting).toBe(true);
	});

	it("prepends quote HTML when quote data is provided", async () => {
		const { result } = renderHook(
			() =>
				useReplySubmit({
					threadId: 1,
					quotedContent: "Hello",
					quotedAuthor: "Alice",
					quotedTime: "2026-01-01",
				}),
			{ wrapper },
		);
		await act(async () => {
			await result.current.actions.handleSubmit("<p>My reply</p>");
		});
		const call = mockPost.mock.calls[0];
		expect(call[1].content).toContain('class="quote"');
		expect(call[1].content).toContain("Alice");
		expect(call[1].content).toContain("<p>My reply</p>");
	});

	it("handles API error", async () => {
		mockPost.mockRejectedValueOnce(new Error("network"));
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }), { wrapper });
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Valid content here</p>");
		});
		expect(result.current.state.error).toBe("Error: reply");
		expect(result.current.state.submitting).toBe(false);
	});

	it("clearError clears error", async () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }), { wrapper });
		await act(async () => {
			await result.current.actions.handleSubmit("<p>A</p>");
		});
		act(() => {
			result.current.actions.clearError();
		});
		expect(result.current.state.error).toBeNull();
	});

	it("respects custom minContentLength", async () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1, minContentLength: 5 }), {
			wrapper,
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>ABCD</p>");
		});
		expect(result.current.state.error).toContain("内容太短");
		await act(async () => {
			await result.current.actions.handleSubmit("<p>ABCDE</p>");
		});
		expect(result.current.state.error).toBeNull();
	});

	// -------------------------------------------------------------------------
	// Toast integration
	// -------------------------------------------------------------------------

	it("shows success toast on successful submit", async () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }), { wrapper });
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Hello World!</p>");
		});
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("回复已发布");
	});

	it("shows error toast on API failure", async () => {
		mockPost.mockRejectedValueOnce(new Error("network"));
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }), { wrapper });
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Valid content here</p>");
		});
		const alerts = screen.getAllByRole("alert");
		const errorToast = alerts.find((el) => el.textContent?.includes("回复失败"));
		expect(errorToast).toBeTruthy();
		expect(errorToast?.textContent).toContain("Error: reply");
	});

	it("does not show toast on local validation failure", async () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }), { wrapper });
		await act(async () => {
			await result.current.actions.handleSubmit("<p>A</p>");
		});
		expect(result.current.state.error).toBe("内容太短，请输入更多内容");
		const alert = screen.queryByRole("alert");
		expect(alert).toBeNull();
	});
});
