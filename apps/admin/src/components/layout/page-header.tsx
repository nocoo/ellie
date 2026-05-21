import { cn } from "@ellie/ui";
import type { ReactNode } from "react";

interface PageHeaderProps {
	title: ReactNode;
	subtitle?: ReactNode;
	/** Optional slot displayed on the right of the heading row — e.g. a primary action button. */
	action?: ReactNode;
	className?: string;
}

/**
 * Standard admin page heading: large display title, optional subtitle, optional
 * right-aligned action slot. Mirrors the pew dashboard's page-heading pattern.
 *
 * Using this in place of ad-hoc `<h1>` blocks keeps typography (font-display,
 * tracking, responsive size) consistent across the 12 top-level admin pages.
 */
export function PageHeader({ title, subtitle, action, className }: PageHeaderProps) {
	return (
		<header
			className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}
		>
			<div>
				<h1 className="font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
					{title}
				</h1>
				{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
			</div>
			{action && <div className="shrink-0">{action}</div>}
		</header>
	);
}
