"use client";

/**
 * Today's login-attempt audit panel (P4).
 *
 * KPI summary card row + masked detail list with a per-row "查看完整"
 * (reveal) button. The reveal goes through the POST BFF proxy which
 * causes the worker to writeAdminLog with action
 * `analytics.login_history.reveal`. Network errors leave the row's
 * masked view intact.
 *
 * This component is self-contained — it manages its own fetch state for
 * (a) the KPI card, (b) the paginated masked list, and (c) the modal
 * holding the revealed raw row. Page integration just renders it.
 */

import {
	type LoginAttemptList,
	type LoginAttemptListRow,
	type LoginAttemptReveal,
	type TodayLoginsKpi,
	parseLoginAttemptList,
	parseLoginAttemptReveal,
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

async function postReveal(id: number): Promise<LoginAttemptReveal> {
	const res = await fetch(`/api/admin/analytics/login-history/${id}/reveal`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { data?: unknown };
	return parseLoginAttemptReveal(body.data);
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
// Reveal modal — tiny overlay, no portal lib needed.
// ---------------------------------------------------------------------------

function RevealModal({
	revealed,
	error,
	onClose,
}: {
	revealed: LoginAttemptReveal | null;
	error: string | null;
	onClose: () => void;
}) {
	if (!revealed && !error) return null;
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> requires ref + showModal/close imperative API which conflicts with the React-controlled open/close pattern used here.
			role="dialog"
			aria-modal="true"
			tabIndex={-1}
		>
			<div
				className="w-full max-w-lg rounded-[var(--radius-card,14px)] bg-card p-5 shadow-lg"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="document"
			>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-base font-semibold">登录尝试详情</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
					>
						关闭
					</button>
				</div>
				{error ? (
					<p className="text-sm text-destructive">{error}</p>
				) : revealed ? (
					<dl className="space-y-2 text-sm">
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">用户</dt>
							<dd className="font-medium text-foreground break-all text-right">
								{revealed.userId !== null ? (
									<Link
										href={`/admin/users/${revealed.userId}`}
										className="hover:text-primary hover:underline"
									>
										{revealed.username || `#${revealed.userId}`}
										<span className="ml-1 text-xs text-muted-foreground">(#{revealed.userId})</span>
									</Link>
								) : (
									<span>{revealed.username || "—"}</span>
								)}
							</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">类型</dt>
							<dd>{revealed.kind}</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">结果</dt>
							<dd>{revealed.ok === 1 ? "成功" : revealed.errorCode || "失败"}</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">IP</dt>
							<dd className="font-mono break-all text-right">{revealed.ip || "—"}</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">UA</dt>
							<dd className="break-all text-right text-xs">{revealed.userAgent || "—"}</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">Bot 分类</dt>
							<dd>{revealed.botClass || "—"}</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">时间</dt>
							<dd>{formatTs(revealed.createdAt)}</dd>
						</div>
					</dl>
				) : null}
				<p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
					本次查看已写入审计日志（analytics.login_history.reveal）。
				</p>
			</div>
		</div>
	);
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

	const [revealed, setRevealed] = useState<LoginAttemptReveal | null>(null);
	const [revealError, setRevealError] = useState<string | null>(null);
	const [revealingId, setRevealingId] = useState<number | null>(null);

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

	const onReveal = useCallback(async (row: LoginAttemptListRow) => {
		setRevealingId(row.id);
		setRevealError(null);
		setRevealed(null);
		try {
			const r = await postReveal(row.id);
			setRevealed(r);
		} catch (e) {
			setRevealError(e instanceof Error ? e.message : "查看失败");
		} finally {
			setRevealingId(null);
		}
	}, []);

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
					<CardTitle className="text-base font-semibold">登录明细（IP 已脱敏）</CardTitle>
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
										<th className="py-2 pr-3">Bot</th>
										<th className="py-2 pr-3"> </th>
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
												<td className="py-2 pr-3 font-mono">{row.ipMasked}</td>
												<td className="py-2 pr-3">{row.botClass || "—"}</td>
												<td className="py-2 pr-3">
													<button
														type="button"
														onClick={() => onReveal(row)}
														disabled={revealingId === row.id}
														className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
													>
														{revealingId === row.id ? "查询中…" : "查看完整"}
													</button>
												</td>
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

			<RevealModal
				revealed={revealed}
				error={revealError}
				onClose={() => {
					setRevealed(null);
					setRevealError(null);
				}}
			/>
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
