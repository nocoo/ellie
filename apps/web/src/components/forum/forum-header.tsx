// components/forum/forum-header.tsx — Classic Discuz-style multi-layer forum header
// Layout only — no real data fetching, all numbers are 777 placeholders.
// Structure: TopBar → NavBar → SearchBar → BreadcrumbBar → StatsBar

"use client";

import { UserAvatar } from "@/components/forum/user-avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import {
	type HeaderViewModel,
	buildHeaderViewModel,
} from "@/viewmodels/forum/header";
import { Bell, ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ForumHeaderProps {
	vm?: HeaderViewModel;
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
					<img
						src="https://t.no.mt/static/image/common/logo.png"
						alt="同济网 bbs.tongji.net"
						className="h-[70px] w-auto"
					/>
				</Link>

				{/* Right: User info area */}
				{user ? (
					<div className="flex items-center gap-3">
						{/* User links row */}
						<div className="text-right">
							{/* Top row: user links */}
							<div className="flex items-center justify-end gap-0 text-[13px] flex-wrap">
								<UserLinkIcon className="text-primary" />
								<TopBarLink href={`/users/${user.uid}`} className="font-bold text-primary">
									{user.username}
								</TopBarLink>
								<TopBarSep />
								<TopBarLink href="#">
									我的
									<ChevronDown className="inline h-3 w-3 ml-0.5" />
								</TopBarLink>
								<TopBarSep />
								<TopBarLink href="#">设置</TopBarLink>
								<TopBarSep />
								<TopBarLink href="#">消息</TopBarLink>
								<TopBarSep />
								<span className="inline-flex items-center gap-0.5">
									<Bell className="h-3 w-3 text-dz-reminder-text" />
									<TopBarLink href="#" className="font-bold text-dz-reminder-text">
										提醒({user.reminderCount})
									</TopBarLink>
								</span>
								<TopBarSep className="mx-2" />
								<TopBarLink href="#">门户管理</TopBarLink>
								<TopBarSep />
								<TopBarLink href="#">管理中心</TopBarLink>
								<TopBarSep />
								<TopBarLink href="#">退出</TopBarLink>
							</div>
							{/* Bottom row: credits + group */}
							<div className="flex items-center justify-end gap-3 text-[12px] text-dz-topbar-link mt-1">
								<span>
									积分: {user.credits}
									<ChevronDown className="inline h-3 w-3 ml-0.5" />
								</span>
								<span>
									用户组: {user.groupTitle}
									<ChevronDown className="inline h-3 w-3 ml-0.5" />
								</span>
							</div>
						</div>
						{/* Avatar */}
						<UserAvatar
							src={getAvatarUrl(user.uid, "middle")}
							alt={user.username}
							className="h-[50px] w-[50px] rounded-sm"
						/>
					</div>
				) : (
					<div className="flex items-center gap-2 text-[13px]">
						<Link
							href="/login"
							className="text-primary font-medium hover:underline"
						>
							登录
						</Link>
						<TopBarSep />
						<Link
							href="/login"
							className="text-dz-topbar-link hover:underline"
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
// Layer 2: Navigation bar — blue background with category tabs
// ---------------------------------------------------------------------------

function NavBar({ vm }: { vm: HeaderViewModel }) {
	const pathname = usePathname();

	return (
		<div className="bg-dz-nav-bg">
			<div className="width-container flex items-center justify-between !py-0 h-[40px]">
				{/* Nav tabs */}
				<div className="flex items-center h-full">
					{vm.navTabs.map((tab) => {
						const isActive =
							tab.href === "/"
								? pathname === "/"
								: pathname.startsWith(tab.href);

						return (
							<Link
								key={tab.href}
								href={tab.href}
								className={cn(
									"h-full flex items-center px-4 text-[14px] font-bold text-dz-nav-text transition-colors hover:bg-dz-nav-hover",
									isActive && "bg-dz-nav-hover",
								)}
							>
								{tab.label}
							</Link>
						);
					})}
				</div>

				{/* Quick nav dropdown */}
				<button
					type="button"
					className="flex items-center gap-1 rounded px-3 py-1 text-[13px] text-dz-nav-text bg-dz-nav-hover hover:bg-dz-nav-hover/80 transition-colors"
				>
					快捷导航
					<ChevronDown className="h-3.5 w-3.5" />
				</button>
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
								if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
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
					<kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
						/
					</kbd>
				</div>

				{/* Right: Stats — numbers only */}
				<div className="flex items-center gap-0 text-[12px] text-dz-stats-text">
					<span>今日: </span>
					<span className="font-bold text-foreground">{s.todayPosts}</span>
					<StatSep />
					<span>昨日: </span>
					<span className="font-bold text-foreground">{s.yesterdayPosts}</span>
					<StatSep />
					<span>帖子: </span>
					<span className="font-bold text-foreground">{s.totalThreads}</span>
					<StatSep />
					<span>会员: </span>
					<span className="font-bold text-foreground">{s.totalMembers}</span>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Utility sub-components
// ---------------------------------------------------------------------------

function TopBarLink({
	href,
	className,
	children,
}: {
	href: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<Link
			href={href}
			className={cn(
				"text-dz-topbar-link hover:text-primary transition-colors",
				className,
			)}
		>
			{children}
		</Link>
	);
}

function TopBarSep({ className }: { className?: string }) {
	return (
		<span className={cn("mx-1 text-dz-topbar-separator select-none", className)}>
			|
		</span>
	);
}

function StatSep() {
	return (
		<span className="mx-1.5 text-dz-topbar-separator select-none">|</span>
	);
}

function UserLinkIcon({ className }: { className?: string }) {
	return (
		<svg
			className={cn("h-3.5 w-3.5 mr-1", className)}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<title>User</title>
			<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</svg>
	);
}

// ---------------------------------------------------------------------------
// Main export: ForumHeader
// ---------------------------------------------------------------------------

export function ForumHeader({ vm }: ForumHeaderProps) {
	const viewModel = vm ?? buildHeaderViewModel();

	return (
		<header>
			<TopBar vm={viewModel} />
			<NavBar vm={viewModel} />
			<SearchStatsBar vm={viewModel} />
		</header>
	);
}
