"use client";

/**
 * Today's page-view visits panel (P5).
 *
 * KPI summary row + paginated per-target list. Mirrors the
 * `LoginAttemptsPanel` (P4) structure: own fetch state for (a) the KPI
 * card (KV-cached on the worker, 60s) and (b) the realtime per-target
 * list (no-store). The list is filterable by `path_kind` (10-bucket
 * whitelist mirrored from the worker enum).
 *
 * Link routing rules (frozen — reviewer pin):
 *   - thread → /admin/threads/:id     (internal admin)
 *   - user   → /admin/users/:id       (internal admin)
 *   - forum  → /forums/:id            (public, target=_blank)
 *   - other path_kinds → label only, no link.
 *
 * The KPI counter labeled "活跃用户/访客（含匿名）" is
 * `activeUsers + anonPresent` — NOT "独立访客". The aggregate has no
 * per-session dedup; the wording reflects what the data can support.
 */

import { LayerCard, SegmentControl, TablePager } from "@nocoo/basalt";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/admin/stat-card";
import {
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
				className="text-foreground hover:text-primary hover:underline"
			>
				{label}
				<span className="ml-1 text-xs text-muted-foreground">#{row.targetId}</span>
			</Link>
		);
	}
	if (row.pathKind === "user" && row.targetId > 0) {
		return (
			<Link
				href={`/admin/users/${row.targetId}`}
				className="text-foreground hover:text-primary hover:underline"
			>
				{label}
				<span className="ml-1 text-xs text-muted-foreground">#{row.targetId}</span>
			</Link>
		);
	}
	if (row.pathKind === "forum" && row.targetId > 0) {
		return (
			<a
				href={`${siteHost}/forums/${row.targetId}`}
				target="_blank"
				rel="noopener noreferrer"
				className="text-foreground hover:text-primary hover:underline"
			>
				{label}
				<span className="ml-1 text-xs text-muted-foreground">#{row.targetId} ↗</span>
			</a>
		);
	}
	return <span className="text-foreground">{PATH_KIND_LABELS[row.pathKind]}</span>;
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
	const activeOrAnon = kpi ? kpi.activeUsers + kpi.anonPresent : 0;

	return (
		<>
			{/* ── KPI row (aggregate, KV-cached on worker) ────────────────── */}
			<LayerCard>
				<LayerCard.Header>
					<h2 className="text-sm font-medium text-base font-semibold">今日访问</h2>
				</LayerCard.Header>
				<LayerCard.Well>
					{kpiError && <p className="text-sm text-destructive">KPI 加载失败：{kpiError}</p>}
					{kpi && (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<StatCard label="总浏览" value={kpi.totalViews} />
							<StatCard label="真人" value={kpi.humanViews} tone="success" />
							<StatCard label="搜索爬虫" value={kpi.botSearchViews} />
							<StatCard label="其他爬虫" value={kpi.botOtherViews} />
							<StatCard label="未知" value={kpi.unknownViews} />
							<StatCard label="覆盖目标" value={kpi.distinctTargets} />
							<StatCard
								label="活跃用户/访客（含匿名）"
								value={activeOrAnon}
								hint={
									kpi.anonPresent === 1
										? `${kpi.activeUsers} 注册 + 匿名`
										: `${kpi.activeUsers} 注册`
								}
							/>
						</div>
					)}
				</LayerCard.Well>
			</LayerCard>

			{/* ── Detail list (realtime, no-store) ────────────────────────── */}
			<LayerCard>
				<LayerCard.Header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<h2 className="text-sm font-medium text-base font-semibold">访问明细</h2>
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
					{listError && <p className="text-sm text-destructive">明细加载失败：{listError}</p>}
					{list && list.rows.length === 0 && (
						<p className="text-sm text-muted-foreground">该筛选条件下暂无记录。</p>
					)}
					{list && list.rows.length > 0 && (
						<div className="overflow-x-auto">
							<Table className="min-w-full text-sm">
								<TableHeader>
									<TableRow className="border-b border-border text-left text-xs text-muted-foreground">
										<TableHead className="py-2 pr-3">类型</TableHead>
										<TableHead className="py-2 pr-3">目标</TableHead>
										<TableHead className="py-2 pr-3 tabular-nums">浏览</TableHead>
										<TableHead className="py-2 pr-3 tabular-nums">真人</TableHead>
										<TableHead className="py-2 pr-3 tabular-nums">爬虫</TableHead>
										<TableHead className="py-2 pr-3 tabular-nums">用户</TableHead>
										<TableHead className="py-2 pr-3">时间窗（首次 / 最近）</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{list.rows.map((row) => (
										<TableRow
											key={`${row.pathKind}#${row.targetId}`}
											className="border-b border-border/50"
										>
											<TableCell className="py-2 pr-3 text-xs text-muted-foreground">
												{PATH_KIND_LABELS[row.pathKind]}
											</TableCell>
											<TableCell className="py-2 pr-3 break-all">
												<RowTarget row={row} siteHost={siteHost} />
											</TableCell>
											<TableCell className="py-2 pr-3 tabular-nums">{row.views}</TableCell>
											<TableCell className="py-2 pr-3 tabular-nums">{row.humanViews}</TableCell>
											<TableCell className="py-2 pr-3 tabular-nums">
												{row.botSearchViews + row.botOtherViews}
											</TableCell>
											<TableCell className="py-2 pr-3 tabular-nums">{row.uniqueUsers}</TableCell>
											<TableCell className="whitespace-nowrap py-2 pr-3 tabular-nums text-xs">
												<div>
													<span className="text-muted-foreground">首次：</span>
													{formatTs(row.firstSeenAt)}
												</div>
												<div>
													<span className="text-muted-foreground">最近：</span>
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
