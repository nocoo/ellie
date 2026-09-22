// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForumToastProvider, useForumToast } from "@/components/forum/forum-toast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
	return createElement(ForumToastProvider, null, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ForumToast", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("throws when useForumToast is used outside provider", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => {
			renderHook(() => useForumToast());
		}).toThrow("useForumToast must be used within ForumToastProvider");
		spy.mockRestore();
	});

	it("renders provider without toasts initially", () => {
		const { container } = render(
			createElement(ForumToastProvider, null, createElement("div", null, "child")),
		);
		expect(container.textContent).toContain("child");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("shows a success toast", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });

		act(() => {
			result.current.success("操作成功");
		});

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("操作成功");
	});

	it("shows an error toast with title and description", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });

		act(() => {
			result.current.error({ title: "操作失败", description: "网络连接超时" });
		});

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("操作失败");
		expect(alert.textContent).toContain("网络连接超时");
	});

	it("shows an info toast", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });

		act(() => {
			result.current.info("提示信息");
		});

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("提示信息");
	});

	it("auto-dismisses after 5000ms", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });

		act(() => {
			result.current.success("即将消失");
		});

		expect(screen.getByRole("alert")).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(5000);
		});

		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("can be manually closed via the close button", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });

		act(() => {
			result.current.success("可关闭");
		});

		const closeBtn = screen.getByLabelText("关闭");
		act(() => {
			closeBtn.click();
		});

		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("limits visible toasts to MAX_VISIBLE (5)", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });

		act(() => {
			for (let i = 0; i < 7; i++) {
				result.current.info(`toast ${i}`);
			}
		});

		const alerts = screen.getAllByRole("alert");
		expect(alerts.length).toBeLessThanOrEqual(5);
	});

	it("supports string shorthand for all types", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });

		act(() => {
			result.current.success("s");
			result.current.error("e");
			result.current.info("i");
		});

		const alerts = screen.getAllByRole("alert");
		expect(alerts.length).toBe(3);
	});
	it("keeps failures visible longer than success messages", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });
		act(() => {
			result.current.error("Please retry");
			result.current.success("Saved");
		});
		act(() => vi.advanceTimersByTime(5000));
		expect(screen.getAllByRole("alert")).toHaveLength(1);
		expect(screen.getByRole("alert").textContent).toContain("Please retry");
		act(() => vi.advanceTimersByTime(4000));
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("pauses expiry while the pointer is over the notifications", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });
		act(() => result.current.info("Read this"));
		act(() => vi.advanceTimersByTime(3000));
		fireEvent.mouseEnter(screen.getByRole("region", { name: "操作提示" }));
		act(() => vi.advanceTimersByTime(10000));
		expect(screen.getByRole("alert").textContent).toContain("Read this");
		fireEvent.mouseLeave(screen.getByRole("region", { name: "操作提示" }));
		act(() => vi.advanceTimersByTime(2001));
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
