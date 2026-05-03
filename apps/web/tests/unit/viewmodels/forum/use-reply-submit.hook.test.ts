// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: mockPush }),
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

import { useReplySubmit } from "@/viewmodels/forum/use-reply-submit";

describe("useReplySubmit hook", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns initial state", () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }));
		expect(result.current.state.submitting).toBe(false);
		expect(result.current.state.error).toBeNull();
	});

	it("validates content and shows error for short content", async () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }));
		await act(async () => {
			await result.current.actions.handleSubmit("<p>A</p>");
		});
		expect(result.current.state.error).toBe("内容太短，请输入更多内容");
		expect(mockPost).not.toHaveBeenCalled();
	});

	it("submits valid content and navigates to last page", async () => {
		const onClose = vi.fn();
		const { result } = renderHook(() => useReplySubmit({ threadId: 123, onClose }));
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Hello World!</p>");
		});
		expect(mockPost).toHaveBeenCalledWith("/api/v1/posts", {
			threadId: 123,
			content: "<p>Hello World!</p>",
		});
		expect(onClose).toHaveBeenCalled();
		expect(mockPush).toHaveBeenCalledWith("/threads/123?last=1#post-42");
		expect(result.current.state.submitting).toBe(true);
	});

	it("prepends quote HTML when quote data is provided", async () => {
		const { result } = renderHook(() =>
			useReplySubmit({
				threadId: 1,
				quotedContent: "Hello",
				quotedAuthor: "Alice",
				quotedTime: "2026-01-01",
			}),
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
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }));
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Valid content here</p>");
		});
		expect(result.current.state.error).toBe("Error: reply");
		expect(result.current.state.submitting).toBe(false);
	});

	it("clearError clears error", async () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1 }));
		await act(async () => {
			await result.current.actions.handleSubmit("<p>A</p>");
		});
		act(() => {
			result.current.actions.clearError();
		});
		expect(result.current.state.error).toBeNull();
	});

	it("respects custom minContentLength", async () => {
		const { result } = renderHook(() => useReplySubmit({ threadId: 1, minContentLength: 5 }));
		await act(async () => {
			await result.current.actions.handleSubmit("<p>ABCD</p>");
		});
		expect(result.current.state.error).toContain("内容太短");
		await act(async () => {
			await result.current.actions.handleSubmit("<p>ABCDE</p>");
		});
		expect(result.current.state.error).toBeNull();
	});
});
