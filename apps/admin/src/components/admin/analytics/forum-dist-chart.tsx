"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/admin/analytics/chart-tooltip";
import { DashboardResponsiveContainer } from "@/components/admin/analytics/responsive-container";
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
	const data = rows.slice(0, limit);
	return (
		<div className="h-[420px] w-full">
			<DashboardResponsiveContainer>
				<BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
					<XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
					<YAxis dataKey="forumName" type="category" tick={{ fontSize: 11 }} width={140} />
					<Tooltip
						cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
						content={<ChartTooltip formatter={(value) => [Number(value), "回复数"]} />}
					/>
					<Bar dataKey="posts" fill="var(--color-chart-secondary, #10b981)" radius={[0, 4, 4, 0]} />
				</BarChart>
			</DashboardResponsiveContainer>
		</div>
	);
}
