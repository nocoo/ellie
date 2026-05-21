"use client";

import { ForumDistChart } from "@/components/admin/analytics/forum-dist-chart";
import { LoginAttemptsPanel } from "@/components/admin/analytics/login-attempts-panel";
import { TrendChart } from "@/components/admin/analytics/trend-chart";
import { StatCard } from "@/components/admin/stat-card";
import {
	ANALYTICS_RANGES,
	ANALYTICS_TREND_METRICS,
	type AnalyticsCheckinTrend,
	type AnalyticsForumDist,
	type AnalyticsOverview,
	type AnalyticsRange,
	type AnalyticsTrend,
	type AnalyticsTrendMetric,
	METRIC_LABELS,
	RANGE_LABELS,
	parseCheckinTrend,
	parseForumDist,
	parseOverview,
	parseTrend,
} from "@/viewmodels/admin/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@ellie/ui";
import { CalendarCheck, FileText, MessageSquare, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, parse: (raw: unknown) => T): Promise<T> {
	const res = await fetch(url, { credentials: "include" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { data?: unknown };
	return parse(body.data);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
	const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
	const [overviewError, setOverviewError] = useState<string | null>(null);

	const [metric, setMetric] = useState<AnalyticsTrendMetric>("users");
	const [range, setRange] = useState<AnalyticsRange>("7d");

	const [trend, setTrend] = useState<AnalyticsTrend | null>(null);
	const [trendError, setTrendError] = useState<string | null>(null);

	const [forumDist, setForumDist] = useState<AnalyticsForumDist | null>(null);
	const [forumDistError, setForumDistError] = useState<string | null>(null);

	const [checkin, setCheckin] = useState<AnalyticsCheckinTrend | null>(null);
	const [checkinError, setCheckinError] = useState<string | null>(null);

	const loadOverview = useCallback(async () => {
		try {
			setOverview(await fetchJson("/api/admin/analytics/overview", parseOverview));
			setOverviewError(null);
		} catch (e) {
			setOverviewError(e instanceof Error ? e.message : "加载失败");
		}
	}, []);

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
		loadOverview();
	}, [loadOverview]);
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
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-semibold text-foreground">数据分析</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					今日 KPI 与近期趋势（基于业务表实时聚合，KV 缓存 60s ~ 5min）
				</p>
			</div>

			{/* ── KPI cards ─────────────────────────────────────── */}
			{overviewError && (
				<div className="rounded-[var(--radius-card,14px)] bg-destructive/10 p-4 text-sm text-destructive">
					今日 KPI 加载失败：{overviewError}
				</div>
			)}
			{overview && (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<StatCard label="今日新注册" value={overview.today.newUsers} icon={Users} />
					<StatCard label="今日新主题" value={overview.today.newThreads} icon={FileText} />
					<StatCard label="今日新回复" value={overview.today.newPosts} icon={MessageSquare} />
					<StatCard label="今日签到" value={overview.today.checkins} icon={CalendarCheck} />
				</div>
			)}

			{/* ── Range selector (shared across all trend charts) ─ */}
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-muted-foreground">时间范围:</span>
				{ANALYTICS_RANGES.map((r) => (
					<button
						type="button"
						key={r}
						onClick={() => setRange(r)}
						className={`rounded-md border px-3 py-1 text-sm transition-colors ${
							range === r
								? "border-primary bg-primary/10 text-foreground"
								: "border-border text-muted-foreground hover:bg-accent"
						}`}
					>
						{RANGE_LABELS[r]}
					</button>
				))}
			</div>

			{/* ── Trend chart with metric switcher ───────────────── */}
			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<CardTitle className="text-base font-semibold">趋势曲线</CardTitle>
					<div className="flex flex-wrap gap-2">
						{ANALYTICS_TREND_METRICS.map((m) => (
							<button
								type="button"
								key={m}
								onClick={() => setMetric(m)}
								className={`rounded-md border px-3 py-1 text-xs transition-colors ${
									metric === m
										? "border-primary bg-primary/10 text-foreground"
										: "border-border text-muted-foreground hover:bg-accent"
								}`}
							>
								{METRIC_LABELS[m]}
							</button>
						))}
					</div>
				</CardHeader>
				<CardContent>
					{trendError && <p className="text-sm text-destructive">趋势加载失败：{trendError}</p>}
					{trend && <TrendChart series={trend.series} valueLabel={METRIC_LABELS[trend.metric]} />}
				</CardContent>
			</Card>

			{/* ── Per-forum distribution ─────────────────────────── */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base font-semibold">
						{RANGE_LABELS[range]} 各版块发帖分布
					</CardTitle>
				</CardHeader>
				<CardContent>
					{forumDistError && (
						<p className="text-sm text-destructive">分布加载失败：{forumDistError}</p>
					)}
					{forumDist && forumDist.rows.length > 0 && <ForumDistChart rows={forumDist.rows} />}
					{forumDist && forumDist.rows.length === 0 && (
						<p className="text-sm text-muted-foreground">该时段暂无发帖数据。</p>
					)}
				</CardContent>
			</Card>

			{/* ── Check-in trend ─────────────────────────────────── */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base font-semibold">{RANGE_LABELS[range]} 签到趋势</CardTitle>
				</CardHeader>
				<CardContent>
					{checkinError && <p className="text-sm text-destructive">签到加载失败：{checkinError}</p>}
					{checkin && (
						<TrendChart
							series={checkin.series}
							color="var(--color-chart-tertiary, #f59e0b)"
							valueLabel="签到"
						/>
					)}
				</CardContent>
			</Card>

			{/* ── Today's login-attempt audit (P4) ───────────────── */}
			<LoginAttemptsPanel />
		</div>
	);
}
