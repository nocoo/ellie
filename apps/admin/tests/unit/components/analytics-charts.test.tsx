// Analytics chart component render tests — P2 fixup.
//
// Reviewer (msg=33cf642c, Finding 3) required component-level coverage
// for the chart wrappers in addition to the viewmodel parser tests. The
// pinned contracts are:
//
//   1. Two TrendChart instances on the same page render distinct
//      `<linearGradient id="...">` ids so the SVG defs do not collide
//      (regression guard for the previously hardcoded `id="trendFill"`).
//   2. TrendChart's <Area> `fill="url(#<id>)"` reference matches the
//      gradient id it actually renders.
//   3. ForumDistChart honours the `limit` prop (top-N truncation).
//
// We use happy-dom + testing-library and bypass the responsive-container
// gate by stubbing `recharts`'s `ResponsiveContainer` to render its
// child directly with a fixed width/height — otherwise the
// `ResizeObserver`-driven `ready` flag in
// `DashboardResponsiveContainer` keeps the chart unmounted in the test
// DOM.

// @vitest-environment happy-dom

import { cloneElement, isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Bypass the ResizeObserver-gated DashboardResponsiveContainer in the
// test DOM — happy-dom does not paint, so the wrapper never flips its
// `ready` flag and the chart stays unmounted. Render its child
// directly so the underlying Recharts tree shows up.
//
// We also need to fan out width/height to the chart's only child
// (AreaChart / BarChart). The real `ResponsiveContainer` measures
// itself and passes width/height via cloneElement; our stub does the
// same so the chart actually renders SVG content in happy-dom.
vi.mock("@/components/admin/analytics/responsive-container", () => ({
	DashboardResponsiveContainer: ({ children }: { children: React.ReactNode }) => {
		if (isValidElement(children)) {
			return cloneElement(children as React.ReactElement<{ width?: number; height?: number }>, {
				width: 600,
				height: 300,
			});
		}
		return <>{children}</>;
	},
}));

vi.mock("recharts", async () => {
	const actual = await vi.importActual<typeof import("recharts")>("recharts");
	return {
		...actual,
		// Same fan-out behaviour for the raw Recharts ResponsiveContainer
		// in case it is reached through a different path.
		ResponsiveContainer: ({ children }: { children: React.ReactNode }) => {
			if (isValidElement(children)) {
				return cloneElement(children as React.ReactElement<{ width?: number; height?: number }>, {
					width: 600,
					height: 300,
				});
			}
			return <>{children}</>;
		},
	};
});

import { ForumDistChart } from "@/components/admin/analytics/forum-dist-chart";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import type { AnalyticsForumDistRow, AnalyticsTrendPoint } from "@/viewmodels/admin/analytics";
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";

afterEach(() => {
	cleanup();
});

function makeSeries(): AnalyticsTrendPoint[] {
	return [
		{ date: "2026-05-01", count: 1 },
		{ date: "2026-05-02", count: 2 },
		{ date: "2026-05-03", count: 3 },
	];
}

describe("TrendChart", () => {
	it("renders a <linearGradient> with a non-empty id", () => {
		const { container } = render(<TrendChart series={makeSeries()} />);
		const gradient = container.querySelector("linearGradient");
		expect(gradient).not.toBeNull();
		const id = gradient?.getAttribute("id");
		expect(typeof id).toBe("string");
		expect((id ?? "").length).toBeGreaterThan(0);
		// Defensive: ensure it is NOT the previously hardcoded id.
		expect(id).not.toBe("trendFill");
	});

	it("references its own gradient id from the area fill", () => {
		const { container } = render(<TrendChart series={makeSeries()} />);
		const gradient = container.querySelector("linearGradient");
		const id = gradient?.getAttribute("id") ?? "";
		// Recharts renders the <path fill="url(#<id>)"> for the Area.
		const fillPath = container.querySelector(`path[fill="url(#${id})"]`);
		expect(fillPath).not.toBeNull();
	});

	it("two TrendChart instances on the same page get distinct gradient ids", () => {
		// Both charts share the same DOM root — the regression case is
		// a hardcoded `id="trendFill"` on both. With useId() the ids
		// must differ.
		const { container } = render(
			<div>
				<TrendChart series={makeSeries()} valueLabel="signups" />
				<TrendChart series={makeSeries()} valueLabel="checkins" />
			</div>,
		);
		const gradients = container.querySelectorAll("linearGradient");
		expect(gradients.length).toBe(2);
		const id0 = gradients[0].getAttribute("id");
		const id1 = gradients[1].getAttribute("id");
		expect(id0).toBeTruthy();
		expect(id1).toBeTruthy();
		expect(id0).not.toBe(id1);
	});
});

describe("ForumDistChart", () => {
	function makeRows(n: number): AnalyticsForumDistRow[] {
		return Array.from({ length: n }, (_, i) => ({
			forumId: i + 1,
			forumName: `Forum ${i + 1}`,
			posts: (n - i) * 10,
		}));
	}

	it("honours the limit prop (top-N truncation)", () => {
		const { container } = render(<ForumDistChart rows={makeRows(20)} limit={5} />);
		// One <rect> bar per row in the visible category axis. Recharts
		// renders bars as <path> elements within `.recharts-bar-rectangle`.
		const bars = container.querySelectorAll(".recharts-bar-rectangle");
		expect(bars.length).toBe(5);
	});

	it("falls back to the default limit of 12 when no limit is provided", () => {
		const { container } = render(<ForumDistChart rows={makeRows(20)} />);
		const bars = container.querySelectorAll(".recharts-bar-rectangle");
		expect(bars.length).toBe(12);
	});
});
