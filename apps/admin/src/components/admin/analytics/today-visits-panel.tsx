"use client";

/** Volatile page totals and bot classification without per-user tracking. */

import { formatNumber } from "@ellie/shared";
import { Button, LayerCard, SegmentControl, TablePager } from "@nocoo/basalt";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import {
	Bot,
	CircleHelp,
	Compass,
	Eye,
	Globe,
	LayoutList,
	MousePointer2,
	Search,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import {
	metricShare,
	PATH_KIND_LABELS,
	PATH_KIND_VALUES,
	type PathKind,
	parseTodayVisitsKpi,
	parseTodayVisitsList,
	type TodayVisitsKpi,
	type TodayVisitsList,
	type TodayVisitsListRow,
} from "@/viewmodels/admin/analytics";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, parse: (raw: unknown) => T): Promise<T> {
	const res = await fetch(url, { credentials: "include" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { data?: unknown };
	return parse(body.data);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatTs(ts: number): string {
	if (!ts) return "—";
	const d = new Date(ts * 1000);
	return d.toLocaleString("zh-CN", { hour12: false });
}

/**
 * Render the row's link target per the frozen routing rules.
 * Returns a React node — anchor / link / span — never null.
 */
function RowTarget({ row, siteHost }: { row: TodayVisitsListRow; siteHost: string }) {
	const label =
		row.label || (row.targetId > 0 ? `#${row.targetId}` : PATH_KIND_LABELS[row.pathKind]);
	if (row.pathKind === "thread" && row.targetId > 0) {
		return (
			<Link
				href={`/admin/threads/${row.targetId}`}
				className="text-basalt-foreground hover:text-basalt-primary hover:underline"
			>
				{label}
				<span className="ml-1 text-xs text-basalt-muted-foreground">#{row.targetId}</span>
			</Link>
		);
	}
	if (row.pathKind === "user" && row.targetId > 0) {
		return (
			<Link
				href={`/admin/users/${row.targetId}`}
				className="text-basalt-foreground hover:text-basalt-primary hover:underline"
			>
				{label}
				<span className="ml-1 text-xs text-basalt-muted-foreground">#{row.targetId}</span>
			</Link>
		);
	}
	if (row.pathKind === "forum" && row.targetId > 0) {
		return (
			<a
				href={`${siteHost}/forums/${row.targetId}`}
				target="_blank"
				rel="noopener noreferrer"
				className="text-basalt-foreground hover:text-basalt-primary hover:underline"
			>
				{label}
				<span className="ml-1 text-xs text-basalt-muted-foreground">#{row.targetId} ↗</span>
			</a>
		);
	}
	return <span className="text-basalt-foreground">{PATH_KIND_LABELS[row.pathKind]}</span>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

type PathKindFilter = "" | PathKind;

export function TodayVisitsPanel() {
	const [kpi, setKpi] = useState<TodayVisitsKpi | null>(null);
	const [kpiError, setKpiError] = useState<string | null>(null);

	const [list, setList] = useState<TodayVisitsList | null>(null);
	const [listError, setListError] = useState<string | null>(null);

	const [page, setPage] = useState(1);
	const [pathKindFilter, setPathKindFilter] = useState<PathKindFilter>("");

	const [siteHost, setSiteHost] = useState("");

	const loadKpi = useCallback(async () => {
		try {
			setKpi(await fetchJson("/api/admin/analytics/today/visits", parseTodayVisitsKpi));
			setKpiError(null);
		} catch (e) {
			setKpiError(e instanceof Error ? e.message : "加载失败");
		}
	}, []);

	const loadList = useCallback(async () => {
		const params = new URLSearchParams();
		params.set("page", String(page));
		params.set("limit", String(PAGE_SIZE));
		if (pathKindFilter) params.set("path_kind", pathKindFilter);
		try {
			setList(
				await fetchJson(
					`/api/admin/analytics/today/visits/list?${params.toString()}`,
					parseTodayVisitsList,
				),
			);
			setListError(null);
		} catch (e) {
			setListError(e instanceof Error ? e.message : "加载失败");
		}
	}, [page, pathKindFilter]);

	useEffect(() => {
		loadKpi();
		fetch("/api/admin/settings?prefix=general.site", { credentials: "include" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { data?: Record<string, { value: string }> } | null) => {
				const host = body?.data?.["general.site.host"]?.value;
				if (host) setSiteHost(host.replace(/\/$/, ""));
			})
			.catch(() => {});
	}, [loadKpi]);
	useEffect(() => {
		loadList();
	}, [loadList]);

	const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1;

	return (
		<>
			<section className="space-y-3" aria-label="今日访问概览">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<Globe className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
					今日访问
				</h2>
				<p className="text-xs text-basalt-muted-foreground">
					仅保留本次运行期间的访问数据，服务重启后清零；采集约延迟 30 秒，不统计访问人数。
				</p>
				{(kpi?.droppedViews ?? 0) > 0 && (
					<p className="text-xs text-basalt-muted-foreground">
						统计容量已满，部分新页面访问未计入。
					</p>
				)}
				{kpiError && (
					<p role="alert" className="text-sm text-basalt-destructive">
						KPI 加载失败：{kpiError}
					</p>
				)}
				{kpi && (
					<>
						<AdminMetrics
							label="今日访问统计"
							items={[
								{ label: "总浏览", value: kpi.totalViews, icon: Eye, hint: kpi.dateLocal },
								{
									label: "真人",
									value: kpi.humanViews,
									icon: MousePointer2,
									hint: `占全部 ${metricShare(kpi.humanViews, kpi.totalViews)}`,
								},
								{
									label: "搜索爬虫",
									value: kpi.botSearchViews,
									icon: Search,
									hint: `占全部 ${metricShare(kpi.botSearchViews, kpi.totalViews)}`,
								},
								{
									label: "其他爬虫",
									value: kpi.botOtherViews,
									icon: Bot,
									hint: `占全部 ${metricShare(kpi.botOtherViews, kpi.totalViews)}`,
								},
								{ label: "未知", value: kpi.unknownViews, icon: CircleHelp },
								{ label: "覆盖目标", value: kpi.distinctTargets, icon: Compass },
								{
									label: "每目标浏览",
									value: kpi.distinctTargets
										? (kpi.totalViews / kpi.distinctTargets).toLocaleString("zh-CN", {
												maximumFractionDigits: 1,
											})
										: "—",
									icon: LayoutList,
									hint: "浏览量 / 覆盖目标",
								},
							]}
						/>
						{kpi.byPathKind.length > 0 && (
							<LayerCard padding="sm">
								<div className="mb-2 flex items-center gap-2 px-2 text-xs text-basalt-muted-foreground">
									<LayoutList className="h-3.5 w-3.5" aria-hidden="true" />
									访问内容构成 · 点击筛选明细
								</div>
								<div className="grid grid-cols-2 gap-1 lg:grid-cols-5">
									{kpi.byPathKind.map((entry) => (
										<Button
											key={entry.pathKind}
											variant={pathKindFilter === entry.pathKind ? "secondary" : "ghost"}
											className="h-auto justify-between gap-2 px-2 py-2"
											aria-pressed={pathKindFilter === entry.pathKind}
											onClick={() => {
												setPathKindFilter(entry.pathKind);
												setPage(1);
											}}
										>
											<span className="text-left text-xs">
												{PATH_KIND_LABELS[entry.pathKind]}
												<span className="mt-0.5 block text-[11px] text-basalt-muted-foreground">
													{entry.targets} 个目标
												</span>
											</span>
											<span className="text-right text-sm tabular-nums">
												{formatNumber(entry.views)}
												<span className="mt-0.5 block text-[11px] text-basalt-muted-foreground">
													{metricShare(entry.views, kpi.totalViews)}
												</span>
											</span>
										</Button>
									))}
								</div>
							</LayerCard>
						)}
					</>
				)}
			</section>

			{/* ── Detail list (realtime, no-store) ────────────────────────── */}
			<LayerCard>
				<LayerCard.Header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<h2 className="flex items-center gap-2 text-sm font-semibold">
						<LayoutList className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
						访问明细
					</h2>
					<SegmentControl
						legend="访问类型"
						value={pathKindFilter || "__empty__"}
						onValueChange={(value) => {
							setPathKindFilter(value === "__empty__" ? "" : (value as PathKindFilter));
							setPage(1);
						}}
						allOption={{ value: "__empty__", label: "全部" }}
						options={PATH_KIND_VALUES.map((value) => ({ value, label: PATH_KIND_LABELS[value] }))}
					/>
				</LayerCard.Header>
				<LayerCard.Well>
					{listError && (
						<p className="text-sm text-basalt-destructive">明细加载失败：{listError}</p>
					)}
					{list && list.rows.length === 0 && (
						<p className="text-sm text-basalt-muted-foreground">该筛选条件下暂无记录。</p>
					)}
					{list && list.rows.length > 0 && (
						<div className="max-h-[68vh] overflow-auto">
							<Table aria-label="访问明细" className="min-w-full whitespace-nowrap text-sm">
								<TableHeader className="sticky top-0 z-10 bg-basalt-bright">
									<TableRow className="border-b border-basalt-border text-left text-xs text-basalt-muted-foreground">
										<TableHead className="py-2 pr-3">类型</TableHead>
										<TableHead className="py-2 pr-3">目标</TableHead>
										<TableHead className="py-2 pr-3 tabular-nums">浏览</TableHead>
										<TableHead className="py-2 pr-3 tabular-nums">真人</TableHead>
										<TableHead className="py-2 pr-3 text-right">真人占比</TableHead>
										<TableHead className="py-2 pr-3 tabular-nums">爬虫</TableHead>
										<TableHead className="py-2 pr-3 text-right">未识别</TableHead>
										<TableHead className="py-2 pr-3">时间窗（首次 / 最近）</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{list.rows.map((row) => (
										<TableRow
											key={`${row.pathKind}#${row.targetId}`}
											className="border-b border-basalt-border/50"
										>
											<TableCell className="py-2 pr-3 text-xs text-basalt-muted-foreground">
												{PATH_KIND_LABELS[row.pathKind]}
											</TableCell>
											<TableCell className="max-w-[360px] truncate py-2 pr-3" title={row.label}>
												<RowTarget row={row} siteHost={siteHost} />
											</TableCell>
											<TableCell className="py-2 pr-3 tabular-nums">{row.views}</TableCell>
											<TableCell className="py-2 pr-3 tabular-nums">{row.humanViews}</TableCell>
											<TableCell className="py-2 pr-3 text-right tabular-nums text-basalt-muted-foreground">
												{metricShare(row.humanViews, row.views)}
											</TableCell>
											<TableCell className="py-2 pr-3 tabular-nums">
												{row.botSearchViews + row.botOtherViews}
											</TableCell>
											<TableCell className="py-2 pr-3 text-right tabular-nums">
												{row.unknownViews}
											</TableCell>
											<TableCell className="whitespace-nowrap py-2 pr-3 tabular-nums text-xs">
												<div>
													<span className="text-basalt-muted-foreground">首次：</span>
													{formatTs(row.firstSeenAt)}
												</div>
												<div>
													<span className="text-basalt-muted-foreground">最近：</span>
													{formatTs(row.lastSeenAt)}
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
					{list && (
						<TablePager
							page={page}
							pageSize={list.limit}
							totalCount={list.total}
							onPageChange={setPage}
							className="mt-3"
							formatRange={({ totalCount }) =>
								`共 ${totalCount} 条 · 第 ${page} / ${totalPages} 页`
							}
						/>
					)}
				</LayerCard.Well>
			</LayerCard>
		</>
	);
}
