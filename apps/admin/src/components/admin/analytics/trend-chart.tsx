"use client";

import { formatNumber } from "@ellie/shared";
import { AXIS_CONFIG, GRID_PROPS } from "@nocoo/basalt/charts/config";
import { ChartFrame } from "@nocoo/basalt/charts/frame";
import { ChartTooltipContent } from "@nocoo/basalt/charts/tooltip";
import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { type AnalyticsTrendPoint, summarizeTrend } from "@/viewmodels/admin/analytics";

interface TrendChartProps {
	series: AnalyticsTrendPoint[];
	color?: string;
	valueLabel?: string;
}

/**
 * Pure AreaChart for a single time series. Caller controls the
 * dimensions through Basalt ChartFrame.
 *
 * `series` is expected dense (one point per day); the wrapping
 * viewmodel calls fill missing days with `count=0` so the x-axis is
 * always continuous.
 *
 * The gradient `<linearGradient>` id is derived from React's
 * `useId()` so two TrendChart instances on the same page do not
 * collide on a shared SVG defs id (the admin dashboard renders one
 * chart for the selected business metric plus one checkin chart).
 */
export function TrendChart({
	series,
	color = "hsl(var(--basalt-chart-1))",
	valueLabel = "count",
}: TrendChartProps) {
	const gradientId = useId();
	const fillRef = `url(#${gradientId})`;
	const summary = summarizeTrend(series);
	return (
		<div className="min-w-0 space-y-3">
			<dl
				aria-label={`${valueLabel}区间统计`}
				className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"
			>
				{[
					["区间总量", formatNumber(summary.total)],
					[
						"日均",
						summary.average == null
							? "—"
							: summary.average.toLocaleString("zh-CN", { maximumFractionDigits: 1 }),
					],
					[
						summary.peak ? `峰值 · ${summary.peak.date.slice(5)}` : "峰值",
						summary.peak ? formatNumber(summary.peak.count) : "—",
					],
					["有活动天数", `${summary.activeDays} / ${series.length}`],
				].map(([label, value]) => (
					<div key={label}>
						<dt className="text-basalt-muted-foreground">{label}</dt>
						<dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd>
					</div>
				))}
			</dl>
			<ChartFrame ariaLabel={`${valueLabel}趋势`} size="h-60 w-full">
				<AreaChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={color} stopOpacity={0.35} />
							<stop offset="100%" stopColor={color} stopOpacity={0} />
						</linearGradient>
					</defs>
					<CartesianGrid {...GRID_PROPS} />
					<XAxis
						{...AXIS_CONFIG}
						dataKey="date"
						minTickGap={24}
						tickFormatter={(date) => String(date).slice(5)}
					/>
					<YAxis
						{...AXIS_CONFIG}
						allowDecimals={false}
						width={44}
						tickFormatter={(value: number) =>
							value.toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 })
						}
					/>
					<Tooltip
						cursor={{ stroke: "hsl(var(--basalt-border))", strokeDasharray: "3 3" }}
						content={<ChartTooltipContent />}
					/>
					<Area
						type="monotone"
						dataKey="count"
						name={valueLabel}
						stroke={color}
						strokeWidth={2}
						fill={fillRef}
					/>
				</AreaChart>
			</ChartFrame>
		</div>
	);
}
