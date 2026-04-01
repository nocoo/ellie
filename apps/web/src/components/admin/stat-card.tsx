import { formatNumber } from "@/viewmodels/shared/formatting";
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
		<div className="rounded-xl border bg-card p-5">
			<div className="flex items-center justify-between">
				<p className="text-sm font-medium text-muted-foreground">{label}</p>
				{Icon && <Icon className="h-4 w-4 text-muted-foreground/60" strokeWidth={1.5} />}
			</div>
			<p className="mt-2 text-2xl font-semibold text-foreground">
				{typeof value === "number" ? formatNumber(value) : value}
			</p>
			{subItems && subItems.length > 0 && (
				<ul className="mt-3 space-y-1 border-t pt-3">
					{subItems.map((item) => (
						<li key={item.label} className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">{item.label}</span>
							<span className="font-medium text-foreground">
								{typeof item.value === "number" ? formatNumber(item.value) : item.value}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
