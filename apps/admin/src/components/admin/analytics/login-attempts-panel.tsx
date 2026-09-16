"use client";

/**
 * Today's login-attempt audit panel (P4).
 *
 * KPI summary card row + detail list with raw IP/UA (admin-only, no masking).
 */

import { Badge, LayerCard, SegmentControl, TablePager } from "@nocoo/basalt";
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
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import { StatCard } from "@/components/admin/stat-card";
import {
	type LoginAttemptList,
	parseLoginAttemptList,
	parseTodayLoginsKpi,
	type TodayLoginsKpi,
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

type OkFilter = "" | "0" | "1";
type KindFilter = "" | "login" | "register";

export function LoginAttemptsPanel() {
	const [kpi, setKpi] = useState<TodayLoginsKpi | null>(null);
	const [kpiError, setKpiError] = useState<string | null>(null);

	const [list, setList] = useState<LoginAttemptList | null>(null);
	const [listError, setListError] = useState<string | null>(null);

	const [page, setPage] = useState(1);
	const [okFilter, setOkFilter] = useState<OkFilter>("");
	const [kindFilter, setKindFilter] = useState<KindFilter>("");

	const loadKpi = useCallback(async () => {
		try {
			setKpi(await fetchJson("/api/admin/analytics/today/logins", parseTodayLoginsKpi));
			setKpiError(null);
		} catch (e) {
			setKpiError(e instanceof Error ? e.message : "加载失败");
		}
	}, []);

	const loadList = useCallback(async () => {
		const params = new URLSearchParams();
		params.set("page", String(page));
		params.set("limit", String(PAGE_SIZE));
		if (okFilter) params.set("ok", okFilter);
		if (kindFilter) params.set("kind", kindFilter);
		try {
			setList(
				await fetchJson(
					`/api/admin/analytics/today/logins/list?${params.toString()}`,
					parseLoginAttemptList,
				),
			);
			setListError(null);
		} catch (e) {
			setListError(e instanceof Error ? e.message : "加载失败");
		}
	}, [page, okFilter, kindFilter]);

	useEffect(() => {
		loadKpi();
	}, [loadKpi]);
	useEffect(() => {
		loadList();
	}, [loadList]);

	const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1;

	return (
		<>
			{/* ── KPI row (aggregate, KV-cached on worker) ────────────────── */}
			<LayerCard>
				<LayerCard.Header>
					<h2 className="text-base font-semibold">今日登录尝试</h2>
				</LayerCard.Header>
				<LayerCard.Well>
					{kpiError && <p className="text-sm text-basalt-destructive">KPI 加载失败：{kpiError}</p>}
					{kpi && (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<StatCard label="总尝试" value={kpi.totalAttempts} />
							<StatCard label="成功" value={kpi.successAttempts} tone="success" />
							<StatCard label="失败" value={kpi.failedAttempts} tone="danger" />
							<StatCard label="独立 IP" value={kpi.uniqueIps} />
							<StatCard label="登录" value={kpi.loginAttempts} />
							<StatCard label="注册" value={kpi.registerAttempts} />
							<StatCard label="成功用户" value={kpi.uniqueUsers} />
						</div>
					)}
				</LayerCard.Well>
			</LayerCard>

			{/* ── Detail list with reveal ─────────────────────────────────── */}
			<LayerCard>
				<LayerCard.Header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h2 className="text-base font-semibold">登录明细</h2>
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<SegmentControl
							value={okFilter || "__empty__"}
							onValueChange={(v) => {
								setOkFilter(v === "__empty__" ? "" : (v as OkFilter));
								setPage(1);
							}}
							options={[
								{ value: "__empty__", label: "全部" },
								{ value: "1", label: "成功" },
								{ value: "0", label: "失败" },
							]}
							legend="结果"
						/>
						<SegmentControl
							value={kindFilter || "__empty__"}
							onValueChange={(v) => {
								setKindFilter(v === "__empty__" ? "" : (v as KindFilter));
								setPage(1);
							}}
							options={[
								{ value: "__empty__", label: "登录+注册" },
								{ value: "login", label: "登录" },
								{ value: "register", label: "注册" },
							]}
							legend="操作类型"
						/>
					</div>
				</LayerCard.Header>
				<LayerCard.Well>
					{listError && (
						<p className="text-sm text-basalt-destructive">明细加载失败：{listError}</p>
					)}
					{list && list.rows.length === 0 && (
						<p className="text-sm text-basalt-muted-foreground">该筛选条件下暂无记录。</p>
					)}
					{list && list.rows.length > 0 && (
						<div className="overflow-x-auto">
							<Table className="min-w-full text-sm">
								<TableHeader>
									<TableRow className="border-b border-basalt-border text-left text-xs text-basalt-muted-foreground">
										<TableHead className="py-2 pr-3">时间</TableHead>
										<TableHead className="py-2 pr-3">用户</TableHead>
										<TableHead className="py-2 pr-3">类型</TableHead>
										<TableHead className="py-2 pr-3">结果</TableHead>
										<TableHead className="py-2 pr-3">IP</TableHead>
										<TableHead className="py-2 pr-3">UA</TableHead>
										<TableHead className="py-2 pr-3">Bot</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{list.rows.map((row) => {
										return (
											<TableRow key={row.id} className="border-b border-basalt-border/50">
												<TableCell className="whitespace-nowrap py-2 pr-3 tabular-nums">
													{formatTs(row.createdAt)}
												</TableCell>
												<TableCell className="py-2 pr-3 break-all">
													{row.userId !== null ? (
														<Link
															href={`/admin/users/${row.userId}`}
															className="text-basalt-foreground hover:text-basalt-primary hover:underline"
														>
															{row.username || `#${row.userId}`}
															<span className="ml-1 text-xs text-basalt-muted-foreground">
																#{row.userId}
															</span>
														</Link>
													) : (
														<span>{row.username || "—"}</span>
													)}
												</TableCell>
												<TableCell className="py-2 pr-3">{row.kind}</TableCell>
												<TableCell className="py-2 pr-3">
													<Badge variant={row.ok === 1 ? "success" : "destructive"}>
														{row.ok === 1 ? "成功" : row.errorCode || "失败"}
													</Badge>
												</TableCell>
												<TableCell className="py-2 pr-3 font-mono">
													{row.ip}
													<IpLookupInline ip={row.ip} />
												</TableCell>
												<TableCell
													className="max-w-[200px] truncate py-2 pr-3 text-xs text-basalt-muted-foreground"
													title={row.userAgent}
												>
													{row.userAgent || "—"}
												</TableCell>
												<TableCell className="py-2 pr-3">{row.botClass || "—"}</TableCell>
											</TableRow>
										);
									})}
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
