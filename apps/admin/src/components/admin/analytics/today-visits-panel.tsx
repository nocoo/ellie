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

import { Card, CardContent, CardHeader, CardTitle } from "@ellie/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
			<Card>
				<CardHeader>
					<CardTitle className="text-base font-semibold">今日访问</CardTitle>
				</CardHeader>
				<CardContent>
					{kpiError && <p className="text-sm text-destructive">KPI 加载失败：{kpiError}</p>}
					{kpi && (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<KpiCell label="总浏览" value={kpi.totalViews} />
							<KpiCell label="真人" value={kpi.humanViews} tone="success" />
							<KpiCell label="搜索爬虫" value={kpi.botSearchViews} />
							<KpiCell label="其他爬虫" value={kpi.botOtherViews} />
							<KpiCell label="未知" value={kpi.unknownViews} />
							<KpiCell label="覆盖目标" value={kpi.distinctTargets} />
							<KpiCell
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
				</CardContent>
			</Card>

			{/* ── Detail list (realtime, no-store) ────────────────────────── */}
			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<CardTitle className="text-base font-semibold">访问明细</CardTitle>
					<div className="flex flex-wrap gap-1 text-xs">
						<FilterPill
							active={pathKindFilter === ""}
							onClick={() => {
								setPathKindFilter("");
								setPage(1);
							}}
						>
							全部
						</FilterPill>
						{PATH_KIND_VALUES.map((pk) => (
							<FilterPill
								key={pk}
								active={pathKindFilter === pk}
								onClick={() => {
									setPathKindFilter(pk);
									setPage(1);
								}}
							>
								{PATH_KIND_LABELS[pk]}
							</FilterPill>
						))}
					</div>
				</CardHeader>
				<CardContent>
					{listError && <p className="text-sm text-destructive">明细加载失败：{listError}</p>}
					{list && list.rows.length === 0 && (
						<p className="text-sm text-muted-foreground">该筛选条件下暂无记录。</p>
					)}
					{list && list.rows.length > 0 && (
						<div className="overflow-x-auto">
							<table className="min-w-full text-sm">
								<thead>
									<tr className="border-b border-border text-left text-xs text-muted-foreground">
										<th className="py-2 pr-3">类型</th>
										<th className="py-2 pr-3">目标</th>
										<th className="py-2 pr-3 tabular-nums">浏览</th>
										<th className="py-2 pr-3 tabular-nums">真人</th>
										<th className="py-2 pr-3 tabular-nums">爬虫</th>
										<th className="py-2 pr-3 tabular-nums">用户</th>
										<th className="py-2 pr-3">时间窗（首次 / 最近）</th>
									</tr>
								</thead>
								<tbody>
									{list.rows.map((row) => (
										<tr
											key={`${row.pathKind}#${row.targetId}`}
											className="border-b border-border/50"
										>
											<td className="py-2 pr-3 text-xs text-muted-foreground">
												{PATH_KIND_LABELS[row.pathKind]}
											</td>
											<td className="py-2 pr-3 break-all">
												<RowTarget row={row} siteHost={siteHost} />
											</td>
											<td className="py-2 pr-3 tabular-nums">{row.views}</td>
											<td className="py-2 pr-3 tabular-nums">{row.humanViews}</td>
											<td className="py-2 pr-3 tabular-nums">
												{row.botSearchViews + row.botOtherViews}
											</td>
											<td className="py-2 pr-3 tabular-nums">{row.uniqueUsers}</td>
											<td className="whitespace-nowrap py-2 pr-3 tabular-nums text-xs">
												<div>
													<span className="text-muted-foreground">首次：</span>
													{formatTs(row.firstSeenAt)}
												</div>
												<div>
													<span className="text-muted-foreground">最近：</span>
													{formatTs(row.lastSeenAt)}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					{list && (
						<div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
							<span>
								共 {list.total} 条 · 第 {list.page} / {totalPages} 页
							</span>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => setPage((p) => Math.max(1, p - 1))}
									disabled={page <= 1}
									className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
								>
									上一页
								</button>
								<button
									type="button"
									onClick={() => setPage((p) => p + 1)}
									disabled={page >= totalPages}
									className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
								>
									下一页
								</button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</>
	);
}

// ---------------------------------------------------------------------------
// Small leaf components
// ---------------------------------------------------------------------------

function KpiCell({
	label,
	value,
	tone,
	hint,
}: {
	label: string;
	value: number;
	tone?: "success" | "danger";
	hint?: string;
}) {
	const toneCls =
		tone === "success"
			? "text-emerald-700 dark:text-emerald-300"
			: tone === "danger"
				? "text-destructive"
				: "text-foreground";
	return (
		<div className="rounded-md bg-muted p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
			{hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
		</div>
	);
}

function FilterPill({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-md border px-2 py-1 transition-colors ${
				active
					? "border-primary bg-primary/10 text-foreground"
					: "border-border text-muted-foreground hover:bg-accent"
			}`}
		>
			{children}
		</button>
	);
}
