// @vitest-environment happy-dom
// Tests for PagePagination component — extraParams.returnTo enters page links and JumpToPage
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

// Track JumpToPage props
const jumpToPageProps = vi.fn();
vi.mock("@/components/forum/jump-to-page", () => ({
	JumpToPage: (props: any) => {
		jumpToPageProps(props);
		return createElement("div", { "data-testid": "jump-to-page" });
	},
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, render: renderProp, disabled, ...rest }: any) => {
		if (renderProp && !disabled) {
			// Clone the render element (Link) and inject children
			return createElement(renderProp.type, { ...renderProp.props }, children);
		}
		return createElement("button", { type: "button", disabled, ...rest }, children);
	},
}));

vi.mock("@/viewmodels/shared/formatting", () => ({
	formatNumber: (n: number) => String(n),
}));

import { PagePagination } from "@/components/forum/page-pagination";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PagePagination — extraParams.returnTo", () => {
	it("page links include returnTo from extraParams (path-segment canonical)", () => {
		render(
			createElement(PagePagination, {
				page: 1,
				pages: 5,
				total: 100,
				basePath: "/threads/42",
				extraParams: { returnTo: "/forums/5/4" },
			}),
		);

		// Find page number links (e.g. page 2, 3, etc.)
		const link2 = screen.getByText("2").closest("a");
		expect(link2).not.toBeNull();
		const href2 = link2?.getAttribute("href");
		// Path-segment canonical: /threads/42/2?returnTo=...
		expect(href2).toBe(`/threads/42/2?returnTo=${encodeURIComponent("/forums/5/4")}`);
	});

	it("page 1 link omits page segment but keeps returnTo", () => {
		render(
			createElement(PagePagination, {
				page: 3,
				pages: 5,
				total: 100,
				basePath: "/threads/42",
				extraParams: { returnTo: "/forums/5/4" },
			}),
		);

		// Page 1 should be a clickable link (current page is 3)
		const link1 = screen.getByText("1").closest("a");
		expect(link1).not.toBeNull();
		const href1 = link1?.getAttribute("href");
		// Page 1 must use bare basePath, not /threads/42/1
		expect(href1).not.toContain("/threads/42/1");
		expect(href1).toContain("/threads/42?returnTo=");
		expect(href1).toContain(encodeURIComponent("/forums/5/4"));
	});

	it("page links have no returnTo when extraParams is omitted", () => {
		render(
			createElement(PagePagination, {
				page: 1,
				pages: 5,
				total: 100,
				basePath: "/threads/42",
			}),
		);

		const link2 = screen.getByText("2").closest("a");
		expect(link2).not.toBeNull();
		const href2 = link2?.getAttribute("href");
		expect(href2).toBe("/threads/42/2");
		expect(href2).not.toContain("returnTo");
	});

	it("passes extraParams to JumpToPage", () => {
		const extraParams = { returnTo: "/forums/5/4" };
		render(
			createElement(PagePagination, {
				page: 1,
				pages: 5,
				total: 100,
				basePath: "/threads/42",
				extraParams,
			}),
		);

		const calls = jumpToPageProps.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.extraParams).toEqual({ returnTo: "/forums/5/4" });
	});

	it("does not pass extraParams to JumpToPage when omitted", () => {
		render(
			createElement(PagePagination, {
				page: 1,
				pages: 5,
				total: 100,
				basePath: "/threads/42",
			}),
		);

		const calls = jumpToPageProps.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.extraParams).toBeUndefined();
	});
});
