// components/forum/breadcrumb-bar.tsx — Conditional breadcrumb wrapper
// Renders breadcrumbs only when items.length > 1 (single "home" crumb is hidden).

import { type BreadcrumbItem, Breadcrumbs } from "@/components/layout/breadcrumbs";

interface BreadcrumbBarProps {
	items: BreadcrumbItem[];
}

export function BreadcrumbBar({ items }: BreadcrumbBarProps) {
	if (items.length <= 1) return null;
	return (
		<div className="py-2">
			<Breadcrumbs items={items} />
		</div>
	);
}
