import { formatNumber } from "@ellie/shared";
import { LayerCard } from "@nocoo/basalt";
import type { LucideIcon } from "lucide-react";

interface AdminMetric {
	label: string;
	value: string | number;
	icon: LucideIcon;
	hint?: string;
}

export function AdminMetrics({
	items,
	label = "本页概览",
}: {
	items: AdminMetric[];
	label?: string;
}) {
	return (
		<LayerCard padding="none">
			<dl aria-label={label} className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 lg:grid-cols-4">
				{items.map(({ label: title, value, icon: Icon, hint }) => (
					<div key={title} className="min-w-0">
						<dt className="flex items-center gap-1.5 text-xs text-basalt-muted-foreground">
							<Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
							{title}
						</dt>
						<dd className="mt-1 font-display text-xl font-semibold tracking-tight tabular-nums">
							{typeof value === "number" ? formatNumber(value) : value}
						</dd>
						{hint && <dd className="mt-0.5 text-xs text-basalt-muted-foreground">{hint}</dd>}
					</div>
				))}
			</dl>
		</LayerCard>
	);
}
