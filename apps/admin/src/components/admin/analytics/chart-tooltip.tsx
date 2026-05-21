"use client";

import type { ReactNode } from "react";

interface TooltipPayloadEntry {
	value?: number | string;
	name?: string | number;
	color?: string;
	dataKey?: string | number;
}

interface ChartTooltipProps {
	active?: boolean;
	payload?: TooltipPayloadEntry[];
	label?: ReactNode;
	formatter?: (value: number, name: string) => [string | number, string];
}

/**
 * Recharts-compatible tooltip mirroring the pew dashboard treatment:
 * bg-popover surface, hairline ring, soft shadow, and 10px widget radius.
 *
 * Replaces the previous inline `contentStyle={{ background: "var(--background)" }}`
 * pattern, which silently broke because Recharts injects the value as
 * raw CSS — and our `--background` token holds an HSL triplet, not a
 * complete colour, so the tooltip rendered fully transparent on the
 * dashboard.
 */
export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
	if (!active || !payload || payload.length === 0) return null;

	return (
		<div className="rounded-[var(--radius-widget,10px)] bg-popover p-2.5 text-popover-foreground shadow-lg ring-1 ring-border/60">
			{label !== undefined && label !== null && label !== "" && (
				<div className="mb-1.5 text-xs font-medium">{label}</div>
			)}
			<div className="space-y-1">
				{payload.map((entry, i) => {
					const rawValue = typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0);
					const seriesName = entry.name != null ? String(entry.name) : "";
					const [displayValue, displayLabel] = formatter
						? formatter(rawValue, seriesName)
						: [rawValue, seriesName];
					return (
						<div
							key={`${seriesName}-${String(entry.dataKey ?? i)}`}
							className="flex items-center gap-2 text-xs text-muted-foreground"
						>
							<span
								className="h-2 w-2 shrink-0 rounded-full"
								style={{ backgroundColor: entry.color }}
								aria-hidden
							/>
							{displayLabel && <span>{displayLabel}</span>}
							<span className="ml-auto font-medium tabular-nums text-popover-foreground">
								{displayValue}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
