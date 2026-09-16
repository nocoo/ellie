"use client";

import { VERSION_DISPLAY } from "@ellie/types";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Badge,
	Sidebar as BasaltSidebar,
	Button,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarNav,
	SidebarUser,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import {
	BarChart3,
	Calculator,
	Clock,
	Database,
	FileText,
	Filter,
	Flag,
	LayoutDashboard,
	Link as LinkIcon,
	LogOut,
	MessagesSquare,
	Navigation,
	PanelLeft,
	Paperclip,
	Scale,
	Settings,
	ShieldBan,
	ToggleLeft,
	Users,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { ElementType } from "react";
import { isNavItemActive, NAV_GROUPS, type NavItemDef } from "@/lib/navigation";

const ICON_MAP: Record<string, ElementType> = {
	BarChart3,
	Calculator,
	Clock,
	Database,
	FileText,
	Filter,
	Flag,
	LayoutDashboard,
	Link: LinkIcon,
	MessagesSquare,
	Navigation,
	Paperclip,
	Scale,
	Settings,
	ShieldBan,
	ToggleLeft,
	Users,
};

function NavLink({
	item,
	pathname,
	collapsed,
}: {
	item: NavItemDef;
	pathname: string;
	collapsed: boolean;
}) {
	const Icon = ICON_MAP[item.icon] ?? Settings;
	const active = isNavItemActive(pathname, item.href);
	const link = (
		<Button
			asChild
			variant="ghost"
			size={collapsed ? "icon" : "default"}
			className={[
				collapsed
					? "h-10 w-10 self-center shrink-0"
					: "h-auto w-full justify-start gap-3 px-3 py-2.5 font-normal",
				active ? "bg-basalt-accent text-basalt-foreground" : "text-basalt-muted-foreground",
			].join(" ")}
		>
			<Link href={item.href} aria-current={active ? "page" : undefined} aria-label={item.label}>
				<Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
				{!collapsed && <span className="truncate">{item.label}</span>}
			</Link>
		</Button>
	);
	return collapsed ? (
		<Tooltip>
			<TooltipTrigger asChild>{link}</TooltipTrigger>
			<TooltipContent side="right" sideOffset={8}>
				{item.label}
			</TooltipContent>
		</Tooltip>
	) : (
		link
	);
}

export function Sidebar({
	collapsed,
	onToggle,
	mobile = false,
}: {
	collapsed: boolean;
	onToggle: () => void;
	mobile?: boolean;
}) {
	const pathname = usePathname();
	const { data: session } = useSession();
	const userName = session?.user?.name ?? "用户";
	const toggleLabel = mobile ? "关闭导航" : collapsed ? "展开侧栏" : "收起侧栏";
	const ToggleIcon = mobile ? X : PanelLeft;
	const avatar = (
		<Avatar className="h-9 w-9 shrink-0">
			{session?.user?.image && <AvatarImage src={session.user.image} alt={userName} />}
			<AvatarFallback>{userName[0] ?? "?"}</AvatarFallback>
		</Avatar>
	);
	const signOutButton = (
		<Button
			variant="ghost"
			size="icon"
			aria-label="退出登录"
			onClick={() => signOut({ callbackUrl: "/login" })}
		>
			<LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
		</Button>
	);
	return (
		<BasaltSidebar collapsed={collapsed} className={mobile ? "h-full" : undefined}>
			<SidebarHeader className="gap-3 pl-[22px] pr-3">
				<img src="/logo-24.png" alt="Ellie" width={24} height={24} className="shrink-0" />
				{!collapsed && (
					<>
						<span className="text-base font-semibold">Ellie</span>
						<Badge variant="secondary" className="text-[10px]">
							{VERSION_DISPLAY}
						</Badge>
						<Button
							variant="ghost"
							size="icon"
							className="ml-auto h-7 w-7 shrink-0"
							onClick={onToggle}
							aria-label={toggleLabel}
						>
							<ToggleIcon aria-hidden="true" strokeWidth={1.5} />
						</Button>
					</>
				)}
			</SidebarHeader>
			{collapsed && (
				<Button
					variant="ghost"
					size="icon"
					className="mb-2 self-center"
					onClick={onToggle}
					aria-label={toggleLabel}
				>
					<PanelLeft aria-hidden="true" strokeWidth={1.5} />
				</Button>
			)}
			<SidebarNav aria-label="管理后台" className={collapsed ? "gap-1 pt-1" : "pt-1"}>
				{collapsed
					? NAV_GROUPS.flatMap((group) => group.items).map((item) => (
							<NavLink key={item.href} item={item} pathname={pathname} collapsed />
						))
					: NAV_GROUPS.map((group) => (
							<SidebarGroup
								key={group.label}
								label={group.label}
								defaultOpen={group.defaultOpen ?? true}
							>
								{group.items.map((item) => (
									<NavLink key={item.href} item={item} pathname={pathname} collapsed={false} />
								))}
							</SidebarGroup>
						))}
			</SidebarNav>
			<SidebarFooter className={collapsed ? "flex justify-center px-0" : undefined}>
				{collapsed ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label={`${userName} · 退出登录`}
								onClick={() => signOut({ callbackUrl: "/login" })}
							>
								{avatar}
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">{userName} · 点击退出登录</TooltipContent>
					</Tooltip>
				) : (
					<SidebarUser
						name={userName}
						email={session?.user?.email ?? ""}
						avatar={avatar}
						action={signOutButton}
					/>
				)}
			</SidebarFooter>
		</BasaltSidebar>
	);
}
