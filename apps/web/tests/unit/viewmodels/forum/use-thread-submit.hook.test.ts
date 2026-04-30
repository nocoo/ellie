// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

const mockPost = vi.fn(async () => ({ data: { id: 999 } }));
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

import { useThreadSubmit } from "@/viewmodels/forum/use-thread-submit";

describe("useThreadSubmit hook", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns initial state", () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		expect(result.current.state.submitting).toBe(false);
		expect(result.current.state.error).toBeNull();
		expect(result.current.state.subject).toBe("");
		expect(result.current.validation.canSubmit).toBe(false);
	});

	it("setSubject updates subject and validation", () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		act(() => {
			result.current.actions.setSubject("Hello World");
		});
		expect(result.current.state.subject).toBe("Hello World");
		expect(result.current.validation.canSubmit).toBe(true);
		expect(result.current.validation.subjectError).toBeNull();
	});

	it("shows subject error for short subject", () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		act(() => {
			result.current.actions.setSubject("abc");
		});
		expect(result.current.validation.subjectError).toContain("4个字符");
		expect(result.current.validation.canSubmit).toBe(false);
	});

	it("handleSubmit validates subject", async () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		act(() => {
			result.current.actions.setSubject("ab");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Enough content for the thread body here</p>");
		});
		expect(result.current.state.error).toContain("标题");
		expect(mockPost).not.toHaveBeenCalled();
	});

	it("handleSubmit validates content", async () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		act(() => {
			result.current.actions.setSubject("Valid Title Here");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>short</p>");
		});
		expect(result.current.state.error).toContain("内容太短");
		expect(mockPost).not.toHaveBeenCalled();
	});

	it("handleSubmit succeeds and navigates to new thread", async () => {
		const onSuccess = vi.fn();
		const { result } = renderHook(() => useThreadSubmit({ forumId: 5, onSuccess }));
		act(() => {
			result.current.actions.setSubject("Valid Title Here");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>This is enough content for validation</p>");
		});
		expect(mockPost).toHaveBeenCalledWith("/api/v1/threads", {
			forumId: 5,
			subject: "Valid Title Here",
			content: "<p>This is enough content for validation</p>",
		});
		expect(onSuccess).toHaveBeenCalled();
		expect(mockPush).toHaveBeenCalledWith("/threads/999");
	});

	it("handles API error", async () => {
		mockPost.mockRejectedValueOnce(new Error("fail"));
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		act(() => {
			result.current.actions.setSubject("Valid Title Here");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>This is enough content for validation</p>");
		});
		expect(result.current.state.error).toBe("Error: createThread");
		expect(result.current.state.submitting).toBe(false);
	});

	it("reset clears subject and error", async () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		act(() => {
			result.current.actions.setSubject("something");
		});
		act(() => {
			result.current.actions.reset();
		});
		expect(result.current.state.subject).toBe("");
		expect(result.current.state.error).toBeNull();
	});

	it("clearError clears error", async () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		act(() => {
			result.current.actions.setSubject("ab");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Long enough content here</p>");
		});
		act(() => {
			result.current.actions.clearError();
		});
		expect(result.current.state.error).toBeNull();
	});

	it("navigates to router.refresh when threadId is undefined", async () => {
		mockPost.mockResolvedValueOnce({ data: {} }); // no id
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }));
		act(() => {
			result.current.actions.setSubject("Valid Title Here");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>This is enough content for validation</p>");
		});
		expect(mockRefresh).toHaveBeenCalled();
	});
});
