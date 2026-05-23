// @vitest-environment happy-dom
// Tests for Breadcrumbs `mobileCompact` prop (reviewer freeze msg=5a91dfd3).
// "hide-intermediate" mode collapses long forum-ancestor chains down to
// home + last-linked-forum + current page on mobile (<640px) while
// leaving desktop unchanged. We assert via stable testids on each
// segment span instead of relying on viewport simulation, since
// happy-dom does not evaluate media queries.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

vi.mock("lucide-react", () => ({
	ChevronRight: () => createElement("span", { "data-testid": "chevron" }),
	Home: () => createElement("span", { "data-testid": "home-icon" }),
}));

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import type { BreadcrumbItem } from "@ellie/shared";

afterEach(() => {
	cleanup();
});

// A canonical thread-detail chain with two intermediate forum ancestors:
// 首页 → 分区A → 分区B → 版块 → 主题
function makeThreadChain(): BreadcrumbItem[] {
	return [
		{ label: "首页", href: "/", icon: "home" },
		{ label: "分区A", href: "/forums/10" },
		{ label: "分区B", href: "/forums/20" },
		{ label: "版块", href: "/forums/30" },
		{ label: "主题标题" },
	];
}

describe("Breadcrumbs — default (mobileCompact unset / 'none')", () => {
	it("renders every segment with `breadcrumb-segment` testid (no mobile-hidden segments)", () => {
		render(createElement(Breadcrumbs, { items: makeThreadChain() }));
		const visible = screen.getAllByTestId("breadcrumb-segment");
		expect(visible.length).toBe(5);
		// No segment carries the mobile-hidden marker.
		expect(screen.queryAllByTestId("breadcrumb-segment-mobile-hidden").length).toBe(0);
	});
});

describe("Breadcrumbs — mobileCompact='hide-intermediate'", () => {
	it("hides intermediate linked ancestors on mobile but keeps home, last linked, and current page", () => {
		render(
			createElement(Breadcrumbs, {
				items: makeThreadChain(),
				mobileCompact: "hide-intermediate",
			}),
		);
		// Visible (on mobile + desktop): 首页, 版块, 主题标题
		const visible = screen.getAllByTestId("breadcrumb-segment");
		const visibleLabels = visible.map((el) => el.textContent ?? "");
		expect(visibleLabels.some((t) => t.includes("首页"))).toBe(true);
		expect(visibleLabels.some((t) => t.includes("版块"))).toBe(true);
		expect(visibleLabels.some((t) => t.includes("主题标题"))).toBe(true);

		// Mobile-hidden: 分区A, 分区B
		const hidden = screen.getAllByTestId("breadcrumb-segment-mobile-hidden");
		const hiddenLabels = hidden.map((el) => el.textContent ?? "");
		expect(hidden.length).toBe(2);
		expect(hiddenLabels.some((t) => t.includes("分区A"))).toBe(true);
		expect(hiddenLabels.some((t) => t.includes("分区B"))).toBe(true);
	});

	it("mobile-hidden segments carry `hidden sm:inline-flex` so they reappear on desktop", () => {
		render(
			createElement(Breadcrumbs, {
				items: makeThreadChain(),
				mobileCompact: "hide-intermediate",
			}),
		);
		const hidden = screen.getAllByTestId("breadcrumb-segment-mobile-hidden");
		for (const seg of hidden) {
			expect(seg.className).toContain("hidden");
			expect(seg.className).toContain("sm:inline-flex");
		}
	});

	it("chain with no intermediate ancestors (首页 → 版块 → 主题) hides nothing", () => {
		const chain: BreadcrumbItem[] = [
			{ label: "首页", href: "/", icon: "home" },
			{ label: "版块", href: "/forums/30" },
			{ label: "主题标题" },
		];
		render(createElement(Breadcrumbs, { items: chain, mobileCompact: "hide-intermediate" }));
		expect(screen.queryAllByTestId("breadcrumb-segment-mobile-hidden").length).toBe(0);
		expect(screen.getAllByTestId("breadcrumb-segment").length).toBe(3);
	});

	it("home-only chain renders the home segment as-is", () => {
		const chain: BreadcrumbItem[] = [{ label: "首页", href: "/", icon: "home" }];
		render(createElement(Breadcrumbs, { items: chain, mobileCompact: "hide-intermediate" }));
		expect(screen.queryAllByTestId("breadcrumb-segment-mobile-hidden").length).toBe(0);
		expect(screen.getAllByTestId("breadcrumb-segment").length).toBe(1);
	});

	it("non-linked current segment is always visible (never marked mobile-hidden)", () => {
		render(
			createElement(Breadcrumbs, {
				items: makeThreadChain(),
				mobileCompact: "hide-intermediate",
			}),
		);
		const visible = screen.getAllByTestId("breadcrumb-segment");
		// The current page "主题标题" has no href — it must be in the visible
		// list, not the hidden list.
		expect(visible.some((el) => (el.textContent ?? "").includes("主题标题"))).toBe(true);
	});
});
