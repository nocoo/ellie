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

import { formatNumber } from "@ellie/shared";
import {
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	LayerCard,
	SegmentControl,
} from "@nocoo/basalt";
import { Loader } from "@nocoo/basalt/components/loader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import {
	CalendarCheck,
	CalendarDays,
	ChartNoAxesCombined,
	ChevronDown,
	ListFilter,
	MessagesSquare,
	RefreshCw,
} from "lucide-react";
import Link from "next/link";

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
	metricShare,
	parseCheckinTrend,
	parseForumDist,
	parseTrend,
	RANGE_LABELS,
} from "@/viewmodels/admin/analytics";

async function fetchJson<T>(
	url: string,
	parse: (raw: unknown) => T,
	signal: AbortSignal,
): Promise<T> {
	const res = await fetch(url, { credentials: "include", signal });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { data?: unknown };
	return parse(body.data);
}

export function TrendTab(): React.JSX.Element {
	const [revision, setRevision] = useState(0);
	const [metric, setMetric] = useState<AnalyticsTrendMetric>("users");
	const [range, setRange] = useState<AnalyticsRange>("7d");

	const [trend, setTrend] = useState<AnalyticsTrend | null>(null);
	const [trendError, setTrendError] = useState<string | null>(null);

	const [forumDist, setForumDist] = useState<AnalyticsForumDist | null>(null);
	const [forumDistError, setForumDistError] = useState<string | null>(null);

	const [checkin, setCheckin] = useState<AnalyticsCheckinTrend | null>(null);
	const [checkinError, setCheckinError] = useState<string | null>(null);

	const loadTrend = useCallback(
		async (signal: AbortSignal) => {
			setTrend(null);
			setTrendError(null);
			try {
				const next = await fetchJson(
					`/api/admin/analytics/trend?metric=${metric}&range=${range}`,
					(raw) => parseTrend(raw, metric, range),
					signal,
				);
				if (signal.aborted) return;
				setTrend(next);
				setTrendError(null);
			} catch (e) {
				if (!signal.aborted) setTrendError(e instanceof Error ? e.message : "加载失败");
			}
		},
		[metric, range],
	);

	const loadForumDist = useCallback(
		async (signal: AbortSignal) => {
			setForumDist(null);
			setForumDistError(null);
			try {
				const next = await fetchJson(
					`/api/admin/analytics/forum-dist?range=${range}`,
					(raw) => parseForumDist(raw, range),
					signal,
				);
				if (signal.aborted) return;
				setForumDist(next);
				setForumDistError(null);
			} catch (e) {
				if (!signal.aborted) setForumDistError(e instanceof Error ? e.message : "加载失败");
			}
		},
		[range],
	);

	const loadCheckin = useCallback(
		async (signal: AbortSignal) => {
			setCheckin(null);
			setCheckinError(null);
			try {
				const next = await fetchJson(
					`/api/admin/analytics/checkin?range=${range}`,
					(raw) => parseCheckinTrend(raw, range),
					signal,
				);
				if (signal.aborted) return;
				setCheckin(next);
				setCheckinError(null);
			} catch (e) {
				if (!signal.aborted) setCheckinError(e instanceof Error ? e.message : "加载失败");
			}
		},
		[range],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit refresh action
	useEffect(() => {
		const controller = new AbortController();
		void loadTrend(controller.signal);
		return () => controller.abort();
	}, [loadTrend, revision]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit refresh action
	useEffect(() => {
		const controller = new AbortController();
		void loadForumDist(controller.signal);
		return () => controller.abort();
	}, [loadForumDist, revision]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit refresh action
	useEffect(() => {
		const controller = new AbortController();
		void loadCheckin(controller.signal);
		return () => controller.abort();
	}, [loadCheckin, revision]);

	const forumTotal = forumDist?.rows.reduce((total, row) => total + row.posts, 0) ?? 0;
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<SegmentControl
					legend="时间范围"
					value={range}
					onValueChange={(value) => setRange(value as AnalyticsRange)}
					options={ANALYTICS_RANGES.map((value) => ({ value, label: RANGE_LABELS[value] }))}
				/>
				<div className="flex items-center gap-3">
					<span className="flex items-center gap-1.5 text-xs text-basalt-muted-foreground">
						<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
						上海时区 · 含今日
					</span>
					<Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>
						<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
						刷新趋势
					</Button>
				</div>
			</div>
			<LayerCard className="min-w-0">
				<LayerCard.Header className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="flex items-center gap-2 text-sm font-semibold">
						<ChartNoAxesCombined className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
						趋势曲线
					</h2>
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
				<LayerCard.Well className="flex-1">
					{trendError && (
						<p role="alert" className="text-sm text-basalt-destructive">
							趋势加载失败：{trendError}
						</p>
					)}
					{!trend && !trendError && (
						<div
							role="status"
							className="flex h-60 items-center justify-center gap-2 text-sm text-basalt-muted-foreground"
						>
							<Loader size={16} />
							加载趋势…
						</div>
					)}
					{trend && <TrendChart series={trend.series} valueLabel={METRIC_LABELS[trend.metric]} />}
				</LayerCard.Well>
			</LayerCard>
			<div className="grid gap-4 xl:grid-cols-2">
				<LayerCard className="min-w-0">
					<LayerCard.Header className="flex flex-wrap items-center justify-between gap-2">
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<MessagesSquare className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
							{RANGE_LABELS[range]} 各版块发帖分布
						</h2>
						<span className="text-xs text-basalt-muted-foreground">
							{forumDist
								? `${forumDist.rows.length} 个版块 · ${formatNumber(forumTotal)} 条帖子（含首帖）`
								: "加载中"}
						</span>
					</LayerCard.Header>
					<LayerCard.Well className="flex-1 space-y-3">
						{forumDistError && (
							<p role="alert" className="text-sm text-basalt-destructive">
								分布加载失败：{forumDistError}
							</p>
						)}
						{!forumDist && !forumDistError && (
							<div role="status" className="flex h-60 items-center justify-center">
								<Loader size={16} />
							</div>
						)}
						{forumDist && forumDist.rows.length > 0 && (
							<>
								<ForumDistChart rows={forumDist.rows} />
								<p className="text-xs text-basalt-muted-foreground">
									统计发帖最多的前 50 个版块，占比以这些版块的帖子总数为分母。
								</p>
								<Collapsible>
									<CollapsibleTrigger asChild>
										<Button size="sm" variant="ghost" className="w-full justify-between">
											<span className="flex items-center gap-2">
												<ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
												已统计版块明细与占比
											</span>
											<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
										</Button>
									</CollapsibleTrigger>
									<CollapsibleContent unstyled className="overflow-x-auto pt-2">
										<Table className="text-sm">
											<TableHeader>
												<TableRow>
													<TableHead className="px-3 py-2">版块</TableHead>
													<TableHead className="px-3 py-2 text-right">帖子（含首帖）</TableHead>
													<TableHead className="px-3 py-2 text-right">占已统计版块</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{forumDist.rows.map((row) => (
													<TableRow key={row.forumId}>
														<TableCell className="px-3 py-2">
															<Link
																href={`/admin/threads?forumId=${row.forumId}`}
																className="text-basalt-foreground hover:underline"
															>
																{row.forumName}
															</Link>
														</TableCell>
														<TableCell className="px-3 py-2 text-right tabular-nums">
															{formatNumber(row.posts)}
														</TableCell>
														<TableCell className="px-3 py-2 text-right tabular-nums">
															{metricShare(row.posts, forumTotal)}
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</CollapsibleContent>
								</Collapsible>
							</>
						)}
						{forumDist && forumDist.rows.length === 0 && (
							<p className="py-16 text-center text-sm text-basalt-muted-foreground">
								该时段暂无发帖数据。
							</p>
						)}
					</LayerCard.Well>
				</LayerCard>
				<LayerCard className="min-w-0">
					<LayerCard.Header>
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<CalendarCheck className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
							{RANGE_LABELS[range]} 签到趋势
						</h2>
					</LayerCard.Header>
					<LayerCard.Well className="flex-1">
						{checkinError && (
							<p role="alert" className="text-sm text-basalt-destructive">
								签到加载失败：{checkinError}
							</p>
						)}
						{!checkin && !checkinError && (
							<div role="status" className="flex h-60 items-center justify-center">
								<Loader size={16} />
							</div>
						)}
						{checkin && (
							<TrendChart
								series={checkin.series}
								color="hsl(var(--basalt-chart-3))"
								valueLabel="签到"
							/>
						)}
					</LayerCard.Well>
				</LayerCard>
			</div>
		</div>
	);
}
