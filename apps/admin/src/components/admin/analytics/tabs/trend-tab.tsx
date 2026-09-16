"use client";

// Trend tab — extracted from the analytics page so the three top-level
// analytics views (趋势 / 审计 / 登录) can mount and unmount independently.
//
// Owns metric + range selectors and drives three charts:
//   - TrendChart (metric × range)
//   - ForumDistChart (range)
//   - Checkin TrendChart (range)
//
// Each chart has its own loader + error slot, mirroring the previous inline
// page implementation.

import { LayerCard, SegmentControl } from "@nocoo/basalt";

import { useCallback, useEffect, useState } from "react";
import { ForumDistChart } from "@/components/admin/analytics/forum-dist-chart";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import {
	ANALYTICS_RANGES,
	ANALYTICS_TREND_METRICS,
	type AnalyticsCheckinTrend,
	type AnalyticsForumDist,
	type AnalyticsRange,
	type AnalyticsTrend,
	type AnalyticsTrendMetric,
	METRIC_LABELS,
	parseCheckinTrend,
	parseForumDist,
	parseTrend,
	RANGE_LABELS,
} from "@/viewmodels/admin/analytics";

async function fetchJson<T>(url: string, parse: (raw: unknown) => T): Promise<T> {
	const res = await fetch(url, { credentials: "include" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { data?: unknown };
	return parse(body.data);
}

export function TrendTab(): React.JSX.Element {
	const [metric, setMetric] = useState<AnalyticsTrendMetric>("users");
	const [range, setRange] = useState<AnalyticsRange>("7d");

	const [trend, setTrend] = useState<AnalyticsTrend | null>(null);
	const [trendError, setTrendError] = useState<string | null>(null);

	const [forumDist, setForumDist] = useState<AnalyticsForumDist | null>(null);
	const [forumDistError, setForumDistError] = useState<string | null>(null);

	const [checkin, setCheckin] = useState<AnalyticsCheckinTrend | null>(null);
	const [checkinError, setCheckinError] = useState<string | null>(null);

	const loadTrend = useCallback(async () => {
		try {
			setTrend(
				await fetchJson(`/api/admin/analytics/trend?metric=${metric}&range=${range}`, (raw) =>
					parseTrend(raw, metric, range),
				),
			);
			setTrendError(null);
		} catch (e) {
			setTrendError(e instanceof Error ? e.message : "加载失败");
		}
	}, [metric, range]);

	const loadForumDist = useCallback(async () => {
		try {
			setForumDist(
				await fetchJson(`/api/admin/analytics/forum-dist?range=${range}`, (raw) =>
					parseForumDist(raw, range),
				),
			);
			setForumDistError(null);
		} catch (e) {
			setForumDistError(e instanceof Error ? e.message : "加载失败");
		}
	}, [range]);

	const loadCheckin = useCallback(async () => {
		try {
			setCheckin(
				await fetchJson(`/api/admin/analytics/checkin?range=${range}`, (raw) =>
					parseCheckinTrend(raw, range),
				),
			);
			setCheckinError(null);
		} catch (e) {
			setCheckinError(e instanceof Error ? e.message : "加载失败");
		}
	}, [range]);

	useEffect(() => {
		loadTrend();
	}, [loadTrend]);
	useEffect(() => {
		loadForumDist();
	}, [loadForumDist]);
	useEffect(() => {
		loadCheckin();
	}, [loadCheckin]);

	return (
		<div className="space-y-4 md:space-y-6">
			<SegmentControl
				legend="时间范围"
				value={range}
				onValueChange={(value) => setRange(value as AnalyticsRange)}
				options={ANALYTICS_RANGES.map((value) => ({ value, label: RANGE_LABELS[value] }))}
			/>

			<LayerCard>
				<LayerCard.Header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h2 className="text-sm font-medium text-base font-semibold">趋势曲线</h2>
					<SegmentControl
						legend="指标"
						value={metric}
						onValueChange={(value) => setMetric(value as AnalyticsTrendMetric)}
						options={ANALYTICS_TREND_METRICS.map((value) => ({
							value,
							label: METRIC_LABELS[value],
						}))}
					/>
				</LayerCard.Header>
				<LayerCard.Well>
					{trendError && <p className="text-sm text-destructive">趋势加载失败：{trendError}</p>}
					{trend && <TrendChart series={trend.series} valueLabel={METRIC_LABELS[trend.metric]} />}
				</LayerCard.Well>
			</LayerCard>

			<LayerCard>
				<LayerCard.Header>
					<h2 className="text-sm font-medium text-base font-semibold">
						{RANGE_LABELS[range]} 各版块发帖分布
					</h2>
				</LayerCard.Header>
				<LayerCard.Well>
					{forumDistError && (
						<p className="text-sm text-destructive">分布加载失败：{forumDistError}</p>
					)}
					{forumDist && forumDist.rows.length > 0 && <ForumDistChart rows={forumDist.rows} />}
					{forumDist && forumDist.rows.length === 0 && (
						<p className="text-sm text-muted-foreground">该时段暂无发帖数据。</p>
					)}
				</LayerCard.Well>
			</LayerCard>

			<LayerCard>
				<LayerCard.Header>
					<h2 className="text-sm font-medium text-base font-semibold">
						{RANGE_LABELS[range]} 签到趋势
					</h2>
				</LayerCard.Header>
				<LayerCard.Well>
					{checkinError && <p className="text-sm text-destructive">签到加载失败：{checkinError}</p>}
					{checkin && (
						<TrendChart
							series={checkin.series}
							color="hsl(var(--basalt-chart-7))"
							valueLabel="签到"
						/>
					)}
				</LayerCard.Well>
			</LayerCard>
		</div>
	);
}
