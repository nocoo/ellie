// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
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

	it("auto-dismisses after 4000ms", () => {
		const { result } = renderHook(() => useForumToast(), { wrapper });

		act(() => {
			result.current.success("即将消失");
		});

		expect(screen.getByRole("alert")).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(4000);
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
});
