"use client";

import {
	Badge,
	Button,
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
	LayerCard,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nocoo/basalt";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import {
	Activity,
	ChevronDown,
	ChevronRight,
	Copy,
	Database,
	Eye,
	Gauge,
	KeyRound,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import {
	ADMIN_WIDE_DIALOG_BODY_CLASS,
	ADMIN_WIDE_DIALOG_CONTENT_CLASS,
} from "@/components/admin/dialog-presets";
import { JsonCodeBlock } from "@/components/admin/json-code-block";
import { type KvMetric, KvMetricsChart } from "@/components/admin/kv-metrics-chart";
import { extractErrorMessage } from "@/lib/admin-error";
import {
	type CacheLifecycle,
	type CacheTier,
	COUNTDOWN_TICK_MS,
	cacheMutationError,
	canPreviewValue,
	type Footprint,
	formatBytes,
	formatCount,
	formatFootprint,
	formatRemaining,
	formatScope,
	formatTimestamp,
	formatTtl,
	hitRateLabel,
	LIFECYCLE_LABEL,
	METRICS_WINDOWS,
	type MetricsWindowMinutes,
	mergeOccupancySnapshot,
	mutationNotice,
	type OccupancyPoint,
	occupancyFromMetrics,
	occupancyFromOverview,
	physicalExpirationMs,
	remainingMs,
	sensitiveValueLabel,
	summarizeD1Observation,
	summarizeFamilyOps,
	tierFromTtl,
	totalsFromSummaries,
} from "@/lib/admin-kv-cache";
import { readAdminKvJson, writeAdminKvJson } from "@/lib/admin-kv-fetch";

type Presence =
	| "present"
	| "absent"
	| "planned"
	| "historical"
	| "dead-builder-reserved"
	| "sensitive-hidden";

interface FamilyActions {
	inspect: boolean;
	rebuild: boolean;
	deleteEntry: boolean;
	invalidateGroup: boolean;
	restriction: string | null;
}

interface OverviewRow {
	family: string;
	displayName: string;
	category: string;
	status: string;
	pattern: string;
	ttl: number | "sticky" | "variable";
	tier?: CacheTier | null;
	nameSensitivity: "public" | "mask" | "hide";
	valueSensitivity: "public" | "mask-value" | "no-read";
	count: number;
	countKind?: "observed" | "at-least" | "unknown";
	truncated: boolean;
	presence: Presence;
	currentGens?: { name: string; value: string | null }[];
	sampleKeys: string[];
	footprint?: Footprint;
	actions?: FamilyActions;
}

interface KeyRow {
	key: string;
	rawKey: string | null;
	expiration: number | null;
	loadedAt?: number | null;
	expiresAt?: number | null;
	schemaVersion?: number | null;
	tier?: CacheTier | null;
	contentUtf8Bytes?: number | null;
	sizeBytes?: number | null;
	scope?: string | null;
	params?: Record<string, string | number | boolean | null> | null;
}

interface ListResponse {
	family: string;
	keys: KeyRow[];
	cursor: string | null;
	listComplete: boolean;
	countKind?: "observed" | "at-least" | "unknown";
	actions?: FamilyActions;
}

interface GetResponse {
	family: string;
	key: string;
	rawKey: string | null;
	value: unknown;
	valueMasked: boolean;
	valueByteSize: number;
	contentUtf8Bytes?: number | null;
	metadata: unknown;
	expiration: number | null;
	physicalExpiration?: number | null;
	observedAt?: number;
	status?: CacheLifecycle;
	schemaVersion?: number | null;
	tier?: CacheTier | null;
	params?: Record<string, string | number | boolean | null> | null;
	scope?: string | null;
	valid?: boolean;
	staleVersion?: boolean;
	currentVersion?: string | null;
	adminOnlyPreview?: boolean;
	loadedAt?: number | null;
	expiresAt?: number | null;
	remainingMs?: number | null;
	footprint?: Footprint;
	restricted?: boolean;
	contentTruncated?: boolean;
	contentRange?: { offset: number; length: number; total: number };
	actions?: FamilyActions;
}

interface OperationRow {
	id: number;
	adminName: string;
	action: string;
	targetType: string;
	targetId: number | null;
	details: string;
	createdAt: number;
}

type MetricsRow = KvMetric;

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

function rowActions(row: OverviewRow): FamilyActions {
	if (row.actions) return row.actions;
	return {
		inspect: row.nameSensitivity !== "hide",
		rebuild: false,
		deleteEntry:
			row.family === "settings:all" ||
			row.family === "public-stats" ||
			row.family === "user:mini:v1",
		invalidateGroup:
			row.family === "forum:tree:v2" ||
			row.family === "forum:summary:v2" ||
			row.family === "gen:thread:list:all" ||
			row.family === "gen:digest",
		restriction: null,
	};
}

function groupInvalidateAction(row: OverviewRow): { kind: string } | null {
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

function countKindOf(row: OverviewRow): "observed" | "at-least" | "unknown" {
	if (row.countKind) return row.countKind;
	return row.truncated ? "at-least" : "observed";
}

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
	busy,
	onLoadMore,
	onView,
	onDelete,
	onRebuild,
}: {
	row: OverviewRow;
	state: KeyListState;
	now: number;
	busy: boolean;
	onLoadMore: () => void;
	onView: (rawKey: string) => void;
	onDelete: (rawKey: string) => void;
	onRebuild: (rawKey: string) => void;
}) {
	const actions = rowActions(row);
	if (row.nameSensitivity === "hide") {
		return (
			<div className="px-4 py-3 text-xs text-basalt-muted-foreground">
				敏感家族（{row.family}）按策略隐藏 key 名称，仅展示总数 / TTL。运行状态不会开放原文或清理。
			</div>
		);
	}
	if (state.error) {
		return <div className="px-4 py-3 text-xs text-basalt-destructive">加载失败：{state.error}</div>;
	}
	if (state.loading && state.rows.length === 0) {
		return (
			<div className="flex items-center justify-center py-6 text-xs text-basalt-muted-foreground">
				<Loader className="mr-2 h-3 w-3" />
				加载 key 列表…
			</div>
		);
	}
	if (state.rows.length === 0) {
		return (
			<div className="px-4 py-3 text-xs text-basalt-muted-foreground">
				该类型当前没有已发现的条目。没有常驻 key 只表示尚未访问，不是缓存故障。
			</div>
		);
	}
	return (
		<div className="space-y-2 px-4 py-3">
			<Table className="whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2">
				<TableHeader>
					<TableRow>
						<TableHead>资源 / 参数</TableHead>
						<TableHead>范围</TableHead>
						<TableHead>装载</TableHead>
						<TableHead>逻辑到期</TableHead>
						<TableHead>物理到期</TableHead>
						<TableHead>大小</TableHead>
						<TableHead className="w-64 text-right">操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{state.rows.map((k) => {
						const canView = canPreviewValue({
							nameSensitivity: row.nameSensitivity,
							valueSensitivity: row.valueSensitivity,
							rawKey: k.rawKey,
						});
						const expiresAt = k.expiresAt ?? physicalExpirationMs(k.expiration);
						return (
							<TableRow key={k.key + (k.rawKey ?? "")}>
								<TableCell className="font-mono text-xs">
									<span className="block max-w-96 truncate" title={k.key}>
										{k.key}
									</span>
									{k.params ? (
										<div className="text-basalt-muted-foreground">{JSON.stringify(k.params)}</div>
									) : null}
								</TableCell>
								<TableCell className="text-xs text-basalt-muted-foreground">
									{formatScope(k.scope)}
								</TableCell>
								<TableCell className="text-xs text-basalt-muted-foreground">
									{k.loadedAt ? new Date(k.loadedAt).toLocaleString() : "未知"}
								</TableCell>
								<TableCell className="text-xs text-basalt-muted-foreground">
									{formatRemaining(remainingMs(expiresAt, now))}
								</TableCell>
								<TableCell className="text-xs text-basalt-muted-foreground">
									{k.expiration === null
										? "未知"
										: formatTimestamp(physicalExpirationMs(k.expiration), now)}
								</TableCell>
								<TableCell className="text-xs">
									{k.contentUtf8Bytes == null ? "未知" : formatBytes(k.contentUtf8Bytes)}
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
										disabled={busy || !actions.rebuild || !k.rawKey}
										onClick={() => k.rawKey && onRebuild(k.rawKey)}
									>
										<RefreshCw className="mr-1 h-3 w-3" />
										刷新此条缓存
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="text-basalt-destructive hover:text-basalt-destructive"
										disabled={busy || !actions.deleteEntry || !k.rawKey}
										onClick={() => k.rawKey && onDelete(k.rawKey)}
									>
										<Trash2 className="mr-1 h-3 w-3" />
										删除此条缓存
									</Button>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
			<div className="flex items-center justify-between text-xs text-basalt-muted-foreground">
				<span>
					{state.listComplete
						? formatCount(state.rows.length, "observed")
						: `${formatCount(state.rows.length, "at-least")}（仍有更多）`}
				</span>
				{!state.listComplete && (
					<Button size="sm" variant="outline" disabled={state.loading} onClick={onLoadMore}>
						{state.loading ? (
							<>
								<Loader className="mr-1 h-3 w-3" />
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
	onRebuild,
	onInvalidateGroup,
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
	onRebuild: (row: OverviewRow, rawKey: string) => void;
	onInvalidateGroup: (row: OverviewRow) => void;
}) {
	if (loading) {
		return (
			<div className="flex items-center justify-center py-12 text-basalt-muted-foreground">
				<Loader className="mr-2 h-4 w-4" />
				加载中…
			</div>
		);
	}
	if (rows.length === 0) {
		return <div className="py-12 text-center text-basalt-muted-foreground">无缓存类型数据</div>;
	}
	return (
		<Table className="whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2">
			<TableHeader>
				<TableRow>
					<TableHead className="w-8" />
					<TableHead>名称</TableHead>
					<TableHead>档位</TableHead>
					<TableHead>状态</TableHead>
					<TableHead className="text-right">已观察条目</TableHead>
					<TableHead>占用</TableHead>
					<TableHead>操作</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => {
					const isExpanded = expanded.has(row.family);
					const canExpand = row.nameSensitivity !== "hide";
					const actions = rowActions(row);
					const groupAction = groupInvalidateAction(row);
					const invalidate =
						actions.invalidateGroup && groupAction !== null && row.status === "shipped";
					return (
						<Fragment key={row.family}>
							<TableRow>
								<TableCell>
									<Button
										size="sm"
										variant="ghost"
										className="h-7 w-7 p-0"
										aria-label={`${isExpanded ? "收起" : "展开"}${row.displayName}`}
										aria-expanded={isExpanded}
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
									<div className="font-sans font-semibold">{row.displayName}</div>
									<div className="text-basalt-muted-foreground">{row.family}</div>
								</TableCell>
								<TableCell className="text-xs">
									{formatTtl(row.ttl)}
									<div className="text-basalt-muted-foreground">
										{row.tier ?? tierFromTtl(row.ttl) ?? "未接入标准档位"}
									</div>
								</TableCell>
								<TableCell>
									<Badge variant={PRESENCE_VARIANT[row.presence]}>
										{PRESENCE_LABEL[row.presence]}
									</Badge>
								</TableCell>
								<TableCell className="text-right font-mono text-xs">
									{formatCount(row.count, countKindOf(row))}
								</TableCell>
								<TableCell className="text-xs">
									{formatFootprint(row.footprint ?? { kind: "unknown" })}
								</TableCell>
								<TableCell>
									<Button
										size="sm"
										variant="outline"
										disabled={!invalidate || busyFamily !== null}
										onClick={() => onInvalidateGroup(row)}
									>
										{busyFamily === row.family ? (
											<Loader className="mr-1 h-3 w-3" />
										) : (
											<RefreshCw className="mr-1 h-3 w-3" />
										)}
										使一组缓存失效
									</Button>
								</TableCell>
							</TableRow>
							{isExpanded && (
								<TableRow>
									<TableCell colSpan={7} className="!p-0">
										<ExpandedKeyList
											row={row}
											state={keyLists[row.family] ?? EMPTY_KEY_LIST}
											now={now}
											busy={busyFamily !== null}
											onLoadMore={() => onLoadMore(row)}
											onView={(rawKey) => onView(row, rawKey)}
											onDelete={(rawKey) => onDelete(row, rawKey)}
											onRebuild={(rawKey) => onRebuild(row, rawKey)}
										/>
									</TableCell>
								</TableRow>
							)}
						</Fragment>
					);
				})}
			</TableBody>
		</Table>
	);
}

interface KeyDetailState {
	open: boolean;
	loading: boolean;
	rawKey: string | null;
	family: string | null;
	data: GetResponse | null;
	error: string | null;
	expanded: boolean;
}

function isDiagnosticSnapshot(data: GetResponse | null, now: number): boolean {
	if (!data) return false;
	if (data.status === "logically-expired" || data.status === "diagnostic-snapshot") return true;
	return data.expiresAt != null && data.expiresAt <= now;
}

function previewValue(value: unknown, expanded: boolean): { display: unknown; large: boolean } {
	const large =
		typeof value === "string" ? value.length > 4000 : JSON.stringify(value ?? "").length > 4000;
	if (expanded || !large) return { display: value, large };
	if (typeof value === "string") return { display: `${value.slice(0, 4000)}…`, large };
	return { display: JSON.parse(JSON.stringify(value)), large };
}

function KeyDetailDialog({
	state,
	now,
	busy,
	onOpenChange,
	onCopy,
	onExpand,
	onRebuild,
	onDelete,
}: {
	state: KeyDetailState;
	now: number;
	busy: boolean;
	onOpenChange: (open: boolean) => void;
	onCopy: () => void;
	onExpand: () => void;
	onRebuild: () => void;
	onDelete: () => void;
}) {
	const status = state.data?.status;
	const showAsSnapshot = isDiagnosticSnapshot(state.data, now);
	const value = state.data?.value;
	const { display: displayValue, large } = previewValue(value, state.expanded);
	return (
		<Dialog open={state.open} onOpenChange={onOpenChange}>
			<AdminDialogContent className={ADMIN_WIDE_DIALOG_CONTENT_CLASS}>
				<DialogHeader className="min-w-0 pr-8">
					<DialogTitle className="break-all font-mono text-sm">
						{state.rawKey ?? "缓存详情"}
					</DialogTitle>
					<DialogDescription className="text-xs">
						{state.family ?? "—"}
						{status ? ` · ${LIFECYCLE_LABEL[status]}` : ""}
						{state.data?.adminOnlyPreview ? " · 仅后台可预览" : ""}
						{showAsSnapshot ? " · 仅作诊断快照，不是当前有效内容" : ""}
					</DialogDescription>
				</DialogHeader>
				{state.loading && (
					<div className="flex items-center justify-center py-6 text-xs text-basalt-muted-foreground">
						<Loader className="mr-2 h-3 w-3" />
						加载中…
					</div>
				)}
				{state.error && (
					<div className="text-xs text-basalt-destructive">加载失败：{state.error}</div>
				)}
				{state.data && (
					<div className={`${ADMIN_WIDE_DIALOG_BODY_CLASS} space-y-3 text-xs`}>
						<dl className="grid gap-3 rounded-lg border border-basalt-border p-3 sm:grid-cols-2">
							<div>
								<dt className="text-basalt-muted-foreground">装载时间</dt>
								<dd className="mt-1 tabular-nums">
									{state.data.loadedAt ? new Date(state.data.loadedAt).toLocaleString() : "未知"}
								</dd>
							</div>
							<div>
								<dt className="text-basalt-muted-foreground">逻辑到期</dt>
								<dd className="mt-1 tabular-nums">
									{formatTimestamp(state.data.expiresAt ?? null, now)}
								</dd>
							</div>
							<div>
								<dt className="text-basalt-muted-foreground">物理到期</dt>
								<dd className="mt-1 tabular-nums">
									{formatTimestamp(
										physicalExpirationMs(state.data.physicalExpiration ?? state.data.expiration),
										now,
									)}
								</dd>
							</div>
							<div>
								<dt className="text-basalt-muted-foreground">内容 UTF-8 字节</dt>
								<dd className="mt-1 tabular-nums">
									{formatFootprint(
										state.data.footprint ??
											(state.data.contentUtf8Bytes == null
												? { kind: "unknown" }
												: { kind: "observed", bytes: state.data.contentUtf8Bytes }),
									)}
								</dd>
							</div>
							<div>
								<dt className="text-basalt-muted-foreground">schema / 档位</dt>
								<dd className="mt-1">
									{state.data.schemaVersion ?? "—"} · {state.data.tier ?? "—"}
								</dd>
							</div>
							<div>
								<dt className="text-basalt-muted-foreground">范围 / 参数</dt>
								<dd className="mt-1">
									{formatScope(state.data.scope)}{" "}
									{state.data.params ? JSON.stringify(state.data.params) : ""}
								</dd>
							</div>
							<div>
								<dt className="text-basalt-muted-foreground">当前版本 key</dt>
								<dd className="mt-1 break-all font-mono">
									{state.data.currentVersion ?? "未知"}
									{state.data.staleVersion ? " · 旧版本" : ""}
								</dd>
							</div>
						</dl>
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={onCopy}
								disabled={state.data.valueMasked}
							>
								<Copy className="mr-1 h-3 w-3" />
								复制
							</Button>
							{large && (
								<Button size="sm" variant="outline" onClick={onExpand}>
									{state.expanded ? "收起" : "展开全部"}
									{state.data.contentRange
										? `（已加载 ${state.data.contentRange.offset}-${state.data.contentRange.offset + state.data.contentRange.length} / ${state.data.contentRange.total}）`
										: ""}
								</Button>
							)}
							<Button size="sm" variant="outline" disabled={busy} onClick={onRebuild}>
								刷新此条缓存
							</Button>
							<Button size="sm" variant="outline" disabled={busy} onClick={onDelete}>
								删除此条缓存
							</Button>
						</div>
						<div className="min-w-0">
							<span className="text-basalt-muted-foreground">已授权内容：</span>
							{state.data.valueMasked ? (
								<span className="ml-1 text-basalt-muted-foreground italic">
									{sensitiveValueLabel("mask-value")}
								</span>
							) : (
								<JsonCodeBlock value={displayValue} maxHeightClassName="max-h-[60vh]" />
							)}
						</div>
					</div>
				)}
			</AdminDialogContent>
		</Dialog>
	);
}

const KEY_PAGE_LIMIT = 50;

type ConfirmKind = "delete" | "rebuild" | "invalidate";

interface ConfirmState {
	open: boolean;
	kind: ConfirmKind | null;
	row: OverviewRow | null;
	rawKey: string | null;
}

const CLOSED_CONFIRM: ConfirmState = { open: false, kind: null, row: null, rawKey: null };

async function executeConfirm(
	kind: ConfirmKind,
	row: OverviewRow,
	rawKey: string | null,
): Promise<{ error?: string; notice?: { type: "success" | "error"; text: string } }> {
	if (kind === "invalidate") {
		const action = groupInvalidateAction(row);
		if (!action) return {};
		const data = await writeAdminKvJson<{
			outcome?: string;
			error?: { message?: string; code?: string };
		}>("/api/admin/kv/refresh", { family: row.family, action });
		if (data.outcome !== "invalidated") {
			return { error: data.error?.message ?? data.error?.code ?? "成组失效未确认成功" };
		}
		return {
			notice: mutationNotice({
				outcome: "invalidated",
				label: ` ${row.displayName}`,
				consistencyNote: "x",
			}),
		};
	}
	if (kind === "delete" && rawKey) {
		const data = await writeAdminKvJson<{
			outcome: "deleted" | "failed" | "not-allowed" | "not-found";
			error?: { message?: string };
		}>("/api/admin/kv/delete", { family: row.family, key: rawKey });
		if (data.outcome !== "deleted") return { error: cacheMutationError(data.error) };
		return {
			notice: mutationNotice({
				outcome: "deleted",
				label: ` ${row.family}: ${rawKey}`,
				consistencyNote: "x",
			}),
		};
	}
	if (kind === "rebuild" && rawKey) {
		const data = await writeAdminKvJson<{
			outcome: string;
			stage?: string;
			error?: { message?: string; code?: string };
		}>("/api/admin/kv/rebuild", { family: row.family, key: rawKey });
		if (data.outcome !== "rebuilt") return { error: cacheMutationError(data.error, data.stage) };
		return {
			notice: mutationNotice({
				outcome: "rebuilt",
				label: ` ${row.family}: ${rawKey}`,
				consistencyNote: "x",
			}),
		};
	}
	return {};
}

function filterOverviewRows(
	rows: OverviewRow[],
	categoryFilter: string,
	statusFilter: string,
	tierFilter: string,
): OverviewRow[] {
	return rows.filter((row) => {
		if (categoryFilter && row.category !== categoryFilter) return false;
		if (statusFilter && row.status !== statusFilter && row.presence !== statusFilter) return false;
		if (tierFilter && (row.tier ?? tierFromTtl(row.ttl) ?? "") !== tierFilter) return false;
		return true;
	});
}

function LocateBar({
	keyQuery,
	scopeQuery,
	onKeyQuery,
	onScopeQuery,
	onLocate,
}: {
	keyQuery: string;
	scopeQuery: string;
	onKeyQuery: (value: string) => void;
	onScopeQuery: (value: string) => void;
	onLocate: () => void;
}) {
	return (
		<>
			<Input
				placeholder="完整 key 或参数 JSON"
				value={keyQuery}
				onChange={(e) => onKeyQuery(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onLocate();
				}}
				className="w-64"
				aria-label="定位完整 key 或参数 JSON"
			/>
			<Input
				placeholder="范围"
				value={scopeQuery}
				onChange={(e) => onScopeQuery(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onLocate();
				}}
				className="w-28"
				aria-label="定位可见性范围"
			/>
			<Button size="sm" variant="outline" onClick={onLocate}>
				定位
			</Button>
		</>
	);
}

export default function KvMonitorPage() {
	const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([]);
	const [overviewLoading, setOverviewLoading] = useState(true);
	const [overviewError, setOverviewError] = useState<string | null>(null);
	const [overviewObservedAt, setOverviewObservedAt] = useState<number | null>(null);
	const [metricsRows, setMetricsRows] = useState<MetricsRow[]>([]);
	const [metricsLoading, setMetricsLoading] = useState(false);
	const [metricsError, setMetricsError] = useState<string | null>(null);
	const [metricsMinutes, setMetricsMinutes] = useState<MetricsWindowMinutes>(1440);
	const [operations, setOperations] = useState<OperationRow[]>([]);
	const [operationsError, setOperationsError] = useState<string | null>(null);
	const [busyFamily, setBusyFamily] = useState<string | null>(null);
	const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [keyLists, setKeyLists] = useState<Record<string, KeyListState | undefined>>({});
	const [categoryFilter, setCategoryFilter] = useState("");
	const [tierFilter, setTierFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState("");
	const [keyQuery, setKeyQuery] = useState("");
	const [scopeQuery, setScopeQuery] = useState("public");

	const [detail, setDetail] = useState<KeyDetailState>({
		open: false,
		loading: false,
		rawKey: null,
		family: null,
		data: null,
		error: null,
		expanded: false,
	});
	const [confirm, setConfirm] = useState<ConfirmState>(CLOSED_CONFIRM);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [now, setNow] = useState<number>(() => Date.now());
	const [activeView, setActiveView] = useState<"overview" | "entries" | "trends" | "operations">(
		"overview",
	);
	const [occupancy, setOccupancy] = useState<OccupancyPoint[]>([]);

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
		return () => clearInterval(id);
	}, []);

	const loadOverview = useCallback(async () => {
		setOverviewLoading(true);
		setOverviewError(null);
		try {
			const data = await readAdminKvJson<{ families: OverviewRow[]; observedAt?: number }>(
				"/api/admin/kv/overview",
			);
			if (data.families.length === 0) {
				setOverviewRows([]);
				setOverviewError("未能获取缓存目录，请稍后重新加载。");
				return;
			}
			setOverviewRows(data.families);
			const observedAt = data.observedAt ?? Date.now();
			setOverviewObservedAt(observedAt);
			setOccupancy((prev) =>
				mergeOccupancySnapshot(prev, occupancyFromOverview(data.families, observedAt)),
			);
		} catch (err) {
			setOverviewRows([]);
			setOverviewError(extractErrorMessage(err, "加载 KV 总览失败"));
		} finally {
			setOverviewLoading(false);
		}
	}, []);

	const loadMetrics = useCallback(async () => {
		setMetricsLoading(true);
		setMetricsError(null);
		try {
			const data = await readAdminKvJson<{
				series: MetricsRow[];
				note?: string;
				source?: string;
				truncated?: boolean;
				coverage?: "complete" | "partial";
			}>(`/api/admin/kv/metrics?minutes=${metricsMinutes}`);
			setMetricsRows(data.series);
			setOccupancy((prev) => {
				let next = prev;
				for (const point of occupancyFromMetrics(data.series))
					next = mergeOccupancySnapshot(next, point);
				return next;
			});
			if (data.note) setMetricsError("指标暂不可用，请稍后重新加载。");
			else if (data.truncated || data.coverage === "partial")
				setMetricsError("指标仅部分覆盖，结果已截断。");
		} catch (err) {
			setMetricsRows([]);
			setMetricsError(extractErrorMessage(err, "加载 KV 命中指标失败"));
		} finally {
			setMetricsLoading(false);
		}
	}, [metricsMinutes]);

	const loadOperations = useCallback(async () => {
		try {
			const data = await readAdminKvJson<{ rows?: OperationRow[]; note?: string }>(
				"/api/admin/kv/operations",
			);
			setOperations(data.rows ?? []);
			setOperationsError(data.note ? "操作记录暂不可用" : null);
		} catch (err) {
			setOperations([]);
			setOperationsError(extractErrorMessage(err, "加载操作记录失败"));
		}
	}, []);

	const refreshMonitor = useCallback(() => {
		if (activeView === "trends") void loadMetrics();
		else if (activeView === "operations") void loadOperations();
		else void loadOverview();
	}, [activeView, loadOverview, loadMetrics, loadOperations]);

	useEffect(() => {
		refreshMonitor();
	}, [refreshMonitor]);

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
				const params = new URLSearchParams({ family, limit: String(KEY_PAGE_LIMIT) });
				if (cursor) params.set("cursor", cursor);
				const locator = keyQuery.trim();
				if (locator.startsWith("{")) {
					params.set("params", locator);
					params.set("scope", scopeQuery.trim() || "public");
				} else if (locator) {
					params.set("key", locator);
				}
				const json = await readAdminKvJson<ListResponse>(`/api/admin/kv/list?${params.toString()}`);
				setKeyLists((prev) => {
					const prior = prev[family] ?? EMPTY_KEY_LIST;
					return {
						...prev,
						[family]: {
							rows: append ? [...prior.rows, ...json.keys] : json.keys,
							cursor: json.cursor,
							listComplete: json.listComplete,
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
		[keyQuery, scopeQuery],
	);

	const handleToggle = useCallback(
		(row: OverviewRow) => {
			setExpanded((prev) => {
				const next = new Set(prev);
				if (next.has(row.family)) next.delete(row.family);
				else {
					next.add(row.family);
					if (!keyLists[row.family]) void fetchKeyPage(row.family, null, false);
				}
				return next;
			});
		},
		[keyLists, fetchKeyPage],
	);

	const locateExpanded = useCallback(() => {
		for (const family of expanded) void fetchKeyPage(family, null, false);
	}, [expanded, fetchKeyPage]);

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
			expanded: false,
		});
		try {
			const data = await readAdminKvJson<GetResponse>(
				`/api/admin/kv/inspect?key=${encodeURIComponent(rawKey)}`,
			);
			setDetail((d) => ({ ...d, loading: false, data }));
		} catch (err) {
			const message = extractErrorMessage(err, "加载失败");
			const mapped = message.includes("KV_KEY_VALUE_FORBIDDEN")
				? "敏感家族，不允许读取 value"
				: message.includes("KV_KEY_NAME_HIDDEN")
					? "敏感家族，key 名隐藏，不允许查看"
					: message;
			setDetail((d) => ({ ...d, loading: false, error: mapped }));
		}
	}, []);

	const runBusy = useCallback(
		async (family: string, work: () => Promise<void>) => {
			if (busyFamily !== null) return;
			setBusyFamily(family);
			setNotice(null);
			setConfirmError(null);
			try {
				await work();
			} finally {
				setBusyFamily(null);
			}
		},
		[busyFamily],
	);

	const handleConfirm = useCallback(async () => {
		if (!confirm.row || !confirm.kind || busyFamily !== null) return;
		const row = confirm.row;
		const kind = confirm.kind;
		const rawKey = confirm.rawKey;
		await runBusy(row.family, async () => {
			try {
				const result = await executeConfirm(kind, row, rawKey);
				if (result.error) {
					setConfirmError(result.error);
					return;
				}
				if (result.notice) setNotice(result.notice);
				setConfirm(CLOSED_CONFIRM);
				await Promise.all([loadOverview(), fetchKeyPage(row.family, null, false)]);
			} catch (error) {
				setConfirmError(extractErrorMessage(error, "操作失败，请重试"));
			}
		});
	}, [confirm, busyFamily, runBusy, loadOverview, fetchKeyPage]);

	const filteredRows = useMemo(
		() => filterOverviewRows(overviewRows, categoryFilter, statusFilter, tierFilter),
		[overviewRows, categoryFilter, statusFilter, tierFilter],
	);

	const summaries = useMemo(() => summarizeFamilyOps(metricsRows), [metricsRows]);
	const totals = useMemo(() => totalsFromSummaries(summaries), [summaries]);
	const d1App = useMemo(() => summarizeD1Observation(metricsRows, "application:d1"), [metricsRows]);
	const isBusy = busyFamily !== null;
	const windowLabel =
		METRICS_WINDOWS.find((w) => w.minutes === metricsMinutes)?.label ?? "近 24 小时";
	const observedEntries = filteredRows.reduce((n, r) => n + r.count, 0);
	const anyTruncated = filteredRows.some((r) => r.truncated || r.countKind === "at-least");
	const footprintBytes = filteredRows.reduce<number | null>((acc, r) => {
		if (!r.footprint || r.footprint.kind === "unknown") return acc;
		return (acc ?? 0) + r.footprint.bytes;
	}, null);

	return (
		<KvMonitorLayout
			overviewRows={overviewRows}
			overviewLoading={overviewLoading}
			overviewError={overviewError}
			overviewObservedAt={overviewObservedAt}
			metricsRows={metricsRows}
			metricsLoading={metricsLoading}
			metricsError={metricsError}
			metricsMinutes={metricsMinutes}
			operations={operations}
			operationsError={operationsError}
			busyFamily={busyFamily}
			notice={notice}
			expanded={expanded}
			keyLists={keyLists}
			categoryFilter={categoryFilter}
			tierFilter={tierFilter}
			statusFilter={statusFilter}
			keyQuery={keyQuery}
			scopeQuery={scopeQuery}
			detail={detail}
			confirm={confirm}
			confirmError={confirmError}
			now={now}
			activeView={activeView}
			occupancy={occupancy}
			filteredRows={filteredRows}
			totals={totals}
			d1App={d1App}
			isBusy={isBusy}
			windowLabel={windowLabel}
			observedEntries={observedEntries}
			anyTruncated={anyTruncated}
			footprintBytes={footprintBytes}
			onRefresh={refreshMonitor}
			onLocate={locateExpanded}
			onKeyQuery={setKeyQuery}
			onScopeQuery={setScopeQuery}
			onCategoryFilter={setCategoryFilter}
			onTierFilter={setTierFilter}
			onStatusFilter={setStatusFilter}
			onActiveView={setActiveView}
			onMetricsMinutes={setMetricsMinutes}
			onToggle={handleToggle}
			onLoadMore={handleLoadMore}
			onView={handleView}
			onConfirmDelete={(row, rawKey) => setConfirm({ open: true, kind: "delete", row, rawKey })}
			onConfirmRebuild={(row, rawKey) => setConfirm({ open: true, kind: "rebuild", row, rawKey })}
			onConfirmInvalidate={(row) =>
				setConfirm({ open: true, kind: "invalidate", row, rawKey: null })
			}
			onDetailOpenChange={(open) => setDetail((d) => ({ ...d, open }))}
			onCopy={() => {
				const text =
					typeof detail.data?.value === "string"
						? detail.data.value
						: JSON.stringify(detail.data?.value, null, 2);
				if (text) void navigator.clipboard.writeText(text);
			}}
			onExpandDetail={() => setDetail((d) => ({ ...d, expanded: !d.expanded }))}
			onDetailRebuild={() => {
				const row = overviewRows.find((r) => r.family === detail.family);
				if (row && detail.rawKey)
					setConfirm({ open: true, kind: "rebuild", row, rawKey: detail.rawKey });
			}}
			onDetailDelete={() => {
				const row = overviewRows.find((r) => r.family === detail.family);
				if (row && detail.rawKey)
					setConfirm({ open: true, kind: "delete", row, rawKey: detail.rawKey });
			}}
			onConfirmOpenChange={(open) => setConfirm((c) => ({ ...c, open }))}
			onConfirm={handleConfirm}
		/>
	);
}

function confirmTitle(kind: ConfirmKind | null): string {
	if (kind === "delete") return "删除此条缓存";
	if (kind === "rebuild") return "刷新此条缓存";
	return "使一组缓存失效";
}

function confirmDescription(confirm: ConfirmState): string {
	if (confirm.kind === "delete") {
		return `确认删除 ${confirm.rawKey}？只移除该缓存条目，不删除 D1 业务记录，也不重建。其他地区可能尚未可见。`;
	}
	if (confirm.kind === "rebuild") {
		return "按该条目原来的参数和可见性范围强制装载权威数据。管理员身份不会写进游客缓存。失败时不会提前删掉仍有效的快照。";
	}
	return `确认切换 ${confirm.row?.displayName ?? ""} 的版本？这不是内容已重新生成，后续访问才会按需重建。`;
}

function metricOrDash(
	loading: boolean,
	error: string | null,
	value: string | number,
): string | number {
	return loading || error ? "—" : value;
}

function KvTrendsTab({
	metricsMinutes,
	metricsLoading,
	metricsError,
	metricsRows,
	occupancy,
	windowLabel,
	onMetricsMinutes,
}: {
	metricsMinutes: MetricsWindowMinutes;
	metricsLoading: boolean;
	metricsError: string | null;
	metricsRows: MetricsRow[];
	occupancy: OccupancyPoint[];
	windowLabel: string;
	onMetricsMinutes: (value: MetricsWindowMinutes) => void;
}) {
	const empty = !metricsLoading && metricsRows.length === 0 && occupancy.length === 0;
	const chart = !metricsLoading && (metricsRows.length > 0 || occupancy.length > 0);
	return (
		<TabsContent value="trends" aria-label="运行趋势" className="space-y-3">
			<div className="flex flex-wrap gap-2">
				{METRICS_WINDOWS.map((w) => (
					<Button
						key={w.minutes}
						size="sm"
						variant={metricsMinutes === w.minutes ? "default" : "outline"}
						onClick={() => onMetricsMinutes(w.minutes)}
					>
						{w.label}
					</Button>
				))}
			</div>
			<p className="text-xs text-basalt-muted-foreground">
				每小时一个观测点，按需读取，不自动轮询。占用观察来自本页的总览读取，每小时保留一份，不回补历史。
				{occupancy.length > 0 ? ` 已记录 ${occupancy.length} 个观察点。` : " 尚无占用观察点。"}
			</p>
			{metricsError && <AdminInlineMessage variant="error" text={metricsError} />}
			{chart && (
				<LayerCard padding="sm">
					<KvMetricsChart
						series={metricsRows}
						occupancy={occupancy}
						windowLabel={windowLabel}
						source="应用小时观测"
					/>
				</LayerCard>
			)}
			{empty && (
				<div className="py-12 text-center text-basalt-muted-foreground">
					该区间没有已保存的应用指标，不补零、不虚构占用曲线。
				</div>
			)}
		</TabsContent>
	);
}

function KvOperationsTab({
	operations,
	operationsError,
}: {
	operations: OperationRow[];
	operationsError: string | null;
}) {
	return (
		<TabsContent value="operations" aria-label="操作记录" className="space-y-3">
			{operationsError && <AdminInlineMessage variant="error" text={operationsError} />}
			<LayerCard padding="none" className="overflow-hidden">
				<LayerCard.Well className="p-0">
					{operations.length === 0 ? (
						<div className="py-12 text-center text-basalt-muted-foreground">
							暂无缓存刷新 / 删除 / 成组失效记录。审计不含缓存原文。
						</div>
					) : (
						<Table className="whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2">
							<TableHeader>
								<TableRow>
									<TableHead>时间</TableHead>
									<TableHead>执行者</TableHead>
									<TableHead>动作</TableHead>
									<TableHead>目标</TableHead>
									<TableHead>详情</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{operations.map((op) => (
									<TableRow key={op.id}>
										<TableCell className="text-xs">
											{new Date(op.createdAt).toLocaleString()}
										</TableCell>
										<TableCell className="text-xs">{op.adminName}</TableCell>
										<TableCell className="font-mono text-xs">{op.action}</TableCell>
										<TableCell className="text-xs">
											{op.targetType}
											{op.targetId != null ? ` #${op.targetId}` : ""}
										</TableCell>
										<TableCell className="max-w-md truncate font-mono text-xs">
											{op.details}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</LayerCard.Well>
			</LayerCard>
		</TabsContent>
	);
}

function KvMonitorLayout(props: {
	overviewRows: OverviewRow[];
	overviewLoading: boolean;
	overviewError: string | null;
	overviewObservedAt: number | null;
	metricsRows: MetricsRow[];
	metricsLoading: boolean;
	metricsError: string | null;
	metricsMinutes: MetricsWindowMinutes;
	operations: OperationRow[];
	operationsError: string | null;
	busyFamily: string | null;
	notice: { type: "success" | "error"; text: string } | null;
	expanded: Set<string>;
	keyLists: Record<string, KeyListState | undefined>;
	categoryFilter: string;
	tierFilter: string;
	statusFilter: string;
	keyQuery: string;
	scopeQuery: string;
	detail: KeyDetailState;
	confirm: ConfirmState;
	confirmError: string | null;
	now: number;
	activeView: "overview" | "entries" | "trends" | "operations";
	occupancy: OccupancyPoint[];
	filteredRows: OverviewRow[];
	totals: ReturnType<typeof totalsFromSummaries>;
	d1App: ReturnType<typeof summarizeD1Observation>;
	isBusy: boolean;
	windowLabel: string;
	observedEntries: number;
	anyTruncated: boolean;
	footprintBytes: number | null;
	onRefresh: () => void;
	onLocate: () => void;
	onKeyQuery: (value: string) => void;
	onScopeQuery: (value: string) => void;
	onCategoryFilter: (value: string) => void;
	onTierFilter: (value: string) => void;
	onStatusFilter: (value: string) => void;
	onActiveView: (value: "overview" | "entries" | "trends" | "operations") => void;
	onMetricsMinutes: (value: MetricsWindowMinutes) => void;
	onToggle: (row: OverviewRow) => void;
	onLoadMore: (row: OverviewRow) => void;
	onView: (row: OverviewRow, rawKey: string) => void;
	onConfirmDelete: (row: OverviewRow, rawKey: string) => void;
	onConfirmRebuild: (row: OverviewRow, rawKey: string) => void;
	onConfirmInvalidate: (row: OverviewRow) => void;
	onDetailOpenChange: (open: boolean) => void;
	onCopy: () => void;
	onExpandDetail: () => void;
	onDetailRebuild: () => void;
	onDetailDelete: () => void;
	onConfirmOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	const {
		overviewLoading,
		overviewError,
		overviewObservedAt,
		metricsRows,
		metricsLoading,
		metricsError,
		metricsMinutes,
		operations,
		operationsError,
		busyFamily,
		notice,
		expanded,
		keyLists,
		categoryFilter,
		tierFilter,
		statusFilter,
		keyQuery,
		scopeQuery,
		detail,
		confirm,
		confirmError,
		now,
		activeView,
		occupancy,
		filteredRows,
		totals,
		d1App,
		isBusy,
		windowLabel,
		observedEntries,
		anyTruncated,
		footprintBytes,
		onRefresh: refreshMonitor,
		onLocate: locateExpanded,
		onKeyQuery: setKeyQuery,
		onScopeQuery: setScopeQuery,
		onCategoryFilter: setCategoryFilter,
		onTierFilter: setTierFilter,
		onStatusFilter: setStatusFilter,
		onActiveView: setActiveView,
		onMetricsMinutes: setMetricsMinutes,
		onToggle: handleToggle,
		onLoadMore: handleLoadMore,
		onView: handleView,
		onConfirmDelete,
		onConfirmRebuild,
		onConfirmInvalidate,
		onDetailOpenChange,
		onCopy,
		onExpandDetail,
		onDetailRebuild,
		onDetailDelete,
		onConfirmOpenChange,
		onConfirm: handleConfirm,
	} = props;
	return (
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<Database aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						KV 缓存监控
					</span>
				}
				description="查看生命周期、已授权内容和应用自己采集的运行趋势。刷新此条会重建，使一组失效只切换版本。"
				actions={
					<Button
						variant="outline"
						size="sm"
						onClick={refreshMonitor}
						disabled={overviewLoading || metricsLoading || isBusy}
					>
						<RefreshCw className="mr-2 h-4 w-4" />
						更新监控数据
					</Button>
				}
			/>

			<AdminMetrics
				items={[
					{
						label: "已采集请求",
						value: metricOrDash(
							metricsLoading || metricsRows.length === 0,
							metricsError,
							totals.read,
						),
						icon: Activity,
						hint: `${windowLabel} · 来源应用指标 · ${overviewObservedAt ? new Date(overviewObservedAt).toLocaleString() : ""}`,
					},
					{
						label: "命中率",
						value: metricOrDash(
							metricsLoading || metricsRows.length === 0,
							metricsError,
							hitRateLabel(totals.hit, totals.miss),
						),
						icon: Gauge,
						hint: "命中 ÷（命中 + 未命中）。不含 admin:* 与 D1 观测。",
					},
					{
						label: "回源 / 错误",
						value: metricOrDash(
							metricsLoading || metricsRows.length === 0,
							metricsError,
							`${totals.miss} / ${totals.error}`,
						),
						icon: Activity,
						hint: "回源是 miss；错误独立计数，不与 hit/miss 相加充请求量",
					},
					{
						label: "已观察条目 / 占用",
						value: metricOrDash(
							overviewLoading,
							overviewError,
							`${formatCount(observedEntries, anyTruncated ? "at-least" : "observed")} · ${
								footprintBytes === null ? "未知" : formatBytes(footprintBytes)
							}`,
						),
						icon: KeyRound,
						hint: "内容 UTF-8 字节或估算，不是 KV 账单存储。未知不显示为 0。",
					},
				]}
			/>

			{!metricsLoading && !metricsError && d1App.queries > 0 && (
				<p className="text-xs text-basalt-muted-foreground">
					应用观测 D1
					{d1App.rowsRead != null ? ` · 读 ${d1App.rowsRead.toLocaleString("zh-CN")} 行` : ""}
					{d1App.rowsWritten != null ? ` · 写 ${d1App.rowsWritten.toLocaleString("zh-CN")} 行` : ""}
					{` · ${d1App.queries} 次语句`}
					{d1App.durationMs > 0 ? ` · ${d1App.durationMs} ms` : ""}
					。按小时汇总的观测可能有漏样，不是完整计费统计；已结束的小时延后显示，缺失记录留空。
				</p>
			)}

			{notice && <AdminInlineMessage variant={notice.type} text={notice.text} />}

			<div className="flex flex-wrap gap-2">
				<LocateBar
					keyQuery={keyQuery}
					scopeQuery={scopeQuery}
					onKeyQuery={setKeyQuery}
					onScopeQuery={setScopeQuery}
					onLocate={locateExpanded}
				/>
				<select
					className="rounded-md border border-basalt-border bg-transparent px-2 py-1 text-xs"
					value={categoryFilter}
					onChange={(e) => setCategoryFilter(e.target.value)}
					aria-label="按类型筛选"
				>
					<option value="">全部类型</option>
					<option value="cache">业务缓存</option>
					<option value="stats">统计</option>
					<option value="gen">版本</option>
					<option value="session">会话</option>
					<option value="rate-limit">限流</option>
				</select>
				<select
					className="rounded-md border border-basalt-border bg-transparent px-2 py-1 text-xs"
					value={tierFilter}
					onChange={(e) => setTierFilter(e.target.value)}
					aria-label="按档位筛选"
				>
					<option value="">全部档位</option>
					<option value="SHORT">SHORT</option>
					<option value="MEDIUM">MEDIUM</option>
					<option value="HOUR">HOUR</option>
					<option value="LONG">LONG</option>
				</select>
				<select
					className="rounded-md border border-basalt-border bg-transparent px-2 py-1 text-xs"
					value={statusFilter}
					onChange={(e) => setStatusFilter(e.target.value)}
					aria-label="按状态筛选"
				>
					<option value="">全部状态</option>
					<option value="shipped">已接入</option>
					<option value="present">在用</option>
					<option value="planned">尚未接入</option>
					<option value="historical">已弃用</option>
				</select>
			</div>

			<Tabs
				className="space-y-3"
				value={activeView}
				onValueChange={(value) =>
					setActiveView(value as "overview" | "entries" | "trends" | "operations")
				}
			>
				<SectionRule
					title="视图"
					hint="筛选条件在四个视图间保留。切换视图时按需加载，不自动轮询。"
					actions={
						<TabsList aria-label={"切换 KV 监控视图"} className="max-w-full overflow-x-auto">
							{[
								{ value: "overview", label: "运行总览" },
								{ value: "entries", label: "缓存条目" },
								{ value: "trends", label: "运行趋势" },
								{ value: "operations", label: "操作记录" },
							].map((option) => (
								<TabsTrigger key={option.value} value={option.value}>
									{option.label}
								</TabsTrigger>
							))}
						</TabsList>
					}
				/>

				<TabsContent value="overview" aria-label="运行总览" className="space-y-3">
					{overviewError && <AdminInlineMessage variant="error" text={overviewError} />}
					<LayerCard padding="none" className="overflow-hidden">
						<LayerCard.Well className="p-0">
							<section
								className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-basalt-ring"
								aria-label="KV 家族总览表格"
								// biome-ignore lint/a11y/noNoninteractiveTabindex: this scroll region needs keyboard access
								tabIndex={0}
							>
								<OverviewTable
									rows={filteredRows}
									loading={overviewLoading}
									now={now}
									expanded={expanded}
									keyLists={keyLists}
									busyFamily={busyFamily}
									onToggle={handleToggle}
									onLoadMore={handleLoadMore}
									onView={handleView}
									onDelete={onConfirmDelete}
									onRebuild={onConfirmRebuild}
									onInvalidateGroup={onConfirmInvalidate}
								/>
							</section>
						</LayerCard.Well>
					</LayerCard>
				</TabsContent>

				<TabsContent value="entries" aria-label="缓存条目" className="space-y-3">
					{overviewError && <AdminInlineMessage variant="error" text={overviewError} />}
					<LayerCard padding="none" className="overflow-hidden">
						<LayerCard.Well className="p-0">
							<section
								className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-basalt-ring"
								aria-label="缓存条目"
								// biome-ignore lint/a11y/noNoninteractiveTabindex: this scroll region needs keyboard access
								tabIndex={0}
							>
								<OverviewTable
									rows={filteredRows.filter((r) => r.nameSensitivity !== "hide")}
									loading={overviewLoading}
									now={now}
									expanded={expanded}
									keyLists={keyLists}
									busyFamily={busyFamily}
									onToggle={handleToggle}
									onLoadMore={handleLoadMore}
									onView={handleView}
									onDelete={onConfirmDelete}
									onRebuild={onConfirmRebuild}
									onInvalidateGroup={onConfirmInvalidate}
								/>
							</section>
						</LayerCard.Well>
					</LayerCard>
				</TabsContent>

				<KvTrendsTab
					metricsMinutes={metricsMinutes}
					metricsLoading={metricsLoading}
					metricsError={metricsError}
					metricsRows={metricsRows}
					occupancy={occupancy}
					windowLabel={windowLabel}
					onMetricsMinutes={setMetricsMinutes}
				/>
				<KvOperationsTab operations={operations} operationsError={operationsError} />
			</Tabs>

			<p className="flex items-start gap-2 text-xs text-basalt-muted-foreground">
				<ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
				预览不装载、不续期、不产生浏览/已读。成组失效不是内容重建。其他地区可能尚未看见本次写入或删除。
			</p>

			<KeyDetailDialog
				state={detail}
				now={now}
				busy={isBusy}
				onOpenChange={onDetailOpenChange}
				onCopy={onCopy}
				onExpand={onExpandDetail}
				onRebuild={onDetailRebuild}
				onDelete={onDetailDelete}
			/>

			<AdminConfirmDialog
				open={confirm.open}
				onOpenChange={onConfirmOpenChange}
				title={confirmTitle(confirm.kind)}
				description={confirmDescription(confirm)}
				confirmLabel={confirmTitle(confirm.kind)}
				cancelLabel="取消"
				loading={isBusy}
				error={confirmError}
				variant={confirm.kind === "delete" ? "destructive" : "default"}
				onConfirm={() => {
					void handleConfirm();
				}}
			/>
		</div>
	);
}
