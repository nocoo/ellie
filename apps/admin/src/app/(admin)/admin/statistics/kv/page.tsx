"use client";

// Admin KV monitor page (`/admin/statistics/kv`).
//
// Backed by the Worker's `/api/admin/kv/{overview,list,get,refresh,metrics}`
// endpoints declared in `apps/worker/src/handlers/admin/kv.ts`. All keys
// are filtered server-side by the kv-registry, so this page never sees
// raw refresh tokens / verification codes / auth keys.
//
// Reviewer guardrails (B.2 + C.1, msg aac70f4e / 42d487ee):
//   1. The metrics chart consumes the op-dimension wire shape:
//      `series: { family, tsMinute, op, count }[]`. We never reconstruct
//      the legacy `{hits, misses, errors}` wide row.
//   2. Per-key hit counts do NOT exist — metrics live at family
//      granularity. The detail panel for a key only shows family
//      identity + count + TTL + value (when permitted), never per-key
//      counters.
//   3. Sensitivity gates are server-side; we honor them here:
//      - `nameSensitivity === "hide"` family rows: list/get hidden, no
//        expand action.
//      - `nameSensitivity === "mask"`: key column rendered masked.
//      - `valueSensitivity === "no-read"`: value never returned by the
//        Worker; the get response is a 403 we surface as "敏感，不可读".
//      - `valueSensitivity === "mask-value"`: value omitted, only size /
//        metadata / expiration shown.
//   4. The "Refresh" action on a family row is enabled only when a
//      no-arg bump action exists for that family (`defaultActionFor`
//      returns non-null). Scoped operations (per-forum / per-thread /
//      per-user / per-key) live entirely in the expanded key list, so
//      the operator never gets a button that immediately tells them
//      "needs more input".

import { SegmentedSwitch } from "@/components/admin/segmented-switch";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ellie/ui";
import { ConfirmDialog } from "@ellie/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ellie/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ellie/ui";
import { ChevronDown, ChevronRight, Eye, Loader2, RefreshCw, Trash2 } from "lucide-react";
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

interface KeyRow {
	key: string;
	rawKey: string | null;
	expiration: number | null;
}

interface ListResponse {
	family: string;
	keys: KeyRow[];
	cursor: string | null;
	listComplete: boolean;
}

interface GetResponse {
	family: string;
	key: string;
	rawKey: string | null;
	value: unknown;
	valueMasked: boolean;
	valueByteSize: number;
	metadata: unknown;
	expiration: number | null;
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

/** Format an absolute unix-second `expiration` as "HH:mm:ss · 还剩 Xm". */
function formatExpiration(expiration: number | null, now: number): string {
	if (expiration === null) return "未知";
	const date = new Date(expiration * 1000);
	const remainingSec = expiration - Math.floor(now / 1000);
	const stamp = date.toLocaleString();
	if (remainingSec <= 0) return `${stamp}（已过期）`;
	let rest: string;
	if (remainingSec >= 86400) rest = `${Math.round(remainingSec / 86400)}d`;
	else if (remainingSec >= 3600) rest = `${Math.round(remainingSec / 3600)}h`;
	else if (remainingSec >= 60) rest = `${Math.round(remainingSec / 60)}m`;
	else rest = `${remainingSec}s`;
	return `${stamp} · 还剩 ${rest}`;
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
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

interface RefreshResult {
	ok: boolean;
	status: number;
	body: unknown;
}

async function callRefresh(family: string, action: RefreshAction): Promise<RefreshResult> {
	const res = await fetch("/api/admin/kv/refresh", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ family, action }),
	});
	const body = await res.json().catch(() => null);
	return { ok: res.ok, status: res.status, body };
}

// Map a family + presence row to the refresh action it accepts WITHOUT
// extra input. Returns `null` for families that need additional input
// (forumId / threadId / userId / literal key) — those scoped actions
// live in the expanded per-key view, so the family-row Refresh button
// is never enabled in a state where it can't actually act.
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

/**
 * Per-key delete action for a literal raw key. Returns null when the
 * family has no per-key delete path (gen-keyed families bump rather
 * than delete; hide families never expose keys).
 */
function deleteActionForKey(row: OverviewRow, rawKey: string): RefreshAction | null {
	if (row.family === "user:mini:v1") {
		const userId = parseUserMiniId(rawKey);
		if (userId === null) return null;
		return { kind: "delete-user-mini", userId };
	}
	// Singleton TTL caches (settings:all, public-stats, …) and other
	// families whose registry entry declares delete-literal.
	const ALLOW_LITERAL = new Set(["settings:all", "public-stats"]);
	if (ALLOW_LITERAL.has(row.family)) {
		return { kind: "delete-literal", key: rawKey };
	}
	return null;
}

function parseUserMiniId(rawKey: string): number | null {
	// live v1 family: literal key `user:mini:<id>`
	const m = /^user:mini:(\d+)$/.exec(rawKey);
	if (!m) return null;
	const id = Number.parseInt(m[1], 10);
	return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------------------
// Per-family expanded key list
// ---------------------------------------------------------------------------

interface KeyListState {
	rows: KeyRow[];
	cursor: string | null;
	listComplete: boolean;
	loading: boolean;
	error: string | null;
}

const EMPTY_KEY_LIST: KeyListState = {
	rows: [],
	cursor: null,
	listComplete: false,
	loading: false,
	error: null,
};

function ExpandedKeyList({
	row,
	state,
	now,
	onLoadMore,
	onView,
	onDelete,
}: {
	row: OverviewRow;
	state: KeyListState;
	now: number;
	onLoadMore: () => void;
	onView: (rawKey: string) => void;
	onDelete: (rawKey: string) => void;
}) {
	if (row.nameSensitivity === "hide") {
		return (
			<div className="px-4 py-3 text-xs text-muted-foreground">
				敏感家族（{row.family}）按策略隐藏 key 名称，仅展示总数 / TTL。
			</div>
		);
	}
	if (state.error) {
		return <div className="px-4 py-3 text-xs text-destructive">加载失败：{state.error}</div>;
	}
	if (state.loading && state.rows.length === 0) {
		return (
			<div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
				<Loader2 className="mr-2 h-3 w-3 animate-spin" />
				加载 key 列表…
			</div>
		);
	}
	if (state.rows.length === 0) {
		return <div className="px-4 py-3 text-xs text-muted-foreground">该家族当前没有 key。</div>;
	}
	return (
		<div className="space-y-2 px-4 py-3">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Key</TableHead>
						<TableHead>过期</TableHead>
						<TableHead className="w-40 text-right">操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{state.rows.map((k) => {
						const canView = row.valueSensitivity !== "no-read" && k.rawKey !== null;
						const deleteAction = k.rawKey ? deleteActionForKey(row, k.rawKey) : null;
						return (
							<TableRow key={k.key + (k.rawKey ?? "")}>
								<TableCell className="font-mono text-xs">{k.key}</TableCell>
								<TableCell className="text-xs text-muted-foreground">
									{formatExpiration(k.expiration, now)}
								</TableCell>
								<TableCell className="text-right">
									<Button
										size="sm"
										variant="ghost"
										disabled={!canView}
										onClick={() => k.rawKey && onView(k.rawKey)}
									>
										<Eye className="mr-1 h-3 w-3" />
										查看
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="text-destructive hover:text-destructive"
										disabled={deleteAction === null}
										onClick={() => k.rawKey && onDelete(k.rawKey)}
									>
										<Trash2 className="mr-1 h-3 w-3" />
										过期
									</Button>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span>
					共 {state.rows.length} 条{state.listComplete ? "（已到底）" : "（仍有更多）"}
				</span>
				{!state.listComplete && (
					<Button size="sm" variant="outline" disabled={state.loading} onClick={onLoadMore}>
						{state.loading ? (
							<>
								<Loader2 className="mr-1 h-3 w-3 animate-spin" />
								加载中
							</>
						) : (
							"加载下一页"
						)}
					</Button>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Overview table (with expandable per-family key list)
// ---------------------------------------------------------------------------

function OverviewTable({
	rows,
	loading,
	now,
	expanded,
	keyLists,
	busyFamily,
	onToggle,
	onLoadMore,
	onView,
	onDelete,
	onRefreshFamily,
}: {
	rows: OverviewRow[];
	loading: boolean;
	now: number;
	expanded: Set<string>;
	keyLists: Record<string, KeyListState | undefined>;
	busyFamily: string | null;
	onToggle: (row: OverviewRow) => void;
	onLoadMore: (row: OverviewRow) => void;
	onView: (row: OverviewRow, rawKey: string) => void;
	onDelete: (row: OverviewRow, rawKey: string) => void;
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
					<TableHead className="w-8" />
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
					const isExpanded = expanded.has(row.family);
					const canExpand = row.nameSensitivity !== "hide";
					// Family-row refresh is gated on (a) the registry having a
					// no-arg bump for this family AND (b) the row being shipped+
					// present. Scoped operations (per-forum/thread/user/key) are
					// in the expanded list — never on the family row.
					const refreshAction = defaultActionFor(row);
					const refreshable =
						refreshAction !== null && row.status === "shipped" && row.presence === "present";
					return (
						<>
							<TableRow key={row.family}>
								<TableCell>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 w-6 p-0"
										disabled={!canExpand}
										onClick={() => onToggle(row)}
									>
										{isExpanded ? (
											<ChevronDown className="h-4 w-4" />
										) : (
											<ChevronRight className="h-4 w-4" />
										)}
									</Button>
								</TableCell>
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
										disabled={!refreshable || busyFamily === row.family}
										onClick={() => onRefreshFamily(row)}
									>
										{busyFamily === row.family ? (
											<Loader2 className="mr-1 h-3 w-3 animate-spin" />
										) : (
											<RefreshCw className="mr-1 h-3 w-3" />
										)}
										刷新
									</Button>
								</TableCell>
							</TableRow>
							{isExpanded && (
								<TableRow>
									<TableCell colSpan={8} className="bg-muted/30 p-0">
										<ExpandedKeyList
											row={row}
											state={keyLists[row.family] ?? EMPTY_KEY_LIST}
											now={now}
											onLoadMore={() => onLoadMore(row)}
											onView={(rawKey) => onView(row, rawKey)}
											onDelete={(rawKey) => onDelete(row, rawKey)}
										/>
									</TableCell>
								</TableRow>
							)}
						</>
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
// Key detail dialog — pulls fresh value via /api/admin/kv/get on open.
// ---------------------------------------------------------------------------

interface KeyDetailState {
	open: boolean;
	loading: boolean;
	rawKey: string | null;
	family: string | null;
	data: GetResponse | null;
	error: string | null;
}

function KeyDetailDialog({
	state,
	now,
	onOpenChange,
}: {
	state: KeyDetailState;
	now: number;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={state.open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle className="font-mono text-sm">{state.rawKey ?? "Key 详情"}</DialogTitle>
					<DialogDescription className="text-xs">家族 {state.family ?? "—"}</DialogDescription>
				</DialogHeader>
				{state.loading && (
					<div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
						<Loader2 className="mr-2 h-3 w-3 animate-spin" />
						加载中…
					</div>
				)}
				{state.error && <div className="text-xs text-destructive">加载失败：{state.error}</div>}
				{state.data && (
					<div className="space-y-3 text-xs">
						<div>
							<span className="text-muted-foreground">过期：</span>
							{formatExpiration(state.data.expiration, now)}
						</div>
						<div>
							<span className="text-muted-foreground">大小：</span>
							{formatBytes(state.data.valueByteSize)}
						</div>
						{state.data.metadata !== null && (
							<div>
								<span className="text-muted-foreground">Metadata：</span>
								<pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 font-mono">
									{JSON.stringify(state.data.metadata, null, 2)}
								</pre>
							</div>
						)}
						<div>
							<span className="text-muted-foreground">Value：</span>
							{state.data.valueMasked ? (
								<span className="ml-1 text-muted-foreground italic">敏感，已遮蔽</span>
							) : (
								<pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 font-mono">
									{typeof state.data.value === "string"
										? state.data.value
										: JSON.stringify(state.data.value, null, 2)}
								</pre>
							)}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const METRICS_MINUTES = 60;
const KEY_PAGE_LIMIT = 50;

interface ConfirmState {
	open: boolean;
	row: OverviewRow | null;
	rawKey: string | null;
	action: RefreshAction | null;
}

const CLOSED_CONFIRM: ConfirmState = { open: false, row: null, rawKey: null, action: null };

export default function KvMonitorPage() {
	const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([]);
	const [overviewLoading, setOverviewLoading] = useState(true);
	const [metricsRows, setMetricsRows] = useState<MetricsRow[]>([]);
	const [metricsLoading, setMetricsLoading] = useState(true);
	const [busyFamily, setBusyFamily] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [keyLists, setKeyLists] = useState<Record<string, KeyListState | undefined>>({});

	const [detail, setDetail] = useState<KeyDetailState>({
		open: false,
		loading: false,
		rawKey: null,
		family: null,
		data: null,
		error: null,
	});
	const [confirm, setConfirm] = useState<ConfirmState>(CLOSED_CONFIRM);

	// Tick once a minute so "还剩 Xm" doesn't go stale while the user
	// stares at the page.
	const [now, setNow] = useState<number>(() => Date.now());
	// Panel switcher between overview/metrics — controlled state replaces the
	// previous shadcn Tabs `defaultValue`, so the SegmentedSwitch can drive
	// which `<div role="tabpanel">` renders below.
	const [activeView, setActiveView] = useState<"overview" | "metrics">("overview");
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

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

	// ── per-family list loading (paginated via cursor) ──────────────
	const fetchKeyPage = useCallback(
		async (family: string, cursor: string | null, append: boolean) => {
			setKeyLists((prev) => ({
				...prev,
				[family]: {
					...(prev[family] ?? EMPTY_KEY_LIST),
					loading: true,
					error: null,
					...(append ? {} : { rows: [], cursor: null, listComplete: false }),
				},
			}));
			try {
				const params = new URLSearchParams({
					family,
					limit: String(KEY_PAGE_LIMIT),
				});
				if (cursor) params.set("cursor", cursor);
				const res = await fetch(`/api/admin/kv/list?${params.toString()}`);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as {
						error?: { code?: string };
					} | null;
					throw new Error(errBody?.error?.code ?? `HTTP ${res.status}`);
				}
				const json = (await res.json()) as { data: ListResponse };
				setKeyLists((prev) => {
					const prior = prev[family] ?? EMPTY_KEY_LIST;
					return {
						...prev,
						[family]: {
							rows: append ? [...prior.rows, ...json.data.keys] : json.data.keys,
							cursor: json.data.cursor,
							listComplete: json.data.listComplete,
							loading: false,
							error: null,
						},
					};
				});
			} catch (err) {
				setKeyLists((prev) => ({
					...prev,
					[family]: {
						...(prev[family] ?? EMPTY_KEY_LIST),
						loading: false,
						error: err instanceof Error ? err.message : String(err),
					},
				}));
			}
		},
		[],
	);

	const handleToggle = useCallback(
		(row: OverviewRow) => {
			setExpanded((prev) => {
				const next = new Set(prev);
				if (next.has(row.family)) {
					next.delete(row.family);
				} else {
					next.add(row.family);
					// First-time expand: load the first page.
					if (!keyLists[row.family]) {
						void fetchKeyPage(row.family, null, false);
					}
				}
				return next;
			});
		},
		[keyLists, fetchKeyPage],
	);

	const handleLoadMore = useCallback(
		(row: OverviewRow) => {
			const cursor = keyLists[row.family]?.cursor ?? null;
			if (cursor === null) return;
			void fetchKeyPage(row.family, cursor, true);
		},
		[keyLists, fetchKeyPage],
	);

	const handleView = useCallback(async (row: OverviewRow, rawKey: string) => {
		setDetail({
			open: true,
			loading: true,
			rawKey,
			family: row.family,
			data: null,
			error: null,
		});
		try {
			const res = await fetch(`/api/admin/kv/get?key=${encodeURIComponent(rawKey)}`);
			if (!res.ok) {
				const errBody = (await res.json().catch(() => null)) as {
					error?: { code?: string };
				} | null;
				const code = errBody?.error?.code ?? `HTTP ${res.status}`;
				const message =
					code === "KV_KEY_VALUE_FORBIDDEN"
						? "敏感家族，不允许读取 value"
						: code === "KV_KEY_NAME_HIDDEN"
							? "敏感家族，key 名隐藏，不允许查看"
							: code;
				setDetail((d) => ({ ...d, loading: false, error: message }));
				return;
			}
			const json = (await res.json()) as { data: GetResponse };
			setDetail((d) => ({ ...d, loading: false, data: json.data }));
		} catch (err) {
			setDetail((d) => ({
				...d,
				loading: false,
				error: err instanceof Error ? err.message : String(err),
			}));
		}
	}, []);

	const handleAskDelete = useCallback((row: OverviewRow, rawKey: string) => {
		const action = deleteActionForKey(row, rawKey);
		if (!action) return;
		setConfirm({ open: true, row, rawKey, action });
	}, []);

	const handleConfirmDelete = useCallback(async () => {
		if (!confirm.row || !confirm.action) return;
		const row = confirm.row;
		setBusyFamily(row.family);
		setNotice(null);
		try {
			const result = await callRefresh(row.family, confirm.action);
			setNotice(
				result.ok ? `已过期 ${row.family}: ${confirm.rawKey}` : `操作失败 (${result.status})`,
			);
			if (result.ok) {
				await Promise.all([loadOverview(), loadMetrics(), fetchKeyPage(row.family, null, false)]);
			}
		} finally {
			setBusyFamily(null);
			setConfirm(CLOSED_CONFIRM);
		}
	}, [confirm, loadOverview, loadMetrics, fetchKeyPage]);

	const handleRefreshFamily = useCallback(
		async (row: OverviewRow) => {
			const action = defaultActionFor(row);
			if (!action) return;
			setBusyFamily(row.family);
			setNotice(null);
			try {
				const result = await callRefresh(row.family, action);
				setNotice(result.ok ? `已刷新 ${row.family}` : `刷新 ${row.family} 失败`);
				if (result.ok) {
					await Promise.all([loadOverview(), loadMetrics()]);
				}
			} finally {
				setBusyFamily(null);
			}
		},
		[loadOverview, loadMetrics],
	);

	const summaries = useMemo(() => summarize(metricsRows), [metricsRows]);
	const isBusy = busyFamily !== null;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">KV 缓存监控</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						查看 Worker KV 中各业务缓存家族的存量、TTL 与命中指标；展开家族可看 key 列表 /
						过期时间， 敏感家族仅展示数量与 TTL，不展开 value。
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

			{/*
			 * Panel switcher: SegmentedSwitch (~32px) replaces the previous
			 * shadcn Tabs (h-10 control + extra outer Card per panel). The
			 * switch is intentionally inline-positioned at standard control
			 * height so the page header reads as one band of controls rather
			 * than a tall navigation strip on top of every section.
			 */}
			<div className="flex items-center justify-start">
				<SegmentedSwitch
					ariaLabel="切换 KV 监控视图"
					value={activeView}
					onValueChange={setActiveView}
					options={[
						{ value: "overview", label: "家族总览" },
						{ value: "metrics", label: `命中指标 (近 ${METRICS_MINUTES} 分钟)` },
					]}
				/>
			</div>

			{activeView === "overview" && (
				<div role="tabpanel" aria-label="家族总览">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">KV 家族</CardTitle>
							<CardDescription className="text-xs">
								每个家族对应 kv-registry.ts 中一条声明。计数是按 family pattern 的 KV.list
								扫描结果（最多 1000 条），超出时以「+」标注。点击左侧箭头展开查看 key
								列表与到期时间。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<OverviewTable
								rows={overviewRows}
								loading={overviewLoading}
								now={now}
								expanded={expanded}
								keyLists={keyLists}
								busyFamily={busyFamily}
								onToggle={handleToggle}
								onLoadMore={handleLoadMore}
								onView={handleView}
								onDelete={handleAskDelete}
								onRefreshFamily={handleRefreshFamily}
							/>
						</CardContent>
					</Card>
				</div>
			)}

			{activeView === "metrics" && (
				<div role="tabpanel" aria-label="家族级命中指标">
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
				</div>
			)}

			<Card>
				<CardHeader>
					<CardTitle className="text-base">说明</CardTitle>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground space-y-2">
					<p>
						<Trash2 className="mr-1 inline h-3 w-3" />
						删除 / 失效操作会写入操作日志（<code>kv.bump_gen</code> /<code>kv.delete_key</code>）。
					</p>
					<p>
						<strong>敏感家族</strong>
						（refresh token / email_verify / IP 限流等）只展示统计与 TTL 上限，不开放 value 与 key
						列表； server-side 由 kv-registry 的 <code>nameSensitivity</code> /
						<code>valueSensitivity</code> 决定。
					</p>
					<p>
						<strong>命中率</strong> 按 <code>hit / (hit + miss)</code> 推导，仅在家族级别有效；
						不展示按 key 的命中数据。
					</p>
				</CardContent>
			</Card>

			<KeyDetailDialog
				state={detail}
				now={now}
				onOpenChange={(open) => setDetail((d) => ({ ...d, open }))}
			/>

			<ConfirmDialog
				open={confirm.open}
				onOpenChange={(open) => setConfirm((c) => ({ ...c, open }))}
				title="过期此 key"
				description={
					confirm.rawKey
						? `确认从 KV 中过期 ${confirm.rawKey}？此操作会立即生效，并写入操作日志。`
						: ""
				}
				confirmText="过期"
				variant="destructive"
				onConfirm={handleConfirmDelete}
			/>
		</div>
	);
}
