// components/forum/forum-header.tsx — Forum header
// Structure: TopBar → NavBar → SearchStatsBar

"use client";

import { ForumLogo } from "@/components/forum/forum-logo";
import { MessageBadgeIcon } from "@/components/forum/message-badge-icon";
import { TrackedUserAvatar } from "@/components/forum/user-avatar";
import { UserPopover } from "@/components/forum/user-popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { WidthToggle } from "@/components/width-toggle";
import { cn } from "@/lib/utils";
import type { HeaderViewModel } from "@/viewmodels/forum/header";
import { formatNumber } from "@/viewmodels/shared/formatting";
import { LogOut, Search } from "lucide-react";
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

	// Mobile (<640px) collapses TopBar from h-[90px] to h-14 to free vertical
	// space on iPhone. The desktop branch is unchanged: logo height stays at
	// 70px and the full UserPopover trigger keeps the username/credits row.
	//
	// On mobile we drop the inline username/UID/credits/coins meta and the
	// width/theme toggles — the popover content already exposes the full
	// user identity once the avatar is tapped. WidthToggle is meaningless on
	// a phone (no horizontal split). ThemeToggle is dropped on mobile too:
	// iOS already follows the system theme and the toggle has no popover
	// override here, so a per-tab manual override is not reachable from the
	// mobile branch (acceptable trade-off — re-add later if there is real
	// demand).
	return (
		<div>
			<div
				className="width-container flex items-center justify-between !py-0 h-14 sm:h-[90px]"
				data-testid="forum-top-bar"
			>
				{/* Left: Logo — min-w-0 so a long user-name slot can't crush the logo on phones */}
				<Link href="/" className="flex-shrink-0 min-w-0">
					{/* Mobile logo height capped via class so the inline `height={70}` doesn't
					    push the bar back to 90px. `max-h-9` (=36px) + `sm:max-h-none` keeps the
					    desktop visual unchanged. */}
					<ForumLogo
						height={70}
						lightSrc={vm.logoLight}
						darkSrc={vm.logoDark}
						alt={vm.logoAlt}
						className="max-h-9 sm:max-h-none"
					/>
				</Link>

				{/* Right: User info area */}
				{user ? (
					<div
						className="flex items-center gap-2 sm:gap-4 min-w-0 shrink-0"
						data-testid="forum-top-bar-user"
					>
						{/* Profile card — avatar + (sm+) meta. shrink-0 keeps the avatar
						    cluster intact on small screens; only the meta text collapses. */}
						<UserPopover
							userId={user.uid}
							viewerRole={user.role}
							viewerUserId={user.uid}
							side="bottom"
							align="end"
							triggerClassName="inline-flex items-center gap-3 rounded-lg px-1 py-1 sm:px-3 sm:py-2 min-w-0 sm:max-w-[320px] shrink-0 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 transition-colors"
						>
							{/* Avatar — rounded-rect, image fills directly */}
							<TrackedUserAvatar uid={user.uid} username={user.username} size="md" />

							{/* Meta: hidden on mobile (popover content carries identity);
							    desktop unchanged. */}
							<span
								className="hidden sm:block text-right space-y-0.5 min-w-0"
								data-testid="forum-top-bar-user-meta"
							>
								<span className="flex items-center justify-end gap-2 min-w-0">
									<span className="text-sm font-medium text-foreground truncate">
										{user.username}
									</span>
									<span className="text-xs text-muted-foreground shrink-0">UID: {user.uid}</span>
									<span className="text-xs text-muted-foreground truncate">{user.groupTitle}</span>
								</span>
								<span className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
									<span className="shrink-0">积分 {user.credits}</span>
									<span className="shrink-0">同钱 {user.coins}</span>
								</span>
							</span>
						</UserPopover>

						{/* Action icons — WidthToggle + ThemeToggle desktop only */}
						<div className="flex items-center gap-1 shrink-0">
							<span
								className="hidden sm:inline-flex items-center gap-1"
								data-testid="forum-top-bar-desktop-toggles"
							>
								<WidthToggle />
								<ThemeToggle />
							</span>
							<MessageBadgeIcon />
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
					// Guest: keep 登录/注册 inline on all sizes (short enough),
					// hide width/theme toggles on mobile only.
					<div className="flex items-center gap-3 text-sm shrink-0">
						<span className="hidden sm:inline-flex items-center gap-3">
							<WidthToggle />
							<ThemeToggle />
						</span>
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

	// Mobile: horizontal scroll instead of wrap. Reviewer constraint (msg
	// 8b90cb85): "不折行、不撑出 body 横向滚动". `overflow-x-auto` on the
	// inner scroll container localizes the horizontal scroll to the nav
	// strip — body still passes the `documentElement.scrollWidth <=
	// innerWidth + 1` invariant because the overflow is clipped by the
	// `nav-gradient` parent's default `overflow-x` (visible→hidden override
	// below). `whitespace-nowrap` on every link guarantees a single-line
	// tab row. `touch-pan-x` opts into native momentum-scroll on iOS.
	return (
		<div className="nav-gradient overflow-x-hidden">
			<div
				className="relative z-10 flex items-center px-4 h-[40px] overflow-x-auto touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
				data-testid="forum-nav-bar"
			>
				{vm.navTabs.map((tab) => {
					const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

					return (
						<Link
							key={tab.href}
							href={tab.href}
							className={cn(
								"h-full flex items-center px-4 text-sm font-bold text-dz-nav-text transition-colors hover:bg-white/10 whitespace-nowrap shrink-0",
								isActive && "bg-white/10",
							)}
							data-testid="forum-nav-link"
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

	// Hidden entirely on mobile (<640px). The 320px search input + 5-segment
	// stats row cannot fit on a 375px iPhone, and both pieces are secondary:
	// search has a dedicated `/search` page reachable from the nav, and the
	// stats are vanity numbers. Desktop branch unchanged.
	return (
		<div className="hidden sm:block" data-testid="forum-search-stats-bar">
			<div className="width-container flex items-center justify-between !py-2 h-[44px]">
				{/* Left: Modern search input with / shortcut */}
				<div className="relative w-[320px]">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						placeholder="搜索主题、用户..."
						aria-label="搜索主题和用户"
						className="h-8 w-full rounded-lg border border-input bg-transparent pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								const query = (e.target as HTMLInputElement).value.trim();
								if (query.length >= 2) {
									window.location.href = `/search?q=${encodeURIComponent(query)}`;
								}
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
					<kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 flex h-5 items-center rounded border border-border bg-muted px-1.5 text-xs font-medium text-muted-foreground">
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
					<span>主题: </span>
					<span className="font-bold text-foreground">{formatNumber(s.totalThreads)}</span>
					<StatSep />
					<span>回复: </span>
					<span className="font-bold text-foreground">{formatNumber(s.totalPosts)}</span>
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
