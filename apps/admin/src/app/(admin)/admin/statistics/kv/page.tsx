"use client";

// Admin KV monitor page (`/admin/statistics/kv`).
//
// Backed by the Worker's `/api/admin/kv/{overview,list,get,refresh,metrics}`
// endpoints declared in `apps/worker/src/handlers/admin/kv.ts`. All keys
// are filtered server-side by the kv-registry, so this page never sees
// raw refresh tokens / verification codes / auth keys.
//
// Reviewer guardrails (B.2 sign-off, msg aac70f4e):
//   1. The metrics chart consumes the op-dimension wire shape:
//      `series: { family, tsMinute, op, count }[]`. We never reconstruct
//      the legacy `{hits, misses, errors}` wide row.
//   2. Per-key hit counts do NOT exist — metrics live at family
//      granularity. The detail panel for a key only shows family
//      identity + count + TTL, never per-key counters.
//   3. Sensitivity-masked families (`mask` / `hide`) are rendered as
//      count + TTL only; their value column is suppressed by the
//      Worker (`valueSensitivity`) and we honor that here.

import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ellie/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ellie/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ellie/ui";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Wire types — mirrored from `apps/worker/src/handlers/admin/kv.ts`.
// Kept narrow on purpose so a Worker-side schema drift surfaces as a TS
// error here rather than a silent UI-rendering bug.
// ---------------------------------------------------------------------------

type Presence =
	| "present"
	| "absent"
	| "planned"
	| "historical"
	| "dead-builder-reserved"
	| "sensitive-hidden";

interface OverviewRow {
	family: string;
	displayName: string;
	category: string;
	status: string;
	pattern: string;
	ttl: number | "sticky" | "variable";
	nameSensitivity: "public" | "mask" | "hide";
	valueSensitivity: "public" | "mask-value" | "no-read";
	count: number;
	truncated: boolean;
	presence: Presence;
	currentGens?: { name: string; value: string | null }[];
	sampleKeys: string[];
}

interface MetricsRow {
	family: string;
	tsMinute: number;
	op: "read" | "hit" | "miss" | "write" | "bump" | "delete" | "error";
	count: number;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const PRESENCE_LABEL: Record<Presence, string> = {
	present: "在用",
	absent: "暂无",
	planned: "未上线",
	historical: "已弃用",
	"dead-builder-reserved": "占位",
	"sensitive-hidden": "敏感(隐藏)",
};

const PRESENCE_VARIANT: Record<Presence, "default" | "secondary" | "destructive" | "outline"> = {
	present: "default",
	absent: "secondary",
	planned: "outline",
	historical: "secondary",
	"dead-builder-reserved": "outline",
	"sensitive-hidden": "secondary",
};

function formatTtl(ttl: OverviewRow["ttl"]): string {
	if (typeof ttl === "string") return ttl;
	if (ttl >= 86400) return `${Math.round(ttl / 86400)}d`;
	if (ttl >= 3600) return `${Math.round(ttl / 3600)}h`;
	if (ttl >= 60) return `${Math.round(ttl / 60)}m`;
	return `${ttl}s`;
}

// ---------------------------------------------------------------------------
// Metrics aggregation — group rows by (family, tsMinute) into op buckets.
// We never widen to a legacy `{hits, misses, errors}` shape (see file
// header guardrail #1). Hit-rate is derived as `hit / (hit + miss)`.
// ---------------------------------------------------------------------------

interface FamilySummary {
	family: string;
	read: number;
	hit: number;
	miss: number;
	write: number;
	bump: number;
	delete: number;
	error: number;
}

function summarize(series: MetricsRow[]): FamilySummary[] {
	const byFamily = new Map<string, FamilySummary>();
	for (const r of series) {
		let s = byFamily.get(r.family);
		if (!s) {
			s = {
				family: r.family,
				read: 0,
				hit: 0,
				miss: 0,
				write: 0,
				bump: 0,
				delete: 0,
				error: 0,
			};
			byFamily.set(r.family, s);
		}
		s[r.op] += r.count;
	}
	return [...byFamily.values()].sort((a, b) => b.read - a.read || a.family.localeCompare(b.family));
}

function hitRate(s: FamilySummary): string {
	const denom = s.hit + s.miss;
	if (denom === 0) return "—";
	return `${((s.hit / denom) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Overview table
// ---------------------------------------------------------------------------

function OverviewTable({
	rows,
	loading,
	onRefreshFamily,
}: {
	rows: OverviewRow[];
	loading: boolean;
	onRefreshFamily: (row: OverviewRow) => void;
}) {
	if (loading) {
		return (
			<div className="flex items-center justify-center py-12 text-muted-foreground">
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				加载中…
			</div>
		);
	}
	if (rows.length === 0) {
		return <div className="py-12 text-center text-muted-foreground">无 KV 家族数据</div>;
	}
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>家族</TableHead>
					<TableHead>分类</TableHead>
					<TableHead>状态</TableHead>
					<TableHead className="text-right">键数量</TableHead>
					<TableHead>TTL</TableHead>
					<TableHead>敏感度</TableHead>
					<TableHead>操作</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => {
					const refreshable = row.status === "shipped" && row.presence === "present";
					return (
						<TableRow key={row.family}>
							<TableCell className="font-mono text-xs">
								<div className="font-semibold">{row.displayName}</div>
								<div className="text-muted-foreground">{row.family}</div>
								<div className="text-muted-foreground">{row.pattern}</div>
							</TableCell>
							<TableCell className="text-xs">{row.category}</TableCell>
							<TableCell>
								<Badge variant={PRESENCE_VARIANT[row.presence]}>
									{PRESENCE_LABEL[row.presence]}
								</Badge>
							</TableCell>
							<TableCell className="text-right font-mono text-xs">
								{row.count}
								{row.truncated ? "+" : ""}
							</TableCell>
							<TableCell className="text-xs">{formatTtl(row.ttl)}</TableCell>
							<TableCell className="text-xs">
								<div>名称: {row.nameSensitivity}</div>
								<div className="text-muted-foreground">值: {row.valueSensitivity}</div>
							</TableCell>
							<TableCell>
								<Button
									size="sm"
									variant="outline"
									disabled={!refreshable}
									onClick={() => onRefreshFamily(row)}
								>
									<RefreshCw className="mr-1 h-3 w-3" />
									刷新
								</Button>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}

// ---------------------------------------------------------------------------
// Metrics summary table — family-level only (guardrail #2: no per-key
// hit counts).
// ---------------------------------------------------------------------------

function MetricsTable({
	summaries,
	minutes,
	loading,
}: {
	summaries: FamilySummary[];
	minutes: number;
	loading: boolean;
}) {
	if (loading) {
		return (
			<div className="flex items-center justify-center py-12 text-muted-foreground">
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				加载中…
			</div>
		);
	}
	if (summaries.length === 0) {
		return (
			<div className="py-12 text-center text-muted-foreground">最近 {minutes} 分钟暂无指标</div>
		);
	}
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>家族</TableHead>
					<TableHead className="text-right">read</TableHead>
					<TableHead className="text-right">hit</TableHead>
					<TableHead className="text-right">miss</TableHead>
					<TableHead className="text-right">命中率</TableHead>
					<TableHead className="text-right">write</TableHead>
					<TableHead className="text-right">bump</TableHead>
					<TableHead className="text-right">delete</TableHead>
					<TableHead className="text-right">error</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{summaries.map((s) => (
					<TableRow key={s.family}>
						<TableCell className="font-mono text-xs">{s.family}</TableCell>
						<TableCell className="text-right font-mono text-xs">{s.read}</TableCell>
						<TableCell className="text-right font-mono text-xs">{s.hit}</TableCell>
						<TableCell className="text-right font-mono text-xs">{s.miss}</TableCell>
						<TableCell className="text-right font-mono text-xs">{hitRate(s)}</TableCell>
						<TableCell className="text-right font-mono text-xs">{s.write}</TableCell>
						<TableCell className="text-right font-mono text-xs">{s.bump}</TableCell>
						<TableCell className="text-right font-mono text-xs">{s.delete}</TableCell>
						<TableCell className="text-right font-mono text-xs">{s.error}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

// ---------------------------------------------------------------------------
// Refresh helpers — typed action shape mirrors `KvRefreshAction` on the
// Worker side. We only construct actions whose `kind` matches the
// family's declared `refresh.kind`; the Worker rejects mismatches with
// `KV_ACTION_MISMATCH` (the registry is the single source of truth).
// ---------------------------------------------------------------------------

interface RefreshAction {
	kind: string;
	forumId?: number;
	threadId?: number;
	userId?: number;
	key?: string;
}

async function callRefresh(family: string, action: RefreshAction): Promise<{ ok: boolean }> {
	const res = await fetch("/api/admin/kv/refresh", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ family, action }),
	});
	return { ok: res.ok };
}

// Map a family + presence row to the refresh action it accepts. Returns
// `null` for families that need additional input (forumId / threadId /
// userId / literal key) — the page surfaces a hint instead of trying to
// guess. Operators run those scoped refreshes from the per-key list view
// (planned in commit C follow-up).
function defaultActionFor(row: OverviewRow): RefreshAction | null {
	switch (row.family) {
		case "forum:tree:v2":
			return { kind: "bump-forum-tree" };
		case "forum:summary:v2":
			return { kind: "bump-forum-summary" };
		case "gen:thread:list:all":
			return { kind: "bump-thread-list-all" };
		case "gen:digest":
			return { kind: "bump-digest" };
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const METRICS_MINUTES = 60;

export default function KvMonitorPage() {
	const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([]);
	const [overviewLoading, setOverviewLoading] = useState(true);
	const [metricsRows, setMetricsRows] = useState<MetricsRow[]>([]);
	const [metricsLoading, setMetricsLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const loadOverview = useCallback(async () => {
		setOverviewLoading(true);
		try {
			const res = await fetch("/api/admin/kv/overview");
			const json = (await res.json()) as { data?: { families: OverviewRow[] } };
			setOverviewRows(json.data?.families ?? []);
		} finally {
			setOverviewLoading(false);
		}
	}, []);

	const loadMetrics = useCallback(async () => {
		setMetricsLoading(true);
		try {
			const res = await fetch(`/api/admin/kv/metrics?minutes=${METRICS_MINUTES}`);
			const json = (await res.json()) as { data?: { series: MetricsRow[] } };
			setMetricsRows(json.data?.series ?? []);
		} finally {
			setMetricsLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadOverview();
		void loadMetrics();
	}, [loadOverview, loadMetrics]);

	const handleRefreshFamily = useCallback(
		async (row: OverviewRow) => {
			const action = defaultActionFor(row);
			if (!action) {
				setNotice(
					`家族 ${row.family} 需要额外参数（forumId / threadId / userId / key），请通过明细操作。`,
				);
				return;
			}
			setBusy(row.family);
			setNotice(null);
			try {
				const { ok } = await callRefresh(row.family, action);
				setNotice(ok ? `已刷新 ${row.family}` : `刷新 ${row.family} 失败`);
				if (ok) {
					await loadOverview();
					await loadMetrics();
				}
			} finally {
				setBusy(null);
			}
		},
		[loadOverview, loadMetrics],
	);

	const summaries = useMemo(() => summarize(metricsRows), [metricsRows]);
	const isBusy = busy !== null;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">KV 缓存监控</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						查看 Worker KV 中各业务缓存家族的存量、TTL 与命中指标；敏感家族仅展示数量与 TTL，不展开
						value。
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						void loadOverview();
						void loadMetrics();
					}}
					disabled={overviewLoading || metricsLoading || isBusy}
				>
					<RefreshCw className="mr-2 h-4 w-4" />
					重新加载
				</Button>
			</div>

			{notice && (
				<Card>
					<CardContent className="py-3 text-sm text-muted-foreground">{notice}</CardContent>
				</Card>
			)}

			<Tabs defaultValue="overview">
				<TabsList>
					<TabsTrigger value="overview">家族总览</TabsTrigger>
					<TabsTrigger value="metrics">命中指标 (近 {METRICS_MINUTES} 分钟)</TabsTrigger>
				</TabsList>

				<TabsContent value="overview">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">KV 家族</CardTitle>
							<CardDescription className="text-xs">
								每个家族对应 kv-registry.ts 中一条声明。计数是按 family pattern 的 KV.list
								扫描结果（最多 1000 条），超出时以「+」标注。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<OverviewTable
								rows={overviewRows}
								loading={overviewLoading}
								onRefreshFamily={handleRefreshFamily}
							/>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="metrics">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">家族级命中指标</CardTitle>
							<CardDescription className="text-xs">
								Op 维度来自
								<code className="mx-1">kv_cache_metrics_minute</code>
								表（migration 0035）。按家族聚合，仅显示家族级总计；不存在按 key 的命中计数。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<MetricsTable
								summaries={summaries}
								minutes={METRICS_MINUTES}
								loading={metricsLoading}
							/>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">说明</CardTitle>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground space-y-2">
					<p>
						<Trash2 className="mr-1 inline h-3 w-3" />
						删除/失效操作会写入操作日志（<code>kv.bump_gen</code> /<code>kv.delete_key</code>）。
					</p>
					<p>
						<strong>敏感家族</strong>
						（refresh token / email_verify / IP 限流等）只展示统计，不展开值；server-side 由
						kv-registry 的 <code>nameSensitivity</code> / <code>valueSensitivity</code> 控制。
					</p>
					<p>
						<strong>命中率</strong> 按 <code>hit / (hit + miss)</code> 推导，仅在家族级别有效；
						不展示按 key 的命中数据。
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
