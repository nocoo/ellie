"use client";

import { formatNumber } from "@ellie/shared";
import type { MemoryCacheEntry, MemoryCacheFamilyId, MemoryCacheOverview } from "@ellie/types";
import { Badge, Button, DescriptionList, LayerCard } from "@nocoo/basalt";
import { AreaChart } from "@nocoo/basalt/charts/area";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { Activity, Clock, Eraser, Gauge, MemoryStick, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { formatBytes } from "@/lib/admin-kv-cache";
import {
	entryPages,
	fetchMemoryOverview,
	formatTimestamp,
	formatUptime,
	historyChartRows,
	hitRateLabel,
	instanceChanged,
	MEMORY_FAMILY_LABELS,
	MemoryCacheRequestError,
	mutateMemoryCache,
	payloadShareLabel,
	remainingMs,
} from "@/viewmodels/admin/memory-cache";

const PAGE_LIMIT = 50;
const POLL_INTERVAL_MS = 15_000;

type Phase = "loading" | "ready" | "failed";

type ConfirmTarget =
	| { kind: "flush" }
	| { kind: "clear-all" }
	| { kind: "clear-family"; family: MemoryCacheFamilyId }
	| { kind: "clear-entry"; family: MemoryCacheFamilyId; key: string };

function confirmCopy(
	target: ConfirmTarget,
	overview: MemoryCacheOverview,
): { title: string; description: string; confirmLabel: string } {
	const instanceSuffix = `当前实例 ${overview.instance.id}（版本 ${overview.instance.version}）。`;
	if (target.kind === "flush") {
		return {
			title: "立即冲刷统计缓冲",
			description: `把待冲刷的浏览/活跃观测交给 Worker 提交。${instanceSuffix}`,
			confirmLabel: "确认冲刷",
		};
	}
	if (target.kind === "clear-all") {
		return {
			title: "清除全部展示缓存",
			description: `仅清除全部展示家族的内存条目，不影响统计缓冲；下次读取会按需回源重建。${instanceSuffix}`,
			confirmLabel: "确认清除",
		};
	}
	if (target.kind === "clear-family") {
		return {
			title: `清除家族 ${MEMORY_FAMILY_LABELS[target.family] ?? target.family}`,
			description: `仅清除该家族的内存条目，不删除 D1 业务数据。${instanceSuffix}`,
			confirmLabel: "确认清除",
		};
	}
	return {
		title: "清除单个缓存条目",
		description: `清除 ${target.family} 的 ${target.key}。仅影响展示缓存，不删除业务数据。${instanceSuffix}`,
		confirmLabel: "确认清除",
	};
}

function buildMutationPayload(
	target: ConfirmTarget & { instanceId: string },
): Parameters<typeof mutateMemoryCache>[0] {
	if (target.kind === "flush") {
		return { instanceId: target.instanceId, action: "flush" };
	}
	if (target.kind === "clear-all") {
		return { instanceId: target.instanceId, action: "clear" };
	}
	if (target.kind === "clear-family") {
		return { instanceId: target.instanceId, action: "clear", family: target.family };
	}
	return {
		instanceId: target.instanceId,
		action: "clear",
		family: target.family,
		key: target.key,
	};
}

function InstanceCard({ overview }: { overview: MemoryCacheOverview }) {
	return (
		<LayerCard>
			<LayerCard.Header>实例信息</LayerCard.Header>
			<LayerCard.Body>
				<DescriptionList columns={2}>
					<DescriptionList.Item term="实例 ID">
						<span className="break-all font-mono text-xs" title={overview.instance.id}>
							{overview.instance.id}
						</span>
					</DescriptionList.Item>
					<DescriptionList.Item term="版本">
						<span className="font-mono text-xs">{overview.instance.version}</span>
					</DescriptionList.Item>
					<DescriptionList.Item term="启动时间">
						{formatTimestamp(overview.instance.startedAt)}
					</DescriptionList.Item>
					<DescriptionList.Item term="运行时长">
						{formatUptime(overview.instance.uptimeMs)}
					</DescriptionList.Item>
					<DescriptionList.Item term="进程 RSS">
						{formatBytes(overview.memory.rssBytes)}
					</DescriptionList.Item>
					<DescriptionList.Item term="堆内存（已用）">
						{formatBytes(overview.memory.heapUsedBytes)}
					</DescriptionList.Item>
					<DescriptionList.Item term="缓存估算占用">
						{formatBytes(overview.memory.estimatedPayloadBytes)}
					</DescriptionList.Item>
					<DescriptionList.Item term="占用上限">
						{formatBytes(overview.memory.payloadLimitBytes)} · 已用 {payloadShareLabel(overview)}
					</DescriptionList.Item>
				</DescriptionList>
				<p className="mt-3 text-xs text-basalt-muted-foreground">
					管理目标是单个 Web 进程实例；进程重启后实例 ID 变化，缓存与缓冲计数从零开始。
				</p>
			</LayerCard.Body>
		</LayerCard>
	);
}

function FamilyTable({
	overview,
	onClearFamily,
}: {
	overview: MemoryCacheOverview;
	onClearFamily: (family: MemoryCacheFamilyId) => void;
}) {
	return (
		<LayerCard padding="none" className="overflow-hidden">
			<LayerCard.Well className="p-0">
				<Table className="whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2">
					<TableHeader>
						<TableRow>
							<TableHead>家族</TableHead>
							<TableHead className="text-right">条目 / 容量</TableHead>
							<TableHead className="text-right">命中 / 未命中</TableHead>
							<TableHead className="text-right">命中率</TableHead>
							<TableHead className="text-right">逐出</TableHead>
							<TableHead className="text-right">装载失败</TableHead>
							<TableHead className="w-32 text-right">操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{overview.families.map((family) => (
							<TableRow key={family.id}>
								<TableCell>
									<div className="font-semibold">
										{MEMORY_FAMILY_LABELS[family.id] ?? family.id}
									</div>
									<div className="font-mono text-xs text-basalt-muted-foreground">{family.id}</div>
								</TableCell>
								<TableCell className="text-right font-mono text-xs tabular-nums">
									{formatNumber(family.entries)} / {formatNumber(family.maxEntries)}
								</TableCell>
								<TableCell className="text-right font-mono text-xs tabular-nums">
									{formatNumber(family.hits)} / {formatNumber(family.misses)}
								</TableCell>
								<TableCell className="text-right font-mono text-xs tabular-nums">
									{hitRateLabel(family.hits, family.misses)}
								</TableCell>
								<TableCell className="text-right font-mono text-xs tabular-nums">
									{formatNumber(family.evictions)}
								</TableCell>
								<TableCell className="text-right font-mono text-xs tabular-nums">
									{formatNumber(family.loadErrors)}
								</TableCell>
								<TableCell className="text-right">
									<Button size="sm" variant="ghost" onClick={() => onClearFamily(family.id)}>
										<Trash2 className="mr-1 h-3 w-3" aria-hidden="true" />
										清除整组
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</LayerCard.Well>
		</LayerCard>
	);
}

function EntryTable({
	overview,
	now,
	onClearEntry,
}: {
	overview: MemoryCacheOverview;
	now: number;
	onClearEntry: (entry: MemoryCacheEntry) => void;
}) {
	return (
		<LayerCard padding="none" className="overflow-hidden">
			{overview.entries.length > 0 ? (
				<LayerCard.Well className="p-0">
					<Table className="whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2">
						<TableHeader>
							<TableRow>
								<TableHead>家族</TableHead>
								<TableHead>Key</TableHead>
								<TableHead>创建时间</TableHead>
								<TableHead>到期时间</TableHead>
								<TableHead>剩余</TableHead>
								<TableHead className="text-right">大小</TableHead>
								<TableHead>安全预览</TableHead>
								<TableHead className="w-24 text-right">操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{overview.entries.map((entry) => {
								const left = remainingMs(entry.expiresAt, now);
								return (
									<TableRow key={`${entry.family}:${entry.key}`}>
										<TableCell className="font-mono text-xs">{entry.family}</TableCell>
										<TableCell className="max-w-64 font-mono text-xs">
											<span className="block truncate" title={entry.key}>
												{entry.key}
											</span>
										</TableCell>
										<TableCell className="text-xs text-basalt-muted-foreground">
											{formatTimestamp(entry.createdAt)}
										</TableCell>
										<TableCell className="text-xs text-basalt-muted-foreground">
											{formatTimestamp(entry.expiresAt)}
										</TableCell>
										<TableCell className="text-xs tabular-nums">
											{left === null ? "—" : `${Math.max(0, Math.round(left / 1000))} 秒`}
										</TableCell>
										<TableCell className="text-right font-mono text-xs">
											{formatBytes(entry.estimatedBytes)}
										</TableCell>
										<TableCell className="max-w-72 font-mono text-xs">
											<span
												className="block truncate text-basalt-muted-foreground"
												title={entry.preview}
											>
												{entry.preview || "—"}
											</span>
										</TableCell>
										<TableCell className="text-right">
											<Button size="sm" variant="ghost" onClick={() => onClearEntry(entry)}>
												<Trash2 className="mr-1 h-3 w-3" aria-hidden="true" />
												清除此条
											</Button>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</LayerCard.Well>
			) : (
				<div className="py-10 text-center text-sm text-basalt-muted-foreground">
					该筛选下当前没有条目。空列表只表示尚未访问，不是缓存故障。
				</div>
			)}
		</LayerCard>
	);
}

function BuffersCard({
	overview,
	onFlush,
}: {
	overview: MemoryCacheOverview;
	onFlush: () => void;
}) {
	const buffers = overview.buffers;
	return (
		<LayerCard>
			<LayerCard.Header className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<Activity className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
					缓冲与冲刷状态
				</h2>
				<div className="flex items-center gap-2">
					{buffers.flushing ? (
						<Badge variant="secondary">冲刷进行中</Badge>
					) : (
						<Badge variant="outline">空闲</Badge>
					)}
					<Button size="sm" variant="outline" onClick={onFlush}>
						<Send className="mr-1 h-3 w-3" aria-hidden="true" />
						立即冲刷
					</Button>
				</div>
			</LayerCard.Header>
			<LayerCard.Body>
				<DescriptionList columns={3}>
					<DescriptionList.Item term="待冲刷主题">
						{formatNumber(buffers.pendingThreads)}
					</DescriptionList.Item>
					<DescriptionList.Item term="待冲刷浏览">
						{formatNumber(buffers.pendingViews)}
					</DescriptionList.Item>
					<DescriptionList.Item term="待处理活跃用户">
						{formatNumber(buffers.pendingUsers)}
					</DescriptionList.Item>
					<DescriptionList.Item term="最早待冲刷">
						{formatTimestamp(buffers.oldestPendingAt)}
					</DescriptionList.Item>
					<DescriptionList.Item term="上次冲刷">
						{formatTimestamp(buffers.lastFlushAt)}
					</DescriptionList.Item>
					<DescriptionList.Item term="上次冲刷成功">
						{formatTimestamp(buffers.lastSuccessAt)}
					</DescriptionList.Item>
					<DescriptionList.Item term="未确认浏览批次">
						{formatNumber(buffers.unconfirmedViews)}
					</DescriptionList.Item>
					<DescriptionList.Item term="丢弃浏览">
						{formatNumber(buffers.droppedViews)}
					</DescriptionList.Item>
					<DescriptionList.Item term="丢弃活跃观测">
						{formatNumber(buffers.droppedActivities)}
					</DescriptionList.Item>
				</DescriptionList>
				<p className="mt-3 text-xs text-basalt-muted-foreground">
					计时器与手动冲刷共用一个锁；冲刷只提交待处理缓冲，不会修改或丢弃任意缓冲值。进程重启会丢弃未发送的缓冲。
				</p>
			</LayerCard.Body>
		</LayerCard>
	);
}

function formatSampleTime(value: string | number): string {
	return new Date(Number(value)).toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function HistoryCard({ overview }: { overview: MemoryCacheOverview }) {
	const rows = useMemo(() => historyChartRows(overview.history), [overview.history]);
	if (rows.length === 0) {
		return (
			<LayerCard>
				<LayerCard.Header>进程内历史采样</LayerCard.Header>
				<LayerCard.Body>
					<p className="py-6 text-center text-sm text-basalt-muted-foreground">
						尚无采样。固定保留最近 60 个一分钟采样点，仅存在于进程内存中。
					</p>
				</LayerCard.Body>
			</LayerCard>
		);
	}
	const payloadSeries = [
		{ key: "payloadBytes" as const, label: "缓存估算占用", color: "hsl(var(--basalt-chart-1))" },
	];
	const pendingSeries = [
		{ key: "pendingViews" as const, label: "待冲刷浏览", color: "hsl(var(--basalt-chart-3))" },
	];
	return (
		<LayerCard>
			<LayerCard.Header>进程内历史采样</LayerCard.Header>
			<LayerCard.Body className="space-y-6">
				<div className="space-y-2">
					<h3 className="text-xs font-semibold text-basalt-muted-foreground">
						缓存估算占用（字节）
					</h3>
					<AreaChart
						data={rows}
						series={payloadSeries}
						showAxes
						showLegend
						className="h-40 w-full"
						ariaLabel="缓存估算占用历史"
						xValueFormatter={formatSampleTime}
						valueFormatter={formatNumber}
						summary="进程内每分钟采样，最多保留 60 个点；重启后清零，不持久化。"
					/>
				</div>
				<div className="space-y-2">
					<h3 className="text-xs font-semibold text-basalt-muted-foreground">待冲刷浏览（次）</h3>
					<AreaChart
						data={rows}
						series={pendingSeries}
						showAxes
						showLegend
						className="h-40 w-full"
						ariaLabel="待冲刷浏览历史"
						xValueFormatter={formatSampleTime}
						valueFormatter={formatNumber}
						summary="进程内每分钟采样，最多保留 60 个点；重启后清零，不持久化。"
					/>
				</div>
			</LayerCard.Body>
		</LayerCard>
	);
}

function ConfigMissingCard() {
	return (
		<LayerCard>
			<LayerCard.Header>管理通道未配置</LayerCard.Header>
			<LayerCard.Body className="space-y-2 text-sm text-basalt-muted-foreground">
				<p>管理端缺少内存缓存管理配置，已按未配置失败关闭，不会回退到任意来源。</p>
				<DescriptionList columns={1}>
					<DescriptionList.Item term="管理端（admin）环境变量">
						<span className="font-mono text-xs">WEB_MEMORY_ADMIN_URL</span>（Docker 内部 Web 源）与{" "}
						<span className="font-mono text-xs">MEMORY_CACHE_ADMIN_KEY</span>
					</DescriptionList.Item>
					<DescriptionList.Item term="Web 端环境变量">
						<span className="font-mono text-xs">MEMORY_CACHE_ADMIN_KEY</span>
						（同一管理密钥，仅服务端持有）
					</DescriptionList.Item>
				</DescriptionList>
				<p>配置后重启 admin 服务即可，无需热更新。</p>
			</LayerCard.Body>
		</LayerCard>
	);
}

export default function MemoryCachePage() {
	const [phase, setPhase] = useState<Phase>("loading");
	const [errorCode, setErrorCode] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [overview, setOverview] = useState<MemoryCacheOverview | null>(null);
	const [loadedAt, setLoadedAt] = useState<number | null>(null);
	const [familyFilter, setFamilyFilter] = useState<MemoryCacheFamilyId | "all">("all");
	const [page, setPage] = useState(1);
	const [now, setNow] = useState(() => Date.now());
	const [confirmTarget, setConfirmTarget] = useState<
		(ConfirmTarget & { instanceId: string }) | null
	>(null);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [mutating, setMutating] = useState(false);
	const [conflictNotice, setConflictNotice] = useState<string | null>(null);
	const [restartNotice, setRestartNotice] = useState(false);
	const inFlight = useRef(false);
	const queuedLoad = useRef(false);
	const loadRef = useRef<() => Promise<void>>(async () => {});
	const mounted = useRef(true);
	const instanceIdRef = useRef<string | null>(null);

	const showLoadError = useCallback((err: unknown) => {
		setErrorCode(err instanceof MemoryCacheRequestError ? err.code : null);
		setErrorMessage(err instanceof Error ? err.message : "加载失败");
		setPhase("failed");
	}, []);

	const load = useCallback(async () => {
		if (inFlight.current) {
			queuedLoad.current = true;
			return;
		}
		inFlight.current = true;
		try {
			const data = await fetchMemoryOverview({
				...(familyFilter === "all" ? {} : { family: familyFilter }),
				page,
				limit: PAGE_LIMIT,
			});
			if (!mounted.current || queuedLoad.current) return;
			if (
				instanceChanged(instanceIdRef.current ? { id: instanceIdRef.current } : null, data.instance)
			) {
				setRestartNotice(true);
				setConfirmTarget(null);
				setConfirmError(null);
			}
			instanceIdRef.current = data.instance.id;
			setOverview(data);
			setPhase("ready");
			setErrorCode(null);
			setErrorMessage(null);
			setLoadedAt(Date.now());
			setNow(Date.now());
		} catch (err) {
			if (!mounted.current || queuedLoad.current) return;
			showLoadError(err);
		} finally {
			inFlight.current = false;
			if (queuedLoad.current && mounted.current) {
				queuedLoad.current = false;
				void loadRef.current();
			}
		}
	}, [familyFilter, page, showLoadError]);

	useEffect(() => {
		loadRef.current = load;
		void load();
	}, [load]);

	useEffect(() => {
		const id = setInterval(() => {
			if (document.visibilityState === "visible") void load();
		}, POLL_INTERVAL_MS);
		const onVisibility = () => {
			if (document.visibilityState === "visible") void load();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			clearInterval(id);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [load]);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			queuedLoad.current = false;
		};
	}, []);

	const openConfirmation = (target: ConfirmTarget) => {
		if (!overview) return;
		setConfirmError(null);
		setConfirmTarget({ ...target, instanceId: overview.instance.id });
	};

	const refresh = useCallback(() => {
		setRestartNotice(false);
		void load();
	}, [load]);

	const runMutation = useCallback(async () => {
		if (!overview || !confirmTarget || mutating) return;
		setMutating(true);
		setConfirmError(null);
		try {
			await mutateMemoryCache(buildMutationPayload(confirmTarget));
			setConfirmTarget(null);
			await load();
		} catch (err) {
			if (err instanceof MemoryCacheRequestError && err.code === "INSTANCE_CONFLICT") {
				setConflictNotice(
					"Web 实例已变更（instanceId 不匹配）。已刷新为新实例，请重新确认操作，未自动重试。",
				);
				setConfirmTarget(null);
				await load();
			} else if (!(err instanceof MemoryCacheRequestError) || err.code === "UPSTREAM_UNAVAILABLE") {
				setConflictNotice(
					"操作结果尚未确认，正在刷新状态。请核对实例和缓冲后再决定是否操作；未自动重试。",
				);
				setConfirmTarget(null);
				await load();
			} else {
				setConfirmError(err.message);
			}
		} finally {
			setMutating(false);
		}
	}, [overview, confirmTarget, mutating, load]);

	const familyOptions = useMemo(
		() => [
			{ value: "all", label: "全部家族" },
			...(Object.keys(MEMORY_FAMILY_LABELS) as MemoryCacheFamilyId[]).map((id) => ({
				value: id,
				label: MEMORY_FAMILY_LABELS[id],
			})),
		],
		[],
	);

	const confirmCopyMemo = overview && confirmTarget ? confirmCopy(confirmTarget, overview) : null;

	return (
		<div className="space-y-5">
			<PageHeader
				title={
					<span className="flex items-center gap-2.5">
						<MemoryStick
							className="h-6 w-6 text-basalt-primary"
							aria-hidden="true"
							strokeWidth={1.5}
						/>
						内存缓存监控
					</span>
				}
				description="Web 进程内存缓存与统计缓冲的管理视图 · 仅针对单个实例"
				actions={
					<>
						{phase === "ready" && overview && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => openConfirmation({ kind: "clear-all" })}
							>
								<Eraser className="mr-2 h-4 w-4" aria-hidden="true" />
								清除全部展示缓存
							</Button>
						)}
						<Button variant="outline" size="sm" onClick={refresh} disabled={phase === "loading"}>
							<RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
							刷新
						</Button>
					</>
				}
			/>

			{phase === "loading" && !overview && (
				<LayerCard className="flex min-h-48 items-center justify-center gap-2">
					<Loader size={20} />
					<span role="status" className="text-sm text-basalt-muted-foreground">
						加载内存缓存状态…
					</span>
				</LayerCard>
			)}

			{phase === "failed" && (
				<>
					{errorCode === "NOT_CONFIGURED" ? (
						<ConfigMissingCard />
					) : (
						<AdminInlineMessage
							variant="error"
							text={
								errorCode === "UPSTREAM_UNAVAILABLE"
									? "内存缓存管理接口不可用：Web 进程可能未启动或管理路由不可达。不会把不可用显示为空缓存。"
									: `加载失败${errorMessage ? `：${errorMessage}` : ""}`
							}
						/>
					)}
					{overview && (
						<p className="text-xs text-basalt-muted-foreground">
							下方仍显示最后一次成功快照（采集于{" "}
							{loadedAt ? new Date(loadedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}）。
						</p>
					)}
				</>
			)}

			{conflictNotice && (
				<div className="flex items-start justify-between gap-3">
					<AdminInlineMessage variant="error" text={conflictNotice} />
					<Button variant="ghost" size="sm" onClick={() => setConflictNotice(null)}>
						关闭
					</Button>
				</div>
			)}
			{restartNotice && (
				<div className="flex items-start justify-between gap-3">
					<AdminInlineMessage
						variant="info"
						text="检测到 Web 实例重启（实例 ID 已变化）。展示的是新实例从零开始的状态，不是空缓存故障。"
					/>
					<Button variant="ghost" size="sm" onClick={() => setRestartNotice(false)}>
						知道了
					</Button>
				</div>
			)}

			{overview && (
				<>
					<AdminMetrics
						items={[
							{
								label: "运行时长",
								value: formatUptime(overview.instance.uptimeMs),
								icon: Clock,
								hint: `启动于 ${formatTimestamp(overview.instance.startedAt)}`,
							},
							{
								label: "进程 RSS",
								value: formatBytes(overview.memory.rssBytes),
								icon: Gauge,
								hint: "进程常驻内存，与缓存占用分开计量",
							},
							{
								label: "堆内存（已用）",
								value: formatBytes(overview.memory.heapUsedBytes),
								icon: MemoryStick,
								hint: "V8 堆已用",
							},
							{
								label: "缓存估算占用",
								value: `${formatBytes(overview.memory.estimatedPayloadBytes)} / ${formatBytes(overview.memory.payloadLimitBytes)}`,
								icon: Eraser,
								hint: `已用 ${payloadShareLabel(overview)} · 估算载荷上限`,
							},
						]}
					/>

					<SectionRule title="实例与内存" hint="管理与业务读取共享同一运行时单例。">
						<InstanceCard overview={overview} />
					</SectionRule>

					<SectionRule title="缓存家族" hint="计数自进程启动累计；清除只作用于展示条目。">
						<FamilyTable
							overview={overview}
							onClearFamily={(family) => openConfirmation({ kind: "clear-family", family })}
						/>
					</SectionRule>

					<SectionRule
						title="缓存条目"
						hint="预览已按 512 字节封顶并做安全脱敏；管理读取不影响命中统计与 LRU 顺序。"
						actions={
							<Select
								value={familyFilter}
								onValueChange={(value) => {
									setFamilyFilter(value === "all" ? "all" : (value as MemoryCacheFamilyId));
									setPage(1);
								}}
							>
								<SelectTrigger aria-label="按家族筛选条目" className="h-8 w-40 text-sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{familyOptions.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						}
					>
						<EntryTable
							overview={overview}
							now={now}
							onClearEntry={(entry) =>
								openConfirmation({ kind: "clear-entry", family: entry.family, key: entry.key })
							}
						/>
						{overview.pagination.total > 0 && (
							<AdminPagination
								pagination={{
									page,
									pages: entryPages(overview.pagination.total, overview.pagination.limit),
									total: overview.pagination.total,
									limit: overview.pagination.limit,
								}}
								onPageChange={setPage}
							/>
						)}
					</SectionRule>

					<SectionRule title="统计缓冲" hint="待冲刷观测与冲刷状态；未确认批次不会被重试。">
						<BuffersCard overview={overview} onFlush={() => openConfirmation({ kind: "flush" })} />
					</SectionRule>

					<SectionRule title="历史采样" hint="进程内最近 60 个一分钟采样，不落盘。">
						<HistoryCard overview={overview} />
					</SectionRule>
				</>
			)}

			{confirmCopyMemo && (
				<AdminConfirmDialog
					open
					onOpenChange={(open) => {
						if (!open && !mutating) {
							setConfirmTarget(null);
							setConfirmError(null);
						}
					}}
					title={confirmCopyMemo.title}
					description={confirmCopyMemo.description}
					confirmLabel={confirmCopyMemo.confirmLabel}
					cancelLabel="取消"
					variant={confirmTarget?.kind === "flush" ? "default" : "destructive"}
					loading={mutating}
					error={confirmError}
					onConfirm={runMutation}
				/>
			)}
		</div>
	);
}
