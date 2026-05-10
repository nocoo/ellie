// @vitest-environment happy-dom
// Tests for FloatingToolbar component — keyboard shortcuts, disabled states, actions
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
}));

// Stub tooltip / popover so they just render children without portals
vi.mock("@/components/ui/tooltip", () => ({
	TooltipProvider: ({ children }: any) => createElement("div", null, children),
	Tooltip: ({ children }: any) => createElement("div", null, children),
	TooltipTrigger: ({ children, render: renderProp }: any) => {
		if (renderProp) {
			// Clone the render element and inject children
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

import { FloatingToolbar } from "@/components/forum/floating-toolbar";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	// Stub scrollTo
	window.scrollTo = vi.fn();
	Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
});

afterEach(() => {
	cleanup();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pressKey(key: string) {
	fireEvent.keyDown(window, { key });
}

function pressKeyOnInput(key: string) {
	const input = document.createElement("input");
	document.body.appendChild(input);
	fireEvent.keyDown(input, { key });
	document.body.removeChild(input);
}

function pressKeyWithMeta(key: string) {
	fireEvent.keyDown(window, { key, metaKey: true });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FloatingToolbar", () => {
	it("renders scroll-to-top, prev, next, back buttons with accessible names", () => {
		render(
			createElement(FloatingToolbar, {
				prevHref: "/prev",
				nextHref: "/next",
				backHref: "/back",
			}),
		);

		expect(screen.getByRole("button", { name: "回到顶部" })).toBeDefined();
		expect(screen.getByRole("button", { name: "上一页" })).toBeDefined();
		expect(screen.getByRole("button", { name: "下一页" })).toBeDefined();
		expect(screen.getByRole("button", { name: "返回" })).toBeDefined();
	});

	// ─── Keyboard shortcuts ───────────────────────────────────────────────

	it("navigates to prevHref on [ key", () => {
		render(createElement(FloatingToolbar, { prevHref: "/page/1" }));
		pressKey("[");
		expect(mockPush).toHaveBeenCalledWith("/page/1");
	});

	it("navigates to nextHref on ] key", () => {
		render(createElement(FloatingToolbar, { nextHref: "/page/3" }));
		pressKey("]");
		expect(mockPush).toHaveBeenCalledWith("/page/3");
	});

	it("navigates to prevHref on ArrowLeft", () => {
		render(createElement(FloatingToolbar, { prevHref: "/page/1" }));
		pressKey("ArrowLeft");
		expect(mockPush).toHaveBeenCalledWith("/page/1");
	});

	it("navigates to nextHref on ArrowRight", () => {
		render(createElement(FloatingToolbar, { nextHref: "/page/3" }));
		pressKey("ArrowRight");
		expect(mockPush).toHaveBeenCalledWith("/page/3");
	});

	it("navigates to backHref on Escape", () => {
		render(createElement(FloatingToolbar, { backHref: "/forums/1" }));
		pressKey("Escape");
		expect(mockPush).toHaveBeenCalledWith("/forums/1");
	});

	it("navigates to backHref on Backspace", () => {
		render(createElement(FloatingToolbar, { backHref: "/forums/1" }));
		pressKey("Backspace");
		expect(mockPush).toHaveBeenCalledWith("/forums/1");
	});

	it("calls scrollToTop on t key", () => {
		render(createElement(FloatingToolbar));
		pressKey("t");
		expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
	});

	// ─── Shortcuts do NOT fire in input/textarea ──────────────────────────

	it("does not navigate when key pressed inside an input", () => {
		render(createElement(FloatingToolbar, { prevHref: "/page/1" }));
		pressKeyOnInput("[");
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("does not fire shortcut when modifier key is held", () => {
		render(createElement(FloatingToolbar, { prevHref: "/page/1" }));
		pressKeyWithMeta("[");
		expect(mockPush).not.toHaveBeenCalled();
	});

	// ─── Disabled prev/next do not navigate ───────────────────────────────

	it("does not navigate on [ when prevHref is null", () => {
		render(createElement(FloatingToolbar, { prevHref: null }));
		pressKey("[");
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("does not navigate on ] when nextHref is null", () => {
		render(createElement(FloatingToolbar, { nextHref: null }));
		pressKey("]");
		expect(mockPush).not.toHaveBeenCalled();
	});

	// ─── Context action shortcuts ─────────────────────────────────────────

	it("calls onAction on r key when actionType is reply", () => {
		const onAction = vi.fn();
		render(createElement(FloatingToolbar, { actionType: "reply", onAction }));
		pressKey("r");
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("does not call onAction on r key when actionType is new-thread", () => {
		const onAction = vi.fn();
		render(createElement(FloatingToolbar, { actionType: "new-thread", onAction }));
		pressKey("r");
		expect(onAction).not.toHaveBeenCalled();
	});

	it("calls onAction on n key when actionType is new-thread", () => {
		const onAction = vi.fn();
		render(createElement(FloatingToolbar, { actionType: "new-thread", onAction }));
		pressKey("n");
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("does not call onAction on n key when actionType is reply", () => {
		const onAction = vi.fn();
		render(createElement(FloatingToolbar, { actionType: "reply", onAction }));
		pressKey("n");
		expect(onAction).not.toHaveBeenCalled();
	});

	// ─── Context action button click ──────────────────────────────────────

	it("calls onAction when reply button is clicked", () => {
		const onAction = vi.fn();
		render(createElement(FloatingToolbar, { actionType: "reply", onAction }));
		fireEvent.click(screen.getByRole("button", { name: "快速回帖" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("calls onAction when new-thread button is clicked", () => {
		const onAction = vi.fn();
		render(createElement(FloatingToolbar, { actionType: "new-thread", onAction }));
		fireEvent.click(screen.getByRole("button", { name: "发表新帖" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("does not show action button when actionType is none", () => {
		render(createElement(FloatingToolbar, { actionType: "none" }));
		expect(screen.queryByRole("button", { name: "快速回帖" })).toBeNull();
		expect(screen.queryByRole("button", { name: "发表新帖" })).toBeNull();
	});

	// ─── Jump page ────────────────────────────────────────────────────────

	it("renders jump page button when jumpPage is provided and pages > 1", () => {
		render(
			createElement(FloatingToolbar, {
				jumpPage: { basePath: "/forums/1", pages: 5 },
			}),
		);
		expect(screen.getByRole("button", { name: "跳页" })).toBeDefined();
	});

	it("does not render jump page button when pages <= 1", () => {
		render(
			createElement(FloatingToolbar, {
				jumpPage: { basePath: "/forums/1", pages: 1 },
			}),
		);
		expect(screen.queryByRole("button", { name: "跳页" })).toBeNull();
	});

	it("does not register g shortcut when pages <= 1", () => {
		render(
			createElement(FloatingToolbar, {
				jumpPage: { basePath: "/forums/1", pages: 1 },
			}),
		);
		// g should not open anything — no jump page form visible
		pressKey("g");
		// If g were active it would toggle internal state; since the popover
		// is mocked inline, we just verify no jump input appears
		expect(screen.queryByRole("button", { name: "跳页" })).toBeNull();
	});
});
