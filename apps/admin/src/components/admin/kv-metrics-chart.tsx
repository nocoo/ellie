"use client";

import { AXIS_CONFIG, GRID_PROPS, getChartColor } from "@nocoo/basalt/charts/config";
import { ChartFrame } from "@nocoo/basalt/charts/frame";
import { ChartTooltipContent } from "@nocoo/basalt/charts/tooltip";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import {
	d1ObservationPoints,
	formatBytes,
	insertGapPoints,
	isAdminMetricFamily,
	isD1ObservationFamily,
	isFootprintFamily,
	type KvOp,
	metricHourMinute,
	type OccupancyPoint,
} from "@/lib/admin-kv-cache";

export interface KvMetric {
	family: string;
	tsMinute: number;
	op: KvOp;
	count: number;
}

const OPS_SERIES = [
	{ key: "hit", label: "命中", unit: "次" },
	{ key: "miss", label: "未命中", unit: "次" },
	{ key: "load", label: "回源装载", unit: "次" },
	{ key: "error", label: "回填/失效失败", unit: "次" },
	{ key: "kvOps", label: "KV 调用", unit: "次" },
] as const;

const PHYSICAL_KV_OPS = new Set<KvOp>(["kv-get", "kv-put", "kv-delete"]);

type OpBucket = Partial<Record<"hit" | "miss" | "load" | "error" | "kvOps", number>>;

export function bucketCacheOpPoints(series: KvMetric[]) {
	const buckets = new Map<number, OpBucket>();
	for (const row of series) {
		if (
			isAdminMetricFamily(row.family) ||
			isD1ObservationFamily(row.family) ||
			isFootprintFamily(row.family)
		)
			continue;
		const minute = metricHourMinute(row.tsMinute);
		const bucket = buckets.get(minute) ?? {};
		if (row.op === "hit") bucket.hit = (bucket.hit ?? 0) + row.count;
		else if (row.op === "miss") bucket.miss = (bucket.miss ?? 0) + row.count;
		else if (row.op === "load") bucket.load = (bucket.load ?? 0) + row.count;
		else if (row.op === "error") bucket.error = (bucket.error ?? 0) + row.count;
		if (PHYSICAL_KV_OPS.has(row.op)) bucket.kvOps = (bucket.kvOps ?? 0) + row.count;
		buckets.set(minute, bucket);
	}
	const minutes = [...buckets.keys()].sort((a, b) => a - b);
	return insertGapPoints(minutes.map((minute) => ({ tsMinute: minute, ...buckets.get(minute) })));
}

const OCCUPANCY_SERIES = [
	{ key: "liveEntries", label: "有效条目", unit: "条" },
	{ key: "staleEntries", label: "旧版本", unit: "条" },
	{ key: "contentBytes", label: "内容字节", unit: "B" },
] as const;

const D1_SERIES = [
	{ key: "queries", label: "语句次数", unit: "次" },
	{ key: "durationMs", label: "耗时", unit: "ms" },
	{ key: "rowsRead", label: "读行", unit: "行" },
	{ key: "rowsWritten", label: "写行", unit: "行" },
] as const;

const timeLabel = (minute: number) =>
	new Date(minute * 60_000).toLocaleString("zh-CN", {
		timeZone: "Asia/Shanghai",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

function bucketLabel(minute: number): string {
	return `小时 ${timeLabel(minute)}（Asia/Shanghai）`;
}

export function KvMetricsChart({
	series,
	occupancy,
	source = "应用小时观测",
	windowLabel = "近 24 小时",
}: {
	series: KvMetric[];
	occupancy?: OccupancyPoint[];
	source?: string;
	windowLabel?: string;
}) {
	const opPoints = bucketCacheOpPoints(series);

	const d1Points = d1ObservationPoints(series, "application:d1");
	const showD1Rows = d1Points.some((p) => p.rowsRead != null || p.rowsWritten != null);
	const d1Chart = insertGapPoints(d1Points);

	const occPoints = occupancy?.length
		? insertGapPoints(
				[...occupancy]
					.sort((a, b) => a.tsMinute - b.tsMinute)
					.map((p) => ({
						tsMinute: p.tsMinute,
						liveEntries: p.liveEntries,
						staleEntries: p.staleEntries,
						contentBytes: p.contentBytes,
						kind: p.kind,
					})),
			)
		: [];

	return (
		<div className="min-w-0 space-y-6">
			<div className="min-w-0 space-y-3">
				<p className="text-xs text-basalt-muted-foreground">
					{windowLabel} · 来源 {source} · 每小时一个点 · 命中率按已观测总量计算 · 缺失小时留空
				</p>
				<ul className="flex flex-wrap gap-4 text-xs" aria-label="缓存运行趋势图例">
					{OPS_SERIES.map((item, index) => (
						<li key={item.key} className="flex items-center gap-1.5">
							<span
								className="h-2 w-2 rounded-full"
								style={{ backgroundColor: getChartColor(index) }}
							/>
							{item.label}
						</li>
					))}
				</ul>
				<ChartFrame
					ariaLabel="缓存运行趋势"
					size="h-56 w-full"
					summary="应用记录的命中、未命中、回源装载、失败和物理 KV 调用；缺失记录留空，不插值。"
				>
					<LineChart data={opPoints} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
						<CartesianGrid {...GRID_PROPS} />
						<XAxis
							{...AXIS_CONFIG}
							dataKey="tsMinute"
							type="number"
							domain={["dataMin", "dataMax"]}
							tickFormatter={timeLabel}
							minTickGap={32}
						/>
						<YAxis {...AXIS_CONFIG} allowDecimals={false} width={42} />
						<Tooltip
							content={<ChartTooltipContent />}
							labelFormatter={(value) => `${bucketLabel(Number(value))} · ${source}`}
						/>
						{OPS_SERIES.map((item, index) => (
							<Line
								key={item.key}
								dataKey={item.key}
								name={`${item.label}（${item.unit}）`}
								type="linear"
								stroke={getChartColor(index)}
								strokeWidth={2}
								dot={{ r: 2 }}
								connectNulls={false}
								isAnimationActive={false}
							/>
						))}
					</LineChart>
				</ChartFrame>
			</div>
			{d1Points.length > 0 && (
				<div className="min-w-0 space-y-3">
					<p className="text-xs text-basalt-muted-foreground">
						D1
						读写按小时汇总已有请求的观测值，可能有漏样；不包含指标自身等未采集开销，不能作为完整计费统计。
					</p>
					<ul className="flex flex-wrap gap-4 text-xs" aria-label="应用观测 D1 图例">
						{D1_SERIES.filter((item) => item.key !== "rowsRead" && item.key !== "rowsWritten").map(
							(item, index) => (
								<li key={item.key} className="flex items-center gap-1.5">
									<span
										className="h-2 w-2 rounded-full"
										style={{ backgroundColor: getChartColor(index + 8) }}
									/>
									{item.label}
								</li>
							),
						)}
						{showD1Rows &&
							D1_SERIES.filter((item) => item.key === "rowsRead" || item.key === "rowsWritten").map(
								(item, index) => (
									<li key={item.key} className="flex items-center gap-1.5">
										<span
											className="h-2 w-2 rounded-full"
											style={{ backgroundColor: getChartColor(index + 10) }}
										/>
										{item.label}
									</li>
								),
							)}
					</ul>
					<ChartFrame
						ariaLabel="应用观测 D1"
						size="h-56 w-full"
						summary="已返回 meta 的语句次数、耗时，以及有行数时的读/写行；缺测分钟留空。"
					>
						<LineChart data={d1Chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
							<CartesianGrid {...GRID_PROPS} />
							<XAxis
								{...AXIS_CONFIG}
								dataKey="tsMinute"
								type="number"
								domain={["dataMin", "dataMax"]}
								tickFormatter={timeLabel}
								minTickGap={32}
							/>
							<YAxis {...AXIS_CONFIG} allowDecimals={false} width={52} />
							<Tooltip
								content={<ChartTooltipContent />}
								labelFormatter={(value) => `${bucketLabel(Number(value))} · application:d1`}
							/>
							{D1_SERIES.filter(
								(item) => showD1Rows || (item.key !== "rowsRead" && item.key !== "rowsWritten"),
							).map((item, index) => (
								<Line
									key={item.key}
									dataKey={item.key}
									name={`${item.label}（${item.unit}）`}
									type="linear"
									stroke={getChartColor(index + 8)}
									strokeWidth={2}
									dot={{ r: 2 }}
									connectNulls={false}
									isAnimationActive={false}
								/>
							))}
						</LineChart>
					</ChartFrame>
				</div>
			)}
			{occPoints.length > 0 && (
				<div className="min-w-0 space-y-3">
					<p className="text-xs text-basalt-muted-foreground">
						缓存内容量是内容 UTF-8 字节/估算，不是 Worker 内存或 KV
						账单存储。占用取观察值，不按日求和。
					</p>
					<ul className="flex flex-wrap gap-4 text-xs" aria-label="缓存内容量趋势图例">
						{OCCUPANCY_SERIES.map((item, index) => (
							<li key={item.key} className="flex items-center gap-1.5">
								<span
									className="h-2 w-2 rounded-full"
									style={{ backgroundColor: getChartColor(index + OPS_SERIES.length) }}
								/>
								{item.label}
							</li>
						))}
					</ul>
					<ChartFrame
						ariaLabel="缓存内容量趋势"
						size="h-56 w-full"
						summary="已观察的有效条目、旧版本和内容字节；采样范围变化时看标记，不能当作业务增长。"
					>
						<LineChart data={occPoints} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
							<CartesianGrid {...GRID_PROPS} />
							<XAxis
								{...AXIS_CONFIG}
								dataKey="tsMinute"
								type="number"
								domain={["dataMin", "dataMax"]}
								tickFormatter={timeLabel}
								minTickGap={32}
							/>
							<YAxis {...AXIS_CONFIG} allowDecimals={false} width={42} />
							<Tooltip
								content={<ChartTooltipContent />}
								labelFormatter={(value) => bucketLabel(Number(value))}
								formatter={(value, name) =>
									name?.toString().includes("字节") && typeof value === "number"
										? formatBytes(value)
										: value
								}
							/>
							{OCCUPANCY_SERIES.map((item, index) => (
								<Line
									key={item.key}
									dataKey={item.key}
									name={`${item.label}（${item.unit}）`}
									type="linear"
									stroke={getChartColor(index + OPS_SERIES.length)}
									strokeWidth={2}
									dot={{ r: 2 }}
									connectNulls={false}
									isAnimationActive={false}
								/>
							))}
						</LineChart>
					</ChartFrame>
				</div>
			)}
		</div>
	);
}
