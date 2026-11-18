"use client";

import { ADMIN_LOGO } from "@ellie/shared";
import { VERSION_DISPLAY } from "@ellie/types";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Sidebar as BasaltSidebar,
	Button,
	SidebarBrand,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarIconItem,
	SidebarItem,
	SidebarNav,
	SidebarToggle,
	SidebarUser,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import { useSidebar } from "@nocoo/basalt/components/sidebar";
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
	MemoryStick,
	MessagesSquare,
	Navigation,
	Paperclip,
	Scale,
	Settings,
	ShieldBan,
	ToggleLeft,
	Users,
} from "@nocoo/basalt/icons";
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
	MemoryStick,
	MessagesSquare,
	Navigation,
	Paperclip,
	Scale,
	Settings,
	ShieldBan,
	ToggleLeft,
	Users,
};

function NavLink({ item, pathname }: { item: NavItemDef; pathname: string }) {
	const Icon = ICON_MAP[item.icon] ?? Settings;
	const active = isNavItemActive(pathname, item.href);
	return (
		<SidebarItem asChild active={active}>
			<Link href={item.href} prefetch={false}>
				<Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
				<span className="flex-1 truncate text-left">{item.label}</span>
			</Link>
		</SidebarItem>
	);
}

function NavIconLink({ item, pathname }: { item: NavItemDef; pathname: string }) {
	const Icon = ICON_MAP[item.icon] ?? Settings;
	const active = isNavItemActive(pathname, item.href);
	return (
		<Tooltip delayDuration={0}>
			<TooltipTrigger asChild>
				<SidebarIconItem asChild active={active} aria-label={item.label}>
					<Link href={item.href} prefetch={false}>
						<Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
					</Link>
				</SidebarIconItem>
			</TooltipTrigger>
			<TooltipContent side="right" sideOffset={8}>
				{item.label}
			</TooltipContent>
		</Tooltip>
	);
}

export function Sidebar({
	mobile = false,
	onDismiss,
}: {
	mobile?: boolean;
	onDismiss?: () => void;
}) {
	const pathname = usePathname();
	const { data: session } = useSession();
	const { collapsed, peek, peeking } = useSidebar();
	const railCollapsed = collapsed && !(peek && peeking);
	const userName = session?.user?.name ?? "用户";
	const handleSignOut = () => signOut({ callbackUrl: "/login" });
	const avatar = (
		<Avatar>
			{session?.user?.image && <AvatarImage src={session.user.image} alt={userName} />}
			<AvatarFallback>{userName[0] ?? "?"}</AvatarFallback>
		</Avatar>
	);
	return (
		<BasaltSidebar resizable={!mobile}>
			<SidebarHeader>
				<SidebarBrand
					logo={
						<img
							src={ADMIN_LOGO.src}
							srcSet={ADMIN_LOGO.srcSet}
							sizes="24px"
							alt="Ellie"
							width={24}
							height={24}
						/>
					}
					name="Ellie"
					version={<span className="font-mono">{VERSION_DISPLAY}</span>}
					action={
						mobile ? (
							<SidebarToggle mode="dismiss" onDismiss={onDismiss} dismissLabel="关闭导航" />
						) : (
							<SidebarToggle expandLabel="展开侧栏" collapseLabel="收起侧栏" />
						)
					}
				/>
			</SidebarHeader>
			<SidebarNav aria-label="管理后台" className="pt-1">
				{railCollapsed
					? NAV_GROUPS.flatMap((group) => group.items).map((item) => (
							<NavIconLink key={item.href} item={item} pathname={pathname} />
						))
					: NAV_GROUPS.map((group) => (
							<SidebarGroup
								key={group.label}
								label={group.label}
								defaultOpen={group.defaultOpen ?? true}
							>
								{group.items.map((item) => (
									<NavLink key={item.href} item={item} pathname={pathname} />
								))}
							</SidebarGroup>
						))}
			</SidebarNav>
			<SidebarFooter>
				<SidebarUser
					name={userName}
					email={session?.user?.email ?? ""}
					avatar={avatar}
					{...(mobile
						? {
								// The native onSignOut control opens a focus tooltip, which would
								// swallow the first Escape in the drawer instead of closing it.
								action: (
									<Button
										variant="ghost"
										size="icon-sm"
										className="shrink-0 text-basalt-muted-foreground hover:text-basalt-foreground"
										aria-label="退出登录"
										onClick={handleSignOut}
									>
										<LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
									</Button>
								),
							}
						: {
								signOutLabel: "退出登录",
								onSignOut: handleSignOut,
							})}
				/>
			</SidebarFooter>
		</BasaltSidebar>
	);
}
