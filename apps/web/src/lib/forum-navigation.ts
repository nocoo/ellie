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
