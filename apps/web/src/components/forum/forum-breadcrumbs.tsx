// components/forum/forum-breadcrumbs.tsx — Forum breadcrumb bar
// Ref: 04d §Breadcrumbs — Home > Group > Forum > Thread

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
		<div className="h-10 flex items-center bg-background px-4">
			<div className="mx-auto w-full max-w-[1200px]">
				<Breadcrumbs items={items} />
			</div>
		</div>
	);
}
