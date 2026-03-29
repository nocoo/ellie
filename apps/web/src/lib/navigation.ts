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
		label: "Overview",
		defaultOpen: true,
		items: [{ href: "/admin", label: "Dashboard", icon: "LayoutDashboard" }],
	},
	{
		label: "Content Management",
		defaultOpen: true,
		items: [
			{ href: "/admin/users", label: "Users", icon: "Users" },
			{ href: "/admin/threads", label: "Threads", icon: "FileText" },
			{ href: "/admin/forums", label: "Forums", icon: "MessagesSquare" },
			{ href: "/admin/attachments", label: "Attachments", icon: "Paperclip" },
		],
	},
	{
		label: "Security",
		defaultOpen: true,
		items: [
			{ href: "/admin/ip-bans", label: "IP Bans", icon: "ShieldBan" },
			{ href: "/admin/censor-words", label: "Censor Words", icon: "Filter" },
		],
	},
];

// ---------------------------------------------------------------------------
// Route labels (used for breadcrumbs in app-shell)
// ---------------------------------------------------------------------------

export const ROUTE_LABELS: Record<string, string> = {
	admin: "Dashboard",
	users: "Users",
	threads: "Threads",
	posts: "Posts",
	forums: "Forums",
	attachments: "Attachments",
	"ip-bans": "IP Bans",
	"censor-words": "Censor Words",
};

/**
 * Segments that act as non-navigable group prefixes.
 * They appear in breadcrumbs as plain text (no link) even when
 * they are not the last segment.
 */
const NON_NAVIGABLE_SEGMENTS = new Set(["admin"]);

export function breadcrumbsFromPathname(pathname: string) {
	const segments = pathname.split("/").filter(Boolean);
	const items: { label: string; href?: string }[] = [{ label: "Home", href: "/admin" }];

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
