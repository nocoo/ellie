"use client";

import { AXIS_CONFIG, GRID_PROPS, getChartColor } from "@nocoo/basalt/charts/config";
import { ChartFrame } from "@nocoo/basalt/charts/frame";
import { ChartTooltipContent } from "@nocoo/basalt/charts/tooltip";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

type Op = "read" | "hit" | "miss" | "write" | "bump" | "delete" | "error";

export interface KvMetric {
	family: string;
	tsMinute: number;
	op: Op;
	count: number;
}

const SERIES = [
	{ key: "read", label: "读取" },
	{ key: "hit", label: "命中" },
	{ key: "miss", label: "未命中" },
	{ key: "error", label: "错误" },
] as const;

const timeLabel = (minute: number) =>
	new Date(minute * 60_000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

export function KvMetricsChart({ series }: { series: KvMetric[] }) {
	const buckets = new Map<number, Partial<Record<Op, number>>>();
	for (const row of series) {
		const bucket = buckets.get(row.tsMinute) ?? {};
		bucket[row.op] = (bucket[row.op] ?? 0) + row.count;
		buckets.set(row.tsMinute, bucket);
	}
	const minutes = [...buckets.keys()].sort((a, b) => a - b);
	// Preserve gaps instead of implying zero traffic or interpolating a missing minute.
	const points = minutes.flatMap((minute, index) => {
		const point = { tsMinute: minute, ...buckets.get(minute) };
		return index > 0 && minute > minutes[index - 1] + 1
			? [{ tsMinute: minutes[index - 1] + 1 }, point]
			: [point];
	});
	return (
		<div className="min-w-0 space-y-3">
			<ul className="flex flex-wrap gap-4 text-xs" aria-label="缓存趋势图例">
				{SERIES.map((item, index) => (
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
				ariaLabel="缓存每分钟操作趋势"
				size="h-56 w-full"
				summary="按缓存家族汇总每分钟已记录的读取、命中、未命中和错误；缺失记录留空。"
			>
				<LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
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
						labelFormatter={(value) => timeLabel(Number(value))}
					/>
					{SERIES.map((item, index) => (
						<Line
							key={item.key}
							dataKey={item.key}
							name={item.label}
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
	);
}
