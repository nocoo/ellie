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
		items: [{ href: "/admin/statistics", label: "统计计算", icon: "Calculator" }],
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
	statistics: "统计计算",
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
 */
const NON_NAVIGABLE_SEGMENTS = new Set(["admin"]);

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
