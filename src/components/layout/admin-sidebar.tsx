// components/layout/admin-sidebar.tsx — Admin sidebar navigation
// Ref: 04c §AdminLayout — Brand + Navigation + User info

"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import {
	ChevronLeft,
	FileText,
	LayoutDashboard,
	MessageSquare,
	Settings,
	Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "../ui/button";

export interface AdminSidebarProps {
	collapsed: boolean;
	onToggle(): void;
	/** Current user info for the bottom section */
	user?: { username: string; avatar?: string | null };
}

interface NavItem {
	href: string;
	label: string;
	icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
	{ href: "/admin", label: "Dashboard", icon: LayoutDashboard },
	{ href: "/admin/users", label: "Users", icon: Users },
	{ href: "/admin/content", label: "Content", icon: MessageSquare },
	{ href: "/admin/forums", label: "Forums", icon: FileText },
	{ href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminSidebar({ collapsed, onToggle, user }: AdminSidebarProps) {
	const pathname = usePathname();

	return (
		<aside
			className={cn(
				"flex h-full flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
				collapsed ? "w-[68px]" : "w-[260px]",
			)}
		>
			{/* Brand */}
			<div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
				{!collapsed && (
					<span className="text-lg font-semibold text-sidebar-foreground">Ellie Admin</span>
				)}
				<Button
					variant="ghost"
					size="icon"
					onClick={onToggle}
					className={cn("ml-auto text-sidebar-foreground", collapsed && "mx-auto")}
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
				>
					<ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
				</Button>
			</div>

			{/* Navigation */}
			<nav className="flex-1 space-y-1 p-2">
				{NAV_ITEMS.map((item) => {
					const active =
						pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
					return (
						<Link
							key={item.href}
							href={item.href}
							className={cn(
								"flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
								active
									? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
									: "text-sidebar-foreground hover:bg-sidebar-accent/50",
								collapsed && "justify-center px-2",
							)}
						>
							<item.icon className="h-5 w-5 shrink-0" />
							{!collapsed && <span>{item.label}</span>}
						</Link>
					);
				})}
			</nav>

			{/* Footer: User + Theme */}
			<div className="border-t border-sidebar-border p-3">
				<div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
					{user && (
						<>
							<UserAvatar avatar={user.avatar} username={user.username} size="sm" />
							{!collapsed && (
								<span className="truncate text-sm text-sidebar-foreground">{user.username}</span>
							)}
						</>
					)}
					{!collapsed && (
						<div className="ml-auto">
							<ThemeToggle />
						</div>
					)}
				</div>
			</div>
		</aside>
	);
}

export { NAV_ITEMS };
