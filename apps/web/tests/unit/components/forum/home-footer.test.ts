// @vitest-environment happy-dom
// Tests for HomeFooter component (online stats + friend links layout).
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/components/forum/forum-logo", () => ({
	ForumLogo: () => createElement("span", null, "logo"),
}));

vi.mock("next/link", () => ({
	default: ({ children, href, ...props }: any) => createElement("a", { href, ...props }, children),
}));

// ─── Import ─────────────────────────────────────────────────────────────────

import { HomeFooter } from "@/components/forum/home-footer";
import type { HomeFooterViewModel } from "@/viewmodels/forum/footer";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeVm(overrides: Partial<HomeFooterViewModel> = {}): HomeFooterViewModel {
	return {
		onlineStats: { totalOnline: 42, peakOnline: 10985, peakDate: "2011-9-29" },
		friendLinks: [],
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("HomeFooter", () => {
	afterEach(cleanup);

	it("renders online stats with formatted peak record", () => {
		render(createElement(HomeFooter, { vm: makeVm() }));

		// totalOnline=42 stays as-is, peakOnline=10985 should be formatted with thousand separator
		expect(screen.getByText(/10,985/)).toBeTruthy();
		expect(screen.getByText(/2011-9-29/)).toBeTruthy();
	});

	it("hides friend links section when no links configured", () => {
		const { container } = render(createElement(HomeFooter, { vm: makeVm({ friendLinks: [] }) }));

		expect(screen.queryByText("友情链接")).toBeNull();
		// Only the online stats bar should be present
		expect(container.querySelectorAll("section > *").length).toBe(1);
	});

	it("renders friend links in grid without pipe separators", () => {
		const links = [
			{ label: "Google", href: "https://google.com" },
			{ label: "GitHub", href: "https://github.com" },
			{ label: "Vercel", href: "https://vercel.com" },
			{ label: "Cloudflare", href: "https://cloudflare.com" },
		];
		const { container } = render(createElement(HomeFooter, { vm: makeVm({ friendLinks: links }) }));

		// All links should render
		for (const link of links) {
			const el = screen.getByText(link.label);
			expect(el).toBeTruthy();
			expect(el.closest("a")?.getAttribute("href")).toBe(link.href);
			expect(el.closest("a")?.getAttribute("target")).toBe("_blank");
		}

		// No pipe separators in the output
		expect(container.textContent).not.toContain("|");

		// Links are inside a grid container
		const grid = container.querySelector(".grid");
		expect(grid).toBeTruthy();
	});
});
