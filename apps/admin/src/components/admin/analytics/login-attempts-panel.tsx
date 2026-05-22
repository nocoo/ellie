"use client";

/**
 * Today's login-attempt audit panel (P4).
 *
 * KPI summary card row + detail list with raw IP/UA (admin-only, no masking).
 */

import {
	type LoginAttemptList,
	type TodayLoginsKpi,
	parseLoginAttemptList,
	parseTodayLoginsKpi,
} from "@/viewmodels/admin/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@ellie/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

function okBadge(ok: 0 | 1, errorCode: string): { label: string; cls: string } {
	if (ok === 1) {
		return { label: "成功", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
	}
	return {
		label: errorCode || "失败",
		cls: "bg-destructive/15 text-destructive",
	};
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
			<Card>
				<CardHeader>
					<CardTitle className="text-base font-semibold">今日登录尝试</CardTitle>
				</CardHeader>
				<CardContent>
					{kpiError && <p className="text-sm text-destructive">KPI 加载失败：{kpiError}</p>}
					{kpi && (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<KpiCell label="总尝试" value={kpi.totalAttempts} />
							<KpiCell label="成功" value={kpi.successAttempts} tone="success" />
							<KpiCell label="失败" value={kpi.failedAttempts} tone="danger" />
							<KpiCell label="独立 IP" value={kpi.uniqueIps} />
							<KpiCell label="登录" value={kpi.loginAttempts} />
							<KpiCell label="注册" value={kpi.registerAttempts} />
							<KpiCell label="成功用户" value={kpi.uniqueUsers} />
						</div>
					)}
				</CardContent>
			</Card>

			{/* ── Detail list with reveal ─────────────────────────────────── */}
			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<CardTitle className="text-base font-semibold">登录明细</CardTitle>
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<FilterGroup
							value={okFilter}
							onChange={(v) => {
								setOkFilter(v as OkFilter);
								setPage(1);
							}}
							options={[
								{ value: "", label: "全部" },
								{ value: "1", label: "成功" },
								{ value: "0", label: "失败" },
							]}
						/>
						<FilterGroup
							value={kindFilter}
							onChange={(v) => {
								setKindFilter(v as KindFilter);
								setPage(1);
							}}
							options={[
								{ value: "", label: "登录+注册" },
								{ value: "login", label: "登录" },
								{ value: "register", label: "注册" },
							]}
						/>
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
										<th className="py-2 pr-3">时间</th>
										<th className="py-2 pr-3">用户</th>
										<th className="py-2 pr-3">类型</th>
										<th className="py-2 pr-3">结果</th>
										<th className="py-2 pr-3">IP</th>
										<th className="py-2 pr-3">UA</th>
										<th className="py-2 pr-3">Bot</th>
									</tr>
								</thead>
								<tbody>
									{list.rows.map((row) => {
										const badge = okBadge(row.ok, row.errorCode);
										return (
											<tr key={row.id} className="border-b border-border/50">
												<td className="whitespace-nowrap py-2 pr-3 tabular-nums">
													{formatTs(row.createdAt)}
												</td>
												<td className="py-2 pr-3 break-all">
													{row.userId !== null ? (
														<Link
															href={`/admin/users/${row.userId}`}
															className="text-foreground hover:text-primary hover:underline"
														>
															{row.username || `#${row.userId}`}
															<span className="ml-1 text-xs text-muted-foreground">
																#{row.userId}
															</span>
														</Link>
													) : (
														<span>{row.username || "—"}</span>
													)}
												</td>
												<td className="py-2 pr-3">{row.kind}</td>
												<td className="py-2 pr-3">
													<span
														className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${badge.cls}`}
													>
														{badge.label}
													</span>
												</td>
												<td className="py-2 pr-3 font-mono">{row.ip}</td>
												<td
													className="max-w-[200px] truncate py-2 pr-3 text-xs text-muted-foreground"
													title={row.userAgent}
												>
													{row.userAgent || "—"}
												</td>
												<td className="py-2 pr-3">{row.botClass || "—"}</td>
											</tr>
										);
									})}
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
}: {
	label: string;
	value: number;
	tone?: "success" | "danger";
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
		</div>
	);
}

function FilterGroup<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (v: T) => void;
	options: ReadonlyArray<{ value: T; label: string }>;
}) {
	return (
		<div className="flex gap-1">
			{options.map((opt) => (
				<button
					type="button"
					key={opt.value || "all"}
					onClick={() => onChange(opt.value)}
					className={`rounded-md border px-2 py-1 transition-colors ${
						value === opt.value
							? "border-primary bg-primary/10 text-foreground"
							: "border-border text-muted-foreground hover:bg-accent"
					}`}
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}
