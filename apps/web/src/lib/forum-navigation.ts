/**
 * Navigation configuration for the forum frontend.
 *
 * Pure data — no React dependency.
 * Imported by ForumNavbar and tests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumNavItem {
	href: string;
	label: string;
}

// ---------------------------------------------------------------------------
// Navigation items
// ---------------------------------------------------------------------------

export const FORUM_NAV_ITEMS: ForumNavItem[] = [
	{ href: "/", label: "首页" },
	{ href: "/digest", label: "精华" },
	{ href: "/search", label: "搜索" },
];

// ---------------------------------------------------------------------------
// Breadcrumb helpers
// ---------------------------------------------------------------------------

export const FORUM_ROUTE_LABELS: Record<string, string> = {
	forums: "版块",
	threads: "帖子",
	users: "用户",
	digest: "精华",
	search: "搜索",
};

/**
 * Build breadcrumb items from the current pathname.
 * Dynamic segments (numeric IDs) are rendered as plain text
 * with a placeholder label — pages should override via context.
 */
export function forumBreadcrumbsFromPathname(pathname: string) {
	const segments = pathname.split("/").filter(Boolean);
	const items: { label: string; href?: string }[] = [{ label: "首页", href: "/" }];

	if (segments.length === 0) return items;

	let href = "";
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i] as string;
		href += `/${seg}`;
		const isLast = i === segments.length - 1;
		const isNumericId = /^\d+$/.test(seg);
		const label = isNumericId ? "..." : (FORUM_ROUTE_LABELS[seg] ?? seg);
		items.push(isLast ? { label } : { label, href });
	}

	return items;
}
