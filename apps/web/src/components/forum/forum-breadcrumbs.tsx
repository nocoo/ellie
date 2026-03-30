// components/forum/forum-breadcrumbs.tsx — Inline forum breadcrumbs
// Ref: 04f §3 — removed dedicated h-10 bar, now inline within content container

"use client";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { forumBreadcrumbsFromPathname } from "@/lib/forum-navigation";
import { usePathname } from "next/navigation";

export function ForumBreadcrumbs() {
	const pathname = usePathname();
	const items = forumBreadcrumbsFromPathname(pathname);

	// Don't render breadcrumbs on the homepage (only "首页" entry)
	if (items.length <= 1) return null;

	return (
		<div className="py-2">
			<Breadcrumbs items={items} />
		</div>
	);
}
