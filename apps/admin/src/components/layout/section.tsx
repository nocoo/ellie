import { cn } from "@ellie/ui";
import type { ReactNode } from "react";

interface SectionProps {
	title: string;
	children: ReactNode;
	/** Optional slot displayed on the right of the section header — e.g. a range selector. */
	action?: ReactNode;
	className?: string;
}

/**
 * Lightweight section divider: small uppercase label + hairline separator + optional
 * action slot, followed by children. Mirrors the pew dashboard's `DashboardSegment`.
 *
 * Provides no surface of its own — children carry their own card / tile styling.
 * Use this to group related blocks on an admin page without nesting them in yet
 * another bordered container.
 */
export function Section({ title, action, children, className }: SectionProps) {
	return (
		<section className={cn("space-y-3 md:space-y-4", className)}>
			<div className="flex items-center gap-3">
				<h2 className="shrink-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					{title}
				</h2>
				<div className="h-px flex-1 bg-border/60" />
				{action && <div className="shrink-0">{action}</div>}
			</div>
			{children}
		</section>
	);
}
