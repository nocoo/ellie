import { formatNumber } from "@ellie/shared";
import { StatCard as BasaltStatCard } from "@nocoo/basalt/components/stat-card";
import type { ElementType } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatCardSubItem {
	label: string;
	value: string | number;
}

export interface StatCardProps {
	label: string;
	value: string | number;
	icon?: ElementType;
	subItems?: StatCardSubItem[];
	hint?: string;
	tone?: "success" | "danger";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatCard({ label, value, icon: Icon, subItems, hint, tone }: StatCardProps) {
	const formattedValue = typeof value === "number" ? formatNumber(value) : value;
	return (
		<BasaltStatCard
			label={label}
			value={formattedValue}
			subtitle={hint}
			ariaLabel={`${label} ${formattedValue}`}
			className="h-full"
			icon={Icon ? <Icon className="h-4 w-4" strokeWidth={1.5} /> : undefined}
			iconColor="text-basalt-primary"
			status={
				tone ? (
					<span
						className={`text-xl font-semibold tabular-nums ${tone === "success" ? "text-basalt-primary" : "text-basalt-destructive"}`}
					>
						{formattedValue}
					</span>
				) : undefined
			}
		>
			{subItems && subItems.length > 0 && (
				<ul className="space-y-1.5 border-t border-basalt-border/50 pt-2.5">
					{subItems.map((item) => (
						<li key={item.label} className="flex items-center justify-between gap-3 text-xs">
							<span className="text-basalt-muted-foreground">{item.label}</span>
							<span className="font-medium text-basalt-foreground tabular-nums">
								{typeof item.value === "number" ? formatNumber(item.value) : item.value}
							</span>
						</li>
					))}
				</ul>
			)}
		</BasaltStatCard>
	);
}
