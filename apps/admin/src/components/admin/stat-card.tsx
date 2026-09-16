import { formatNumber } from "@ellie/shared";
import { LayerCard } from "@nocoo/basalt";
import { StatCard as BasaltStatCard } from "@nocoo/basalt/charts/stat-card";
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
		<LayerCard padding="none" className="p-4 md:p-5">
			<BasaltStatCard
				label={label}
				value={formattedValue}
				subtitle={hint}
				ariaLabel={`${label} ${formattedValue}`}
				className="border-0 bg-transparent p-0"
				action={
					Icon ? (
						<Icon className="h-5 w-5 text-basalt-muted-foreground" strokeWidth={1.5} />
					) : undefined
				}
				status={
					tone ? (
						<span
							className={`text-xl font-semibold tabular-nums ${tone === "success" ? "text-basalt-badge-green-foreground" : "text-basalt-destructive"}`}
						>
							{formattedValue}
						</span>
					) : undefined
				}
			>
				{subItems && subItems.length > 0 && (
					<ul className="mt-3 space-y-1 border-t border-border/50 pt-3">
						{subItems.map((item) => (
							<li key={item.label} className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">{item.label}</span>
								<span className="font-medium text-foreground tabular-nums">
									{typeof item.value === "number" ? formatNumber(item.value) : item.value}
								</span>
							</li>
						))}
					</ul>
				)}
			</BasaltStatCard>
		</LayerCard>
	);
}
