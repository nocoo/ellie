"use client";

import { formatNumber } from "@ellie/shared";
import { AXIS_CONFIG, GRID_PROPS } from "@nocoo/basalt/charts/config";
import { ChartFrame } from "@nocoo/basalt/charts/frame";
import { ChartTooltipContent } from "@nocoo/basalt/charts/tooltip";
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsForumDistRow } from "@/viewmodels/admin/analytics";

interface ForumDistChartProps {
	rows: AnalyticsForumDistRow[];
	limit?: number;
}

/**
 * Horizontal-feel BarChart of post counts per forum (top N).
 *
 * The chart is rendered horizontally (`layout="vertical"`) so long
 * forum names don't clip; this is the same layout Firefly's
 * forum-distribution panel uses.
 */
export function ForumDistChart({ rows, limit = 12 }: ForumDistChartProps) {
	const data = [...rows].sort((a, b) => b.posts - a.posts).slice(0, limit);
	return (
		<ChartFrame ariaLabel="版块回复数分布" size="h-80 w-full">
			<BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
				<CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
				<XAxis {...AXIS_CONFIG} type="number" allowDecimals={false} />
				<YAxis
					{...AXIS_CONFIG}
					dataKey="forumName"
					type="category"
					width={100}
					tickFormatter={(name: string) => (name.length > 8 ? `${name.slice(0, 8)}…` : name)}
				/>
				<Tooltip
					cursor={{ fill: "hsl(var(--basalt-muted) / 0.4)" }}
					content={<ChartTooltipContent />}
				/>
				<Bar
					dataKey="posts"
					name="回复数"
					fill="hsl(var(--basalt-chart-3))"
					radius={[0, 4, 4, 0]}
					maxBarSize={16}
				>
					<LabelList
						dataKey="posts"
						position="right"
						className="fill-basalt-muted-foreground text-[10px]"
						formatter={(value) => (typeof value === "number" ? formatNumber(value) : String(value))}
					/>
				</Bar>
			</BarChart>
		</ChartFrame>
	);
}
