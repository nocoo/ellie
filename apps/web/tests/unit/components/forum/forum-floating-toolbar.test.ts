// @vitest-environment happy-dom
// Tests for ForumFloatingToolbar — wrapper behavior around FloatingToolbar
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
}));

// Track writeGatePreflight calls (async — returns Promise<boolean>)
const mockPreflight = vi.fn(() => Promise.resolve(false));
vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: (...args: unknown[]) => mockPreflight(...args),
}));

// Stub tooltip / popover so they just render children without portals
vi.mock("@/components/ui/tooltip", () => ({
	TooltipProvider: ({ children }: any) => createElement("div", null, children),
	Tooltip: ({ children }: any) => createElement("div", null, children),
	TooltipTrigger: ({ children, render: renderProp }: any) => {
		if (renderProp) {
			return createElement(renderProp.type, { ...renderProp.props }, children);
		}
		return createElement("div", null, children);
	},
	TooltipContent: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
	Popover: ({ children }: any) => createElement("div", null, children),
	PopoverTrigger: ({ children, render: renderProp }: any) => {
		if (renderProp) {
			return createElement(renderProp.type, { ...renderProp.props }, children);
		}
		return createElement("div", null, children);
	},
	PopoverContent: ({ children }: any) => createElement("div", null, children),
}));

// Mock NewThreadDialog to track open state
const mockDialogProps = vi.fn();
vi.mock("@/components/forum/new-thread-dialog", () => ({
	NewThreadDialog: (props: any) => {
		mockDialogProps(props);
		return props.open ? createElement("div", { "data-testid": "new-thread-dialog" }) : null;
	},
}));

import { ForumFloatingToolbar } from "@/components/forum/forum-floating-toolbar";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	window.scrollTo = vi.fn();
	Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
});

afterEach(() => {
	cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ForumFloatingToolbar", () => {
	// ─── showNewThread=false — no new-thread action ───────────────────────

	it("does not show new-thread button when showNewThread is false", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 1,
				pages: 3,
				basePath: "/forums/1",
			}),
		);
		expect(screen.queryByRole("button", { name: "发表新帖" })).toBeNull();
	});

	it("does not trigger new-thread action via n key when showNewThread is false", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 1,
				pages: 3,
				basePath: "/forums/1",
				showNewThread: false,
			}),
		);
		fireEvent.keyDown(window, { key: "n" });
		expect(mockPreflight).not.toHaveBeenCalled();
	});

	// ─── showNewThread=true — preflight + dialog ──────────────────────────

	it("shows new-thread button when showNewThread is true", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 1,
				pages: 1,
				basePath: "/forums/1",
				forumId: 1,
				forumName: "General",
				showNewThread: true,
			}),
		);
		expect(screen.getByRole("button", { name: "发表新帖" })).toBeDefined();
	});

	it("calls preflight and opens dialog when new-thread button is clicked", async () => {
		mockPreflight.mockResolvedValue(false); // preflight passes
		render(
			createElement(ForumFloatingToolbar, {
				page: 1,
				pages: 1,
				basePath: "/forums/1",
				forumId: 1,
				forumName: "General",
				showNewThread: true,
				selfEmailVerifiedAt: 12345,
			}),
		);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "发表新帖" }));
		});
		expect(mockPreflight).toHaveBeenCalledWith(12345);
		// Dialog should now be open
		expect(screen.getByTestId("new-thread-dialog")).toBeDefined();
	});

	it("blocks new-thread when preflight returns true (unverified)", async () => {
		mockPreflight.mockResolvedValue(true); // preflight blocks
		render(
			createElement(ForumFloatingToolbar, {
				page: 1,
				pages: 1,
				basePath: "/forums/1",
				forumId: 1,
				forumName: "General",
				showNewThread: true,
				selfEmailVerifiedAt: 0,
			}),
		);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "发表新帖" }));
		});
		expect(mockPreflight).toHaveBeenCalledWith(0);
		// Dialog should NOT be open
		expect(screen.queryByTestId("new-thread-dialog")).toBeNull();
	});

	// ─── Pagination href computation ──────────────────────────────────────

	it("computes prevHref as basePath when page=2", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 2,
				pages: 5,
				basePath: "/forums/1",
			}),
		);
		// Click prev button
		fireEvent.click(screen.getByRole("button", { name: "上一页" }));
		expect(mockPush).toHaveBeenCalledWith("/forums/1");
	});

	it("computes prevHref with page param when page > 2", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 4,
				pages: 5,
				basePath: "/forums/1",
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "上一页" }));
		expect(mockPush).toHaveBeenCalledWith("/forums/1?page=3");
	});

	it("computes nextHref correctly", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 2,
				pages: 5,
				basePath: "/forums/1",
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "下一页" }));
		expect(mockPush).toHaveBeenCalledWith("/forums/1?page=3");
	});

	it("disables prevHref when page=1", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 1,
				pages: 5,
				basePath: "/forums/1",
			}),
		);
		const prevBtn = screen.getByRole("button", { name: "上一页" });
		expect(prevBtn.hasAttribute("disabled")).toBe(true);
	});

	it("disables nextHref when on last page", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 5,
				pages: 5,
				basePath: "/forums/1",
			}),
		);
		const nextBtn = screen.getByRole("button", { name: "下一页" });
		expect(nextBtn.hasAttribute("disabled")).toBe(true);
	});

	// ─── Jump page only when pages > 1 ───────────────────────────────────

	it("shows jump page button when pages > 1", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 1,
				pages: 3,
				basePath: "/forums/1",
			}),
		);
		expect(screen.getByRole("button", { name: "跳页" })).toBeDefined();
	});

	it("does not show jump page button when pages <= 1", () => {
		render(
			createElement(ForumFloatingToolbar, {
				page: 1,
				pages: 1,
				basePath: "/forums/1",
			}),
		);
		expect(screen.queryByRole("button", { name: "跳页" })).toBeNull();
	});
});
