// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KvMetricsChart } from "@/components/admin/kv-metrics-chart";

vi.mock("@nocoo/basalt/charts/frame", () => ({
	ChartFrame: ({ ariaLabel, children }: { ariaLabel: string; children: React.ReactNode }) => (
		<section aria-label={ariaLabel}>{children}</section>
	),
}));

vi.mock("@nocoo/basalt/charts/tooltip", () => ({
	ChartTooltipContent: () => null,
}));

vi.mock("@nocoo/basalt/charts/config", () => ({
	AXIS_CONFIG: {},
	GRID_PROPS: {},
	getChartColor: () => "#000",
}));

vi.mock("recharts", () => ({
	CartesianGrid: () => null,
	Line: () => null,
	LineChart: ({ data }: { data: unknown[] }) => (
		<pre data-testid="chart-data">{JSON.stringify(data)}</pre>
	),
	Tooltip: () => null,
	XAxis: () => null,
	YAxis: () => null,
}));

afterEach(() => {
	cleanup();
});

it("keeps the ops chart empty when only admin, D1, or footprint rows exist", () => {
	render(
		<KvMetricsChart
			series={[
				{ family: "admin:monitor:overview", tsMinute: 1, op: "hit", count: 9 },
				{ family: "application:d1", tsMinute: 1, op: "d1-query", count: 2 },
				{ family: "footprint:thread:list", tsMinute: 1, op: "observed-keys", count: 4 },
			]}
		/>,
	);
	expect(screen.getByLabelText("缓存运行趋势")).toBeTruthy();
	expect(screen.getAllByTestId("chart-data")[0]?.textContent).toBe("[]");
	expect(screen.getByLabelText("应用观测 D1")).toBeTruthy();
	expect(screen.queryByLabelText("缓存内容量趋势")).toBeNull();
});

it("buckets miss/load as miss, errors separately, and leaves skipped minutes as gaps", () => {
	render(
		<KvMetricsChart
			series={[
				{ family: "forum:tree:v2", tsMinute: 1, op: "hit", count: 3 },
				{ family: "forum:tree:v2", tsMinute: 1, op: "load", count: 1 },
				{ family: "forum:tree:v2", tsMinute: 1, op: "write-error", count: 2 },
				{ family: "forum:tree:v2", tsMinute: 1, op: "kv-put", count: 4 },
				{ family: "forum:tree:v2", tsMinute: 3, op: "miss", count: 5 },
			]}
			occupancy={[
				{
					tsMinute: 1,
					liveEntries: 2,
					staleEntries: null,
					contentBytes: 40,
					kind: "observed",
				},
				{
					tsMinute: 3,
					liveEntries: 1,
					staleEntries: 1,
					contentBytes: 10,
					kind: "at-least",
				},
			]}
		/>,
	);
	const charts = screen.getAllByTestId("chart-data");
	expect(JSON.parse(charts[0].textContent ?? "[]")).toEqual([
		{ tsMinute: 1, hit: 3, miss: 1, error: 2, kvOps: 4 },
		{ tsMinute: 2 },
		{ tsMinute: 3, miss: 5 },
	]);
	expect(screen.getByLabelText("缓存内容量趋势")).toBeTruthy();
	expect(JSON.parse(charts[1].textContent ?? "[]")).toEqual([
		{
			tsMinute: 1,
			liveEntries: 2,
			staleEntries: null,
			contentBytes: 40,
			kind: "observed",
		},
		{ tsMinute: 2 },
		{
			tsMinute: 3,
			liveEntries: 1,
			staleEntries: 1,
			contentBytes: 10,
			kind: "at-least",
		},
	]);
});

it("hides D1 row series until a returned meta actually includes row counts", () => {
	render(
		<KvMetricsChart
			series={[
				{ family: "application:d1", tsMinute: 4, op: "d1-query", count: 1 },
				{ family: "application:d1", tsMinute: 4, op: "d1-duration-ms", count: 8 },
			]}
		/>,
	);
	expect(screen.getByLabelText("应用观测 D1 图例").textContent).toContain("语句次数");
	expect(screen.getByLabelText("应用观测 D1 图例").textContent).not.toContain("读行");
});
