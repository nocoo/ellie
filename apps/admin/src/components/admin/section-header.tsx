// Compact section header for grouping cards within an admin page.
//
// Pattern borrowed from ../pew DashboardSegment
// (`packages/web/src/components/dashboard/dashboard-segment.tsx`):
//   - A small uppercase muted label (h2)
//   - A hairline divider that fills the row
//   - Optional right-side `action` slot (e.g. period selector, refresh)
//   - Optional description line below
//
// Use this above a `Card` (or any panel) to give the page a consistent
// section rhythm without inflating the existing `CardHeader/CardTitle`
// height. Kept local to the admin app on purpose — packages/ui stays
// untouched per the C3 scope guard.
//
// This is presentation only: no state, no client-only APIs, so it can
// safely render on the server.

import { cn } from "@ellie/ui/utils";

export interface SectionHeaderProps {
	/** Short, sentence-case label rendered as the h2. Required. */
	title: string;
	/** Optional one-line description rendered under the title row. */
	description?: React.ReactNode;
	/** Optional right-aligned slot (button, selector, badge...). */
	action?: React.ReactNode;
	className?: string;
}

export function SectionHeader({
	title,
	description,
	action,
	className,
}: SectionHeaderProps): React.JSX.Element {
	return (
		<header className={cn("space-y-1", className)}>
			<div className="flex items-center gap-3">
				<h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
					{title}
				</h2>
				<div className="h-px flex-1 bg-border/60" aria-hidden="true" />
				{action && <div className="flex shrink-0 items-center">{action}</div>}
			</div>
			{description && <p className="text-xs text-muted-foreground">{description}</p>}
		</header>
	);
}
