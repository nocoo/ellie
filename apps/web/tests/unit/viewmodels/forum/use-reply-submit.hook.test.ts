// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

const mockPost = vi.fn(async () => ({ data: {} }));
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

	it("submits valid content successfully", async () => {
		const onSuccess = vi.fn();
		const { result } = renderHook(() => useReplySubmit({ threadId: 123, onSuccess }));
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Hello World!</p>");
		});
		expect(mockPost).toHaveBeenCalledWith("/api/v1/posts", {
			threadId: 123,
			content: "<p>Hello World!</p>",
		});
		expect(onSuccess).toHaveBeenCalled();
		expect(mockRefresh).toHaveBeenCalled();
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
