/**
 * Navigation configuration for the admin console.
 *
 * Pure data — no React dependency.
 * Imported by sidebar.tsx (adds icons) and tests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavItemDef {
	href: string;
	label: string;
	/** Lucide icon name for lookup in sidebar.tsx */
	icon: string;
}

export interface NavGroupDef {
	label: string;
	items: NavItemDef[];
	defaultOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Navigation groups
// ---------------------------------------------------------------------------

export const NAV_GROUPS: NavGroupDef[] = [
	{
		label: "概览",
		defaultOpen: true,
		items: [{ href: "/admin", label: "仪表盘", icon: "LayoutDashboard" }],
	},
	{
		label: "内容管理",
		defaultOpen: true,
		items: [
			{ href: "/admin/users", label: "用户", icon: "Users" },
			{ href: "/admin/threads", label: "主题", icon: "FileText" },
			{ href: "/admin/forums", label: "版块", icon: "MessagesSquare" },
			{ href: "/admin/attachments", label: "附件", icon: "Paperclip" },
		],
	},
	{
		label: "数据统计",
		defaultOpen: true,
		items: [
			// Admin analytics dashboard (P2). Query-only against business
			// tables, KV-cached at 60s / 5min; see worker
			// `handlers/admin/analytics.ts`.
			{ href: "/admin/analytics", label: "数据分析", icon: "BarChart3" },
			// `/admin/statistics/recalc` (was `/admin/statistics`). Moved out of
			// the grouping segment so the sidebar prefix match (`/admin/statistics`)
			// no longer double-highlights when the user is on the KV monitor page.
			// Old path keeps a redirect for bookmarks (see app/.../statistics/page.tsx).
			{ href: "/admin/statistics/recalc", label: "统计计算", icon: "Calculator" },
			{ href: "/admin/statistics/kv", label: "KV 缓存监控", icon: "Database" },
		],
	},
	{
		label: "安全管理",
		defaultOpen: true,
		items: [
			{ href: "/admin/reports", label: "举报管理", icon: "Flag" },
			{ href: "/admin/ip-bans", label: "IP 封禁", icon: "ShieldBan" },
			{ href: "/admin/censor-words", label: "敏感词", icon: "Filter" },
		],
	},
	{
		label: "日志",
		defaultOpen: true,
		items: [{ href: "/admin/logs/operations", label: "操作日志", icon: "FileText" }],
	},
	{
		label: "设置",
		items: [
			{ href: "/admin/settings/general", label: "通用设置", icon: "Settings" },
			{ href: "/admin/settings/features", label: "功能设置", icon: "ToggleLeft" },
			{ href: "/admin/settings/nav-links", label: "顶部导航", icon: "Navigation" },
			{ href: "/admin/settings/friend-links", label: "友情链接", icon: "Link" },
		],
	},
];

// ---------------------------------------------------------------------------
// Route labels (used for breadcrumbs in app-shell)
// ---------------------------------------------------------------------------

export const ROUTE_LABELS: Record<string, string> = {
	admin: "仪表盘",
	users: "用户",
	threads: "主题",
	posts: "帖子",
	forums: "版块",
	attachments: "附件",
	analytics: "数据分析",
	statistics: "数据统计",
	recalc: "统计计算",
	kv: "KV 缓存监控",
	reports: "举报管理",
	"ip-bans": "IP 封禁",
	"censor-words": "敏感词",
	logs: "日志",
	operations: "操作日志",
	settings: "设置",
	general: "通用设置",
	features: "功能设置",
	"nav-links": "顶部导航",
	"friend-links": "友情链接",
};

/**
 * Segments that act as non-navigable group prefixes.
 * They appear in breadcrumbs as plain text (no link) even when
 * they are not the last segment.
 *
 * `statistics` is non-navigable because the segment is a grouping label
 * ("数据统计"); the actual landing pages are `recalc` / `kv` underneath.
 * The redirect from `/admin/statistics` is a compatibility shim, not a
 * place we want to surface as a breadcrumb link.
 */
const NON_NAVIGABLE_SEGMENTS = new Set(["admin", "statistics"]);

/**
 * Decides whether a sidebar nav item should render in its active state for
 * the current pathname. Pulled out as a pure function (no React) so the
 * matching rule can be unit-tested in isolation and reused by both the
 * expanded and collapsed sidebar variants.
 *
 * Rule: a nav item matches when the current pathname IS the item's href, OR
 * when the pathname starts with `${href}/`. The trailing slash is the key
 * detail — without it, `/admin/foo` would also match `/admin/foo-bar`, and
 * `/admin/statistics` would match `/admin/statistics/kv` (the original
 * double-highlight bug).
 *
 * `/admin` itself stays exact-match only because every other admin route is
 * underneath it; treating it as a prefix would highlight 仪表盘 on every page.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
	if (href === "/admin") return pathname === "/admin";
	if (pathname === href) return true;
	return pathname.startsWith(`${href}/`);
}

export function breadcrumbsFromPathname(pathname: string) {
	const segments = pathname.split("/").filter(Boolean);
	const items: { label: string; href?: string }[] = [{ label: "首页", href: "/admin" }];

	let href = "";
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i] as string;
		href += `/${seg}`;
		const isLast = i === segments.length - 1;
		const label = ROUTE_LABELS[seg] ?? seg.slice(0, 8);
		const nonNavigable = NON_NAVIGABLE_SEGMENTS.has(seg);
		items.push(isLast || nonNavigable ? { label } : { label, href });
	}

	return items;
}
