// components/forum/forum-header.tsx — Forum header
// Structure: TopBar → NavBar → SearchStatsBar

"use client";

import { ForumLogo } from "@/components/forum/forum-logo";
import { UserAvatar } from "@/components/forum/user-avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { HeaderViewModel } from "@/viewmodels/forum/header";
import { LogOut, Mail, Search } from "lucide-react";
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
		<div className="relative z-10">
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
								<Link
									href={`/users/${user.uid}`}
									className="text-sm font-medium text-white/90 hover:text-white transition-colors"
								>
									{user.username}
								</Link>
								<span className="text-xs text-white/60">UID: {user.uid}</span>
							</div>
							<div className="flex items-center justify-end gap-3 text-xs text-white/60">
								<span>{user.groupTitle}</span>
								<span>积分 {user.credits}</span>
							</div>
						</div>

						{/* Avatar */}
						<Link href={`/users/${user.uid}`}>
							<UserAvatar
								src={getAvatarUrl(user.uid, "middle", vm.avatarCdnBase)}
								alt={user.username}
								className="h-10 w-10 rounded-sm"
							/>
						</Link>

						{/* Action icons */}
						<div className="flex items-center gap-1">
							<Link
								href="/messages"
								className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white transition-colors"
								title="站内信"
							>
								<Mail className="h-4 w-4" />
							</Link>
							<button
								type="button"
								className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white transition-colors"
								title="退出登录"
							>
								<LogOut className="h-4 w-4" />
							</button>
						</div>
					</div>
				) : (
					<div className="flex items-center gap-3 text-sm">
						<Link
							href="/login"
							className="font-medium text-white hover:text-white/80 transition-colors"
						>
							登录
						</Link>
						<span className="text-white/40">|</span>
						<Link
							href="/login"
							className="text-white/70 hover:text-white transition-colors"
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
// Layer 2: Navigation bar — modern blue gradient
// ---------------------------------------------------------------------------

function NavBar({ vm }: { vm: HeaderViewModel }) {
	const pathname = usePathname();

	return (
		<div className="relative z-10 border-t border-white/10">
			<div className="width-container flex items-center !py-0 h-[40px]">
				{vm.navTabs.map((tab) => {
					const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

					return (
						<Link
							key={tab.href}
							href={tab.href}
							className={cn(
								"h-full flex items-center px-4 text-[14px] font-bold text-dz-nav-text transition-colors hover:bg-white/10",
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
		<div className="relative z-10">
			<div className="width-container flex items-center justify-between !py-2 h-[44px]">
				{/* Left: Modern search input with / shortcut */}
				<div className="relative w-[320px]">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
					<input
						type="search"
						placeholder="搜索帖子、用户..."
						className="h-8 w-full rounded-lg border border-white/20 bg-white/10 pl-9 pr-10 text-sm text-white placeholder:text-white/50 outline-none transition-colors focus-visible:border-white/40 focus-visible:ring-3 focus-visible:ring-white/20"
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
					<kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 flex h-5 items-center rounded border border-white/20 bg-white/10 px-1.5 text-[10px] font-medium text-white/50">
						/
					</kbd>
				</div>

				{/* Right: Stats — numbers only */}
				<div className="flex items-center gap-0 text-[12px] text-white/60">
					<span>今日: </span>
					<span className="font-bold text-white/90">{s.todayPosts}</span>
					<StatSep />
					<span>昨日: </span>
					<span className="font-bold text-white/90">{s.yesterdayPosts}</span>
					<StatSep />
					<span>帖子: </span>
					<span className="font-bold text-white/90">{s.totalThreads}</span>
					<StatSep />
					<span>会员: </span>
					<span className="font-bold text-white/90">{s.totalMembers}</span>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Utility sub-components
// ---------------------------------------------------------------------------

function StatSep() {
	return <span className="mx-1.5 text-white/30 select-none">|</span>;
}

// ---------------------------------------------------------------------------
// Main export: ForumHeader
// ---------------------------------------------------------------------------

export function ForumHeader({ vm }: ForumHeaderProps) {
	return (
		<header className="nav-gradient">
			<TopBar vm={vm} />
			<NavBar vm={vm} />
			<SearchStatsBar vm={vm} />
		</header>
	);
}
