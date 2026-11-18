"use client";

import {
	ANIMATION_PROPS,
	CHART_PLOT_MARGIN,
	CHART_PLOT_MARGIN_BARE,
	CHART_TYPE,
	ChartFrame,
	ChartLegend,
	ChartTooltipContent,
	GRID_PROPS,
	getChartColor,
	seriesColor,
} from "@nocoo/basalt/components/chart";
import type { ReactNode } from "react";
import {
	Area,
	CartesianGrid,
	AreaChart as RechartsArea,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

interface AreaSeries {
	key: string;
	label?: string;
	color?: string;
}

interface AreaChartProps<T extends { x: string | number }> {
	data: T[];
	series: AreaSeries[];
	ariaLabel: string;
	className?: string;
	showAxes?: boolean;
	showLegend?: boolean;
	xValueFormatter?: (value: string | number) => string;
	valueFormatter?: (value: number) => string;
	summary?: ReactNode;
}

export function AreaChart<T extends { x: string | number }>({
	data,
	series,
	ariaLabel,
	className,
	showAxes = false,
	showLegend = false,
	xValueFormatter,
	valueFormatter,
	summary,
}: AreaChartProps<T>) {
	return (
		<ChartFrame
			ariaLabel={ariaLabel}
			className={className}
			legend={showLegend ? <ChartLegend items={series} shape="area" /> : undefined}
			summary={summary}
		>
			<ResponsiveContainer width="100%" height="100%">
				<RechartsArea
					accessibilityLayer
					aria-label={ariaLabel}
					data={data}
					margin={showAxes ? CHART_PLOT_MARGIN : CHART_PLOT_MARGIN_BARE}
				>
					{showAxes ? <CartesianGrid {...GRID_PROPS} /> : null}
					<XAxis
						dataKey="x"
						hide={!showAxes}
						axisLine={false}
						tickLine={false}
						tick={{ fill: "hsl(var(--basalt-chart-axis))", fontSize: CHART_TYPE.axisFontSize }}
						tickFormatter={xValueFormatter}
					/>
					<YAxis
						hide={!showAxes}
						axisLine={false}
						tickLine={false}
						tick={{ fill: "hsl(var(--basalt-chart-axis))", fontSize: CHART_TYPE.axisFontSize }}
						tickFormatter={valueFormatter}
					/>
					<Tooltip
						cursor={{ stroke: "hsl(var(--basalt-border))", strokeDasharray: CHART_TYPE.gridDash }}
						content={<ChartTooltipContent formatter={valueFormatter} />}
						wrapperStyle={{ outline: "none" }}
					/>
					{series.map((item, index) => {
						const color = seriesColor(item, index) ?? getChartColor(index);
						return (
							<Area
								key={item.key}
								dataKey={item.key}
								name={item.label ?? item.key}
								stroke={color}
								strokeWidth={CHART_TYPE.strokeWidth}
								fill={color}
								fillOpacity={CHART_TYPE.areaFillAlpha}
								{...ANIMATION_PROPS}
							/>
						);
					})}
				</RechartsArea>
			</ResponsiveContainer>
		</ChartFrame>
	);
}
