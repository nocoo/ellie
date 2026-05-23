// components/forum/breadcrumb-bar.tsx — Conditional breadcrumb wrapper
// Renders breadcrumbs only when items.length > 1 (single "home" crumb is hidden).

import { type BreadcrumbItem, Breadcrumbs } from "@/components/layout/breadcrumbs";

interface BreadcrumbBarProps {
	items: BreadcrumbItem[];
	/**
	 * Passes through to <Breadcrumbs/>. Default "none" keeps every segment
	 * visible. Set to "hide-intermediate" on thread detail (and any other
	 * page with a long forum-ancestor chain) to collapse intermediate
	 * forum links on mobile while keeping desktop intact.
	 */
	mobileCompact?: "none" | "hide-intermediate";
}

export function BreadcrumbBar({ items, mobileCompact = "none" }: BreadcrumbBarProps) {
	if (items.length <= 1) return null;
	return (
		<div className="py-2">
			<Breadcrumbs items={items} mobileCompact={mobileCompact} />
		</div>
	);
}
