// @vitest-environment happy-dom
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { useThreadSubmit } from "@/viewmodels/forum/use-thread-submit";

function wrapper({ children }: { children: ReactNode }) {
	return createElement(ForumToastProvider, null, children);
}

describe("useThreadSubmit hook", () => {
	beforeEach(() => vi.clearAllMocks());

	afterEach(() => {
		cleanup();
	});

	it("returns initial state", () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
		expect(result.current.state.submitting).toBe(false);
		expect(result.current.state.error).toBeNull();
		expect(result.current.state.subject).toBe("");
		expect(result.current.validation.canSubmit).toBe(false);
	});

	it("setSubject updates subject and validation", () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
		act(() => {
			result.current.actions.setSubject("Hello World");
		});
		expect(result.current.state.subject).toBe("Hello World");
		expect(result.current.validation.canSubmit).toBe(true);
		expect(result.current.validation.subjectError).toBeNull();
	});

	it("shows subject error for short subject", () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
		act(() => {
			result.current.actions.setSubject("abc");
		});
		expect(result.current.validation.subjectError).toContain("4个字符");
		expect(result.current.validation.canSubmit).toBe(false);
	});

	it("handleSubmit validates subject", async () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
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
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
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
		const { result } = renderHook(() => useThreadSubmit({ forumId: 5, onSuccess }), { wrapper });
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
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
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
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
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
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
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
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
		act(() => {
			result.current.actions.setSubject("Valid Title Here");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>This is enough content for validation</p>");
		});
		expect(mockRefresh).toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Toast integration
	// -------------------------------------------------------------------------

	it("shows success toast on successful submit", async () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
		act(() => {
			result.current.actions.setSubject("Valid Title Here");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>This is enough content for validation</p>");
		});
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("主题已发布");
	});

	it("shows error toast on API failure", async () => {
		mockPost.mockRejectedValueOnce(new Error("fail"));
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
		act(() => {
			result.current.actions.setSubject("Valid Title Here");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>This is enough content for validation</p>");
		});
		const alerts = screen.getAllByRole("alert");
		const errorToast = alerts.find((el) => el.textContent?.includes("发帖失败"));
		expect(errorToast).toBeTruthy();
		expect(errorToast?.textContent).toContain("Error: createThread");
	});

	it("does not show toast on local validation failure", async () => {
		const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
		act(() => {
			result.current.actions.setSubject("ab");
		});
		await act(async () => {
			await result.current.actions.handleSubmit("<p>Enough content for the thread body here</p>");
		});
		expect(result.current.state.error).toContain("标题");
		const alert = screen.queryByRole("alert");
		expect(alert).toBeNull();
	});

	// -------------------------------------------------------------------------
	// 主题分类 — typeId picker integration
	// -------------------------------------------------------------------------

	describe("typeId picker", () => {
		it("initial typeId is null", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			expect(result.current.state.typeId).toBeNull();
		});

		it("setTypeId updates state", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			act(() => {
				result.current.actions.setTypeId(11);
			});
			expect(result.current.state.typeId).toBe(11);
		});

		it("setTypeId(null) clears the selection", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			act(() => {
				result.current.actions.setTypeId(11);
			});
			act(() => {
				result.current.actions.setTypeId(null);
			});
			expect(result.current.state.typeId).toBeNull();
		});

		it("reset clears typeId", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			act(() => {
				result.current.actions.setTypeId(11);
			});
			act(() => {
				result.current.actions.reset();
			});
			expect(result.current.state.typeId).toBeNull();
		});

		it("required + null typeId — canSubmit is false even with valid subject", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1, typeIdRequired: true }), {
				wrapper,
			});
			act(() => {
				result.current.actions.setSubject("Valid Title Here");
			});
			expect(result.current.validation.canSubmit).toBe(false);
		});

		it("required + positive typeId — canSubmit becomes true", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1, typeIdRequired: true }), {
				wrapper,
			});
			act(() => {
				result.current.actions.setSubject("Valid Title Here");
				result.current.actions.setTypeId(11);
			});
			expect(result.current.validation.canSubmit).toBe(true);
		});

		it("required + handleSubmit without typeId — skips request (inline hint already on screen)", async () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1, typeIdRequired: true }), {
				wrapper,
			});
			act(() => {
				result.current.actions.setSubject("Valid Title Here");
			});
			await act(async () => {
				await result.current.actions.handleSubmit("<p>Long enough content here</p>");
			});
			// Inline hint surfaces via validation.typeIdError immediately
			// (even before this submit attempt). state.error stays clean —
			// no top red banner for the required-but-untouched path.
			expect(result.current.validation.typeIdError).toBe("请选择主题分类");
			expect(result.current.state.error).toBeNull();
			expect(mockPost).not.toHaveBeenCalled();
		});

		it("not required + handleSubmit without typeId — request goes through without typeId", async () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			act(() => {
				result.current.actions.setSubject("Valid Title Here");
			});
			await act(async () => {
				await result.current.actions.handleSubmit("<p>Long enough content here</p>");
			});
			expect(mockPost).toHaveBeenCalledWith("/api/v1/threads", {
				forumId: 1,
				subject: "Valid Title Here",
				content: "<p>Long enough content here</p>",
			});
		});

		it("handleSubmit with positive typeId — includes typeId in body", async () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1, typeIdRequired: true }), {
				wrapper,
			});
			act(() => {
				result.current.actions.setSubject("Valid Title Here");
				result.current.actions.setTypeId(11);
			});
			await act(async () => {
				await result.current.actions.handleSubmit("<p>Long enough content here</p>");
			});
			expect(mockPost).toHaveBeenCalledWith("/api/v1/threads", {
				forumId: 1,
				subject: "Valid Title Here",
				content: "<p>Long enough content here</p>",
				typeId: 11,
			});
		});

		it("typeIdError is visible immediately when required + nothing selected", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1, typeIdRequired: true }), {
				wrapper,
			});
			// Even without setSubject / handleSubmit, the inline hint
			// surfaces so users can see why the button is disabled.
			expect(result.current.validation.typeIdError).toBe("请选择主题分类");
		});

		it("typeIdError clears once a positive typeId is selected", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1, typeIdRequired: true }), {
				wrapper,
			});
			expect(result.current.validation.typeIdError).toBe("请选择主题分类");
			act(() => {
				result.current.actions.setTypeId(11);
			});
			expect(result.current.validation.typeIdError).toBeNull();
		});

		it("typeIdError stays null when picker is not required", () => {
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			expect(result.current.validation.typeIdError).toBeNull();
		});
	});

	// -------------------------------------------------------------------------
	// Server-side typeId error → mapCreateThreadTypeError
	// -------------------------------------------------------------------------

	describe("server typeId error mapping", () => {
		it("maps invalid/disabled typeId server message to friendly Chinese", async () => {
			mockPost.mockRejectedValueOnce(
				Object.assign(new Error("INVALID_BODY"), {
					details: { message: "type not found" },
				}),
			);
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			act(() => {
				result.current.actions.setSubject("Valid Title Here");
				result.current.actions.setTypeId(11);
			});
			await act(async () => {
				await result.current.actions.handleSubmit("<p>Long enough content here</p>");
			});
			expect(result.current.state.error).toBe("主题分类不存在或已停用，请重新选择");
		});

		it("maps required-from-server to friendly Chinese", async () => {
			mockPost.mockRejectedValueOnce(
				Object.assign(new Error("INVALID_BODY"), {
					details: { message: "主题分类必选" },
				}),
			);
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			act(() => {
				result.current.actions.setSubject("Valid Title Here");
				result.current.actions.setTypeId(11);
			});
			await act(async () => {
				await result.current.actions.handleSubmit("<p>Long enough content here</p>");
			});
			expect(result.current.state.error).toBe("请选择主题分类");
		});

		it("falls back to generic getErrorMessage when not a typeId problem", async () => {
			mockPost.mockRejectedValueOnce(new Error("network failure"));
			const { result } = renderHook(() => useThreadSubmit({ forumId: 1 }), { wrapper });
			act(() => {
				result.current.actions.setSubject("Valid Title Here");
			});
			await act(async () => {
				await result.current.actions.handleSubmit("<p>Long enough content here</p>");
			});
			expect(result.current.state.error).toBe("Error: createThread");
		});
	});
});
