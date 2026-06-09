"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/admin/analytics/chart-tooltip";
import { DashboardResponsiveContainer } from "@/components/admin/analytics/responsive-container";
import type { AnalyticsTrendPoint } from "@/viewmodels/admin/analytics";

interface TrendChartProps {
	series: AnalyticsTrendPoint[];
	color?: string;
	valueLabel?: string;
}

/**
 * Pure AreaChart for a single time series. Caller controls the
 * outer dimensions via the parent div (we set 100% × 100%).
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
	color = "var(--color-chart-primary, #3b82f6)",
	valueLabel = "count",
}: TrendChartProps) {
	const gradientId = useId();
	const fillRef = `url(#${gradientId})`;
	return (
		<div className="h-72 w-full">
			<DashboardResponsiveContainer>
				<AreaChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={color} stopOpacity={0.35} />
							<stop offset="100%" stopColor={color} stopOpacity={0} />
						</linearGradient>
					</defs>
					<CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
					<XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
					<YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
					<Tooltip
						cursor={{ stroke: "hsl(var(--border))", strokeDasharray: "3 3" }}
						content={<ChartTooltip formatter={(value) => [Number(value), valueLabel]} />}
					/>
					<Area type="monotone" dataKey="count" stroke={color} strokeWidth={2} fill={fillRef} />
				</AreaChart>
			</DashboardResponsiveContainer>
		</div>
	);
}
