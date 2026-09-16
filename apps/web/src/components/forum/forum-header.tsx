"use client";

import { Award, CalendarCheck, House, LogOut, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef } from "react";
import { ForumLogo } from "@/components/forum/forum-logo";
import { MessageBadgeIcon } from "@/components/forum/message-badge-icon";
import { TrackedUserAvatar } from "@/components/forum/user-avatar";
import { UserPopover } from "@/components/forum/user-popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WidthToggle } from "@/components/width-toggle";
import { cn } from "@/lib/utils";
import type { HeaderViewModel } from "@/viewmodels/forum/header";
import { formatNumber } from "@/viewmodels/shared/formatting";

function TopBar({ vm }: { vm: HeaderViewModel }) {
	const user = vm.user;
	return (
		<div
			className="width-container flex h-14 items-center justify-between gap-3 sm:h-[76px]"
			data-testid="forum-top-bar"
		>
			<Link href="/" className="min-w-0 shrink-0" aria-label={vm.homeLabel}>
				<ForumLogo
					height={52}
					lightSrc={vm.logoLight}
					darkSrc={vm.logoDark}
					alt={vm.logoAlt}
					className="max-h-8 sm:max-h-none"
				/>
			</Link>
			<div className="flex min-w-0 items-center gap-1 sm:gap-3" data-testid="forum-top-bar-user">
				{user && (
					<UserPopover
						userId={user.uid}
						viewerRole={user.role}
						viewerUserId={user.uid}
						side="bottom"
						align="end"
						triggerClassName="inline-flex min-w-0 items-center gap-2.5 rounded-xl p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[320px] sm:px-3 sm:py-2"
					>
						<TrackedUserAvatar uid={user.uid} username={user.username} size="md" />
						<span
							className="hidden min-w-0 space-y-0.5 text-left sm:block"
							data-testid="forum-top-bar-user-meta"
						>
							<span className="flex min-w-0 items-center gap-2">
								<span className="truncate text-sm font-semibold">{user.username}</span>
								<span className="shrink-0 text-xs text-muted-foreground">UID: {user.uid}</span>
								<span className="truncate text-xs text-muted-foreground">{user.groupTitle}</span>
							</span>
							<span className="flex gap-3 text-xs text-muted-foreground tabular-nums">
								<span>积分 {user.credits}</span>
								<span>同钱 {user.coins}</span>
							</span>
						</span>
					</UserPopover>
				)}
				<div className="flex shrink-0 items-center gap-0.5">
					<div
						className="hidden items-center sm:inline-flex"
						data-testid="forum-top-bar-desktop-toggles"
					>
						<WidthToggle />
					</div>
					<ThemeToggle />
					{user ? (
						<>
							<MessageBadgeIcon />
							<Button
								variant="ghost"
								size="icon"
								onClick={() => signOut({ callbackUrl: "/" })}
								title="退出登录"
								aria-label="退出登录"
							>
								<LogOut className="h-4 w-4" aria-hidden="true" />
							</Button>
						</>
					) : (
						<>
							<Button
								variant="ghost"
								nativeButton={false}
								role="link"
								render={<Link href="/login" />}
							>
								登录
							</Button>
							<Button size="sm" nativeButton={false} role="link" render={<Link href="/register" />}>
								注册
							</Button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function NavBar({ vm }: { vm: HeaderViewModel }) {
	const pathname = usePathname();
	return (
		<div className="width-container overflow-x-hidden">
			<nav
				aria-label="论坛导航"
				className="flex items-center gap-1 overflow-x-auto border-b border-border py-1 touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				data-testid="forum-nav-bar"
			>
				{vm.navTabs.map((tab) => {
					const isActive =
						pathname === tab.href || (tab.href !== "/" && pathname.startsWith(`${tab.href}/`));
					const Icon =
						tab.href === "/"
							? House
							: tab.href === "/digest"
								? Award
								: tab.href === "/checkin"
									? CalendarCheck
									: null;
					return (
						<Link
							key={tab.href}
							href={tab.href}
							aria-current={isActive ? "page" : undefined}
							className={cn(
								"inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-primary",
								isActive ? "bg-primary/10 text-primary" : "text-muted-foreground",
							)}
							data-testid="forum-nav-link"
						>
							{Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
							{tab.label}
						</Link>
					);
				})}
			</nav>
		</div>
	);
}

function SearchStatsBar({ vm }: { vm: HeaderViewModel }) {
	const searchRef = useRef<HTMLInputElement>(null);
	const router = useRouter();
	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			const target = event.target;
			if (
				event.key !== "/" ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.isComposing ||
				(target instanceof HTMLElement &&
					(target.isContentEditable ||
						target.closest(
							'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
						)))
			)
				return;
			event.preventDefault();
			searchRef.current?.focus();
		};
		document.addEventListener("keydown", handleShortcut);
		return () => document.removeEventListener("keydown", handleShortcut);
	}, []);
	const stats = [
		["今日", vm.stats.todayPosts],
		["昨日", vm.stats.yesterdayPosts],
		["主题", vm.stats.totalThreads],
		["帖子", vm.stats.totalPosts],
		["会员", vm.stats.totalMembers],
	] as const;
	return (
		<div
			className="width-container flex items-center justify-between gap-4 py-2.5"
			data-testid="forum-search-stats-bar"
		>
			<search className="relative w-full sm:max-w-[340px]">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const query = searchRef.current?.value.trim() ?? "";
						if (query.length >= 2) router.push(`/search?q=${encodeURIComponent(query)}`);
					}}
				>
					<Search
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						ref={searchRef}
						type="search"
						name="q"
						required
						minLength={2}
						aria-label="搜索主题"
						placeholder="搜索主题，发现更多讨论"
						className="h-9 bg-muted/50 pl-9 pr-14 text-sm"
					/>
					<button
						type="submit"
						className="absolute right-1 top-1 flex h-7 items-center rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10"
						aria-label="提交搜索"
					>
						搜索
					</button>
				</form>
			</search>
			<dl className="hidden items-center gap-4 text-xs tabular-nums md:flex lg:gap-6">
				{stats.map(([label, value]) => (
					<div key={label} className="flex items-baseline gap-1.5">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="font-semibold text-foreground">
							{value == null ? "—" : formatNumber(value)}
						</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

export function ForumHeader({ vm }: { vm: HeaderViewModel }) {
	return (
		<header className="border-b border-border bg-card">
			<TopBar vm={vm} />
			<NavBar vm={vm} />
			<SearchStatsBar vm={vm} />
		</header>
	);
}
