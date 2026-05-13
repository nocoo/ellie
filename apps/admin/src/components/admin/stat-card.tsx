import { formatNumber } from "@ellie/shared";
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatCard({ label, value, icon: Icon, subItems }: StatCardProps) {
	return (
		<div className="rounded-[var(--radius-card,14px)] bg-secondary p-4 md:p-5">
			<div className="flex items-start justify-between">
				<div className="space-y-1">
					<p className="text-xs md:text-sm text-muted-foreground">{label}</p>
					<p className="text-2xl md:text-3xl font-semibold text-foreground font-display tracking-tight tabular-nums">
						{typeof value === "number" ? formatNumber(value) : value}
					</p>
				</div>
				{Icon && (
					<div className="rounded-md bg-background p-2">
						<Icon className="h-5 w-5" strokeWidth={1.5} />
					</div>
				)}
			</div>
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
		</div>
	);
}
