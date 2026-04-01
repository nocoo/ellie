// components/forum/forum-header.tsx — Forum header
// Structure: TopBar → NavBar → SearchStatsBar

"use client";

import { ForumLogo } from "@/components/forum/forum-logo";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserPopover } from "@/components/forum/user-popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { HeaderViewModel } from "@/viewmodels/forum/header";
import { formatNumber } from "@/viewmodels/shared/formatting";
import { LogOut, Mail, Search } from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ForumHeaderProps {
	vm: HeaderViewModel;
}

// ---------------------------------------------------------------------------
// Layer 1: Top bar — Logo (left) + user info/links + avatar (right)
// ---------------------------------------------------------------------------

function TopBar({ vm }: { vm: HeaderViewModel }) {
	const user = vm.user;

	return (
		<div className="bg-dz-topbar-bg">
			<div className="width-container flex items-center justify-between !py-0 h-[90px]">
				{/* Left: Logo */}
				<Link href="/" className="flex-shrink-0">
					<ForumLogo height={70} />
				</Link>

				{/* Right: User info area */}
				{user ? (
					<div className="flex items-center gap-4">
						{/* Meta: username, group, uid, credits */}
						<div className="text-right space-y-0.5">
							<div className="flex items-center justify-end gap-2">
								<UserPopover
									userId={user.uid}
									viewerRole={user.role}
									viewerUserId={user.uid}
									side="bottom"
									align="end"
								>
									<span className="text-sm font-medium text-foreground hover:text-primary transition-colors cursor-pointer">
										{user.username}
									</span>
								</UserPopover>
								<span className="text-xs text-muted-foreground">UID: {user.uid}</span>
							</div>
							<div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
								<span>{user.groupTitle}</span>
								<span>积分 {user.credits}</span>
							</div>
						</div>

						{/* Avatar */}
						<UserPopover
							userId={user.uid}
							viewerRole={user.role}
							viewerUserId={user.uid}
							side="bottom"
							align="end"
						>
							<UserAvatar
								src={getAvatarUrl(user.uid, "middle")}
								alt={user.username}
								className="h-10 w-10 rounded-sm cursor-pointer"
							/>
						</UserPopover>

						{/* Action icons */}
						<div className="flex items-center gap-1">
							<ThemeToggle />
							<Link
								href="/messages"
								className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								title="站内信"
							>
								<Mail className="h-4 w-4" />
							</Link>
							<button
								type="button"
								onClick={() => signOut({ callbackUrl: "/" })}
								className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								title="退出登录"
							>
								<LogOut className="h-4 w-4" />
							</button>
						</div>
					</div>
				) : (
					<div className="flex items-center gap-3 text-sm">
						<ThemeToggle />
						<Link
							href="/login"
							className="font-medium text-primary hover:text-primary/80 transition-colors"
						>
							登录
						</Link>
						<span className="text-border">|</span>
						<Link
							href="/login"
							className="text-muted-foreground hover:text-foreground transition-colors"
						>
							注册
						</Link>
					</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 2: Navigation bar — blue gradient with blueprint grid
// ---------------------------------------------------------------------------

function NavBar({ vm }: { vm: HeaderViewModel }) {
	const pathname = usePathname();

	return (
		<div className="nav-gradient">
			<div className="width-container flex items-center !py-0 h-[40px]">
				{vm.navTabs.map((tab) => {
					const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

					return (
						<Link
							key={tab.href}
							href={tab.href}
							className={cn(
								"h-full flex items-center px-4 text-sm font-bold text-dz-nav-text transition-colors hover:bg-white/10",
								isActive && "bg-white/10",
							)}
						>
							{tab.label}
						</Link>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 3: Search + Stats bar (combined)
// ---------------------------------------------------------------------------

function SearchStatsBar({ vm }: { vm: HeaderViewModel }) {
	const s = vm.stats;

	return (
		<div className="bg-dz-topbar-bg">
			<div className="width-container flex items-center justify-between !py-2 h-[44px]">
				{/* Left: Modern search input with / shortcut */}
				<div className="relative w-[320px]">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						placeholder="搜索帖子、用户..."
						className="h-8 w-full rounded-lg border border-input bg-transparent pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								// TODO: implement search navigation
							}
						}}
						ref={(el) => {
							if (!el) return;
							const handler = (e: KeyboardEvent) => {
								if (
									e.key === "/" &&
									document.activeElement?.tagName !== "INPUT" &&
									document.activeElement?.tagName !== "TEXTAREA"
								) {
									e.preventDefault();
									el.focus();
								}
							};
							// Attach once — stored on element to avoid duplicates
							if (!(el as unknown as Record<string, boolean>).__slashBound) {
								(el as unknown as Record<string, boolean>).__slashBound = true;
								document.addEventListener("keydown", handler);
							}
						}}
					/>
					<kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 flex h-5 items-center rounded border border-border bg-muted px-1.5 text-2xs font-medium text-muted-foreground">
						/
					</kbd>
				</div>

				{/* Right: Stats — numbers only */}
				<div className="flex items-center gap-0 text-xs text-muted-foreground">
					<span>今日: </span>
					<span className="font-bold text-foreground">{formatNumber(s.todayPosts)}</span>
					<StatSep />
					<span>昨日: </span>
					<span className="font-bold text-foreground">{formatNumber(s.yesterdayPosts)}</span>
					<StatSep />
					<span>帖子: </span>
					<span className="font-bold text-foreground">{formatNumber(s.totalThreads)}</span>
					<StatSep />
					<span>会员: </span>
					<span className="font-bold text-foreground">{formatNumber(s.totalMembers)}</span>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Utility sub-components
// ---------------------------------------------------------------------------

function StatSep() {
	return <span className="mx-1.5 text-border select-none">|</span>;
}

// ---------------------------------------------------------------------------
// Main export: ForumHeader
// ---------------------------------------------------------------------------

export function ForumHeader({ vm }: ForumHeaderProps) {
	return (
		<header>
			<TopBar vm={vm} />
			<NavBar vm={vm} />
			<SearchStatsBar vm={vm} />
		</header>
	);
}
