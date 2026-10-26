"use client";

import type { ForumTreeNode } from "@ellie/types";
import { MessageSquare, MessagesSquare } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatCount, hasRecentForumActivity } from "@/viewmodels/forum/forum-list";
import { formatDateTime, formatDateTimeMobile } from "@/viewmodels/shared/formatting";
import { SafeHtml } from "./safe-html";
import { ForumAvatar } from "./user-avatar";
import { UserPopover } from "./user-popover";

interface ForumCardProps {
	forum: ForumTreeNode;
	layout?: "wide" | "grid";
}

function ForumIcon({ lastPostAt }: { lastPostAt: number }) {
	const hasActivity = hasRecentForumActivity(lastPostAt);
	const label = hasActivity ? "最近 24 小时有新主题" : "最近 24 小时无新主题";
	return (
		<Image
			src={hasActivity ? "/icons/forum_new.svg" : "/icons/forum.svg"}
			alt={label}
			title={label}
			width={32}
			height={36}
			unoptimized
			className="h-9 w-8 shrink-0"
		/>
	);
}

/** Last poster avatar wrapped in a user link. Returns null when userId <= 0. */
function LastPosterAvatarLink({
	userId,
	userName,
	avatarPath,
}: {
	userId: number;
	userName: string;
	avatarPath: string;
}) {
	if (userId <= 0) return null;
	return (
		<Link href={`/users/${userId}`} prefetch={false} className="shrink-0">
			<ForumAvatar userId={userId} userName={userName} avatarPath={avatarPath} size="xs" shadow />
		</Link>
	);
}

function ForumStats({
	threads,
	posts,
	variant,
}: {
	threads: number;
	posts: number;
	variant: "desktop" | "inline";
}) {
	const counts = (
		<span
			className="inline-flex items-center gap-3 whitespace-nowrap"
			data-testid={variant === "desktop" ? "forum-stats-desktop" : "forum-stats-inline"}
		>
			<span className="inline-flex items-center gap-1" title="主题">
				<MessagesSquare className="size-3 shrink-0" aria-hidden="true" />
				<span className="sr-only">主题 </span>
				<span className={variant === "desktop" ? "text-foreground font-medium" : undefined}>
					{formatCount(threads)}
				</span>
			</span>
			<span className="inline-flex items-center gap-1" title="帖子">
				<MessageSquare className="size-3 shrink-0" aria-hidden="true" />
				<span className="sr-only">帖子 </span>
				{formatCount(posts)}
			</span>
		</span>
	);
	return variant === "desktop" ? (
		<div className="flex justify-end self-start text-xs text-muted-foreground tabular-nums leading-5">
			{counts}
		</div>
	) : (
		counts
	);
}

/** Today's new thread count badge. Returns null when count <= 0. */
function TodayThreadBadge({
	count,
	variant,
}: {
	count: number;
	variant: "parenthesized" | "pill" | "plus";
}) {
	if (count <= 0) return null;
	if (variant === "pill") {
		// Fixed line-height pill so it never bumps the row height.
		// `shrink-0` keeps the pill at intrinsic width even when a long
		// forum name truncates inside a `flex items-center` mobile row.
		return (
			<span className="inline-flex items-center h-4 rounded-full bg-forum-accent/10 px-1.5 text-xs font-medium text-forum-accent leading-none shrink-0">
				+{formatCount(count)}
			</span>
		);
	}
	return (
		<span className="text-sm text-forum-accent font-medium shrink-0">
			{variant === "parenthesized" ? `(${formatCount(count)})` : `+${formatCount(count)}`}
		</span>
	);
}

/**
 * Inline label + dot-separated link list — used for both 子版面 and 版主.
 * No badges; layered text colour only so the homepage stays calm.
 *
 * The optional `className` lets callers tag the row with a font-size:
 * `SubForumLinks` keeps the default (text-sm — sub-forum entries are
 * primary navigation), while `ModeratorLinks` opts into `text-xs`
 * because moderator usernames belong to the auxiliary meta tier
 * (matches the thread-list page's 12px treatment of usernames).
 */
function ForumMetaLine({
	label,
	items,
	renderItem,
	className = "",
}: {
	label: string;
	items: { id: number; name: string }[];
	renderItem: (item: { id: number; name: string }) => React.ReactNode;
	className?: string;
}) {
	if (items.length === 0) return null;
	return (
		<div
			className={`mt-1 flex items-baseline gap-1 flex-wrap leading-5${className ? ` ${className}` : ""}`}
			data-testid={`forum-meta-${label}`}
		>
			<span className="text-muted-foreground/80">{label}</span>
			{items.map((item, i) => (
				<span key={item.id} className="inline-flex items-baseline gap-1">
					{i > 0 && <span className="text-muted-foreground/50">·</span>}
					{renderItem(item)}
				</span>
			))}
		</div>
	);
}

function SubForumLinks({ forums }: { forums: { id: number; name: string }[] }) {
	return (
		<ForumMetaLine
			label="子版面"
			items={forums}
			className="text-sm"
			renderItem={(sub) => (
				<Link
					href={`/forums/${sub.id}`}
					prefetch={false}
					className="text-forum-link hover:underline"
				>
					{sub.name}
				</Link>
			)}
		/>
	);
}

function ModeratorLinks({ mods }: { mods: { id: number; name: string }[] }) {
	return (
		<ForumMetaLine
			label="版主"
			items={mods}
			className="text-xs"
			renderItem={(mod) => (
				<UserPopover userId={mod.id}>
					<span className="text-forum-link hover:underline cursor-pointer">{mod.name}</span>
				</UserPopover>
			)}
		/>
	);
}

function LastPostPreview({ forum }: { forum: ForumTreeNode }) {
	if (forum.lastPostAt <= 0) return null;
	return (
		<div className="min-w-0 flex flex-col text-sm text-muted-foreground leading-5">
			<Link
				href={`/threads/${forum.lastThreadId}`}
				prefetch={false}
				className="relative z-10 text-forum-link hover:underline truncate"
			>
				{forum.lastThreadSubject || "最新主题"}
			</Link>
			<span
				className="flex items-center gap-1 min-w-0 text-xs leading-5"
				data-testid="last-post-meta"
			>
				<span className="whitespace-nowrap shrink-0" data-testid="last-post-date">
					{formatDateTime(forum.lastPostAt)}
				</span>
				<LastPosterAvatarLink
					userId={forum.lastPosterId}
					userName={forum.lastPoster}
					avatarPath={forum.lastPosterAvatarPath}
				/>
				{forum.lastPosterId > 0 ? (
					<Link
						href={`/users/${forum.lastPosterId}`}
						prefetch={false}
						className="relative z-10 text-forum-link hover:underline truncate min-w-0"
						data-testid="last-poster-link"
					>
						{forum.lastPoster}
					</Link>
				) : (
					<span className="text-forum-link">{forum.lastPoster}</span>
				)}
			</span>
		</div>
	);
}

function MobileLastPostLine({ forum }: { forum: ForumTreeNode }) {
	if (forum.lastPostAt <= 0) {
		return (
			<div
				className="mt-1 flex items-center text-xs text-muted-foreground leading-5"
				data-testid="mobile-last-post-empty"
			>
				<span className="truncate min-w-0">暂无最新主题</span>
			</div>
		);
	}
	const hasAvatar = forum.lastPosterId > 0;
	return (
		<div
			className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground leading-5 min-w-0"
			data-testid="mobile-last-post-row"
		>
			<Link
				href={`/threads/${forum.lastThreadId}`}
				prefetch={false}
				className="relative z-10 text-forum-link hover:underline truncate min-w-0 flex-1"
				data-testid="mobile-last-thread-link"
			>
				{forum.lastThreadSubject || "最新主题"}
			</Link>
			<span className="flex items-center gap-1 shrink-0 max-w-[42%] min-w-0">
				{hasAvatar && (
					<span className="shrink-0">
						<ForumAvatar
							userId={forum.lastPosterId}
							userName={forum.lastPoster}
							avatarPath={forum.lastPosterAvatarPath}
							size="xs"
						/>
					</span>
				)}
				{hasAvatar ? (
					<Link
						href={`/users/${forum.lastPosterId}`}
						prefetch={false}
						className="relative z-10 text-forum-link hover:underline truncate min-w-0"
						data-testid="mobile-last-poster-link"
					>
						{forum.lastPoster}
					</Link>
				) : (
					<span className="text-forum-link truncate min-w-0" data-testid="mobile-last-poster-link">
						{forum.lastPoster}
					</span>
				)}
				<span
					className="whitespace-nowrap tabular-nums shrink-0"
					data-testid="mobile-last-post-date"
				>
					{formatDateTimeMobile(forum.lastPostAt)}
				</span>
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Wide layout — one forum per row, fixed grid template for column alignment
// ---------------------------------------------------------------------------

function ForumCardWide({ forum }: { forum: ForumTreeNode }) {
	return (
		<div
			className="relative transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset"
			data-testid="forum-card"
		>
			<div className="hidden sm:grid sm:grid-cols-[36px_minmax(0,1fr)_160px] lg:grid-cols-[36px_minmax(0,1fr)_160px_240px] items-start gap-x-4 gap-y-1 px-4 py-3.5">
				<div className="self-start pt-0.5">
					<ForumIcon lastPostAt={forum.lastPostAt} />
				</div>

				<div className="min-w-0">
					<div className="flex items-baseline gap-1.5 flex-wrap">
						<Link
							href={`/forums/${forum.id}`}
							prefetch={false}
							className="text-sm font-bold text-foreground hover:text-primary transition-colors leading-5"
						>
							{forum.name}
						</Link>
						<TodayThreadBadge count={forum.todayThreads} variant="parenthesized" />
					</div>
					{forum.description && (
						<SafeHtml
							html={forum.description}
							className="mt-1 block text-sm text-muted-foreground leading-5 line-clamp-1"
						/>
					)}
					<SubForumLinks forums={forum.children} />
					<ModeratorLinks mods={forum.moderatorList ?? []} />
				</div>

				<ForumStats threads={forum.threads} posts={forum.posts} variant="desktop" />

				{/*
				 * Last-post column only renders at lg+ to keep the sm grid stable
				 * (3-col template on sm; 4-col on lg). The grid template, not
				 * the cell visibility, is what locks alignment.
				 */}
				<div className="hidden lg:block min-w-0">
					<LastPostPreview forum={forum} />
				</div>
			</div>

			{/* Mobile <640: compact 2-row stack.
			    Row 1: icon + name + today-pill (single line).
			    Row 2: shared MobileLastPostLine (avatar + thread title +
			    user/date) or "暂无最新主题" empty state. Reviewer freeze
			    msg=efa3c2e9 reversed the earlier msg=8b90cb85 freeze to
			    surface the latest-thread context per哥's "右侧空间利用"
			    requirement, while keeping every row at exactly 2 lines via
			    `truncate min-w-0` on the title and `max-w-[42%] shrink-0`
			    on the user/date meta. */}
			<div className="sm:hidden px-3 py-2.5">
				<div className="flex items-center gap-2">
					<ForumIcon lastPostAt={forum.lastPostAt} />
					<Link
						href={`/forums/${forum.id}`}
						prefetch={false}
						className="text-sm font-bold text-foreground hover:text-primary transition-colors truncate min-w-0"
					>
						{forum.name}
					</Link>
					<TodayThreadBadge count={forum.todayThreads} variant="pill" />
				</div>
				<MobileLastPostLine forum={forum} />
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Grid layout — compact cell for 2-col grid panel (>10 children)
// (Untouched in this commit; same density tweaks already applied via helpers)
// ---------------------------------------------------------------------------

function ForumCardGrid({ forum }: { forum: ForumTreeNode }) {
	return (
		<div
			className="relative flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset"
			data-testid="forum-card"
		>
			<div className="mt-0.5 shrink-0">
				<ForumIcon lastPostAt={forum.lastPostAt} />
			</div>

			<div className="min-w-0 flex-1">
				<div className="flex flex-nowrap items-baseline gap-3 leading-5" data-testid="grid-row1">
					<div className="flex min-w-0 flex-1 items-baseline gap-1.5">
						<Link
							href={`/forums/${forum.id}`}
							prefetch={false}
							className="text-sm font-bold text-foreground hover:text-primary transition-colors truncate min-w-0 leading-5"
						>
							{forum.name}
						</Link>
						<TodayThreadBadge count={forum.todayThreads} variant="plus" />
					</div>
					<div
						className="ml-auto shrink-0 text-right text-xs text-muted-foreground tabular-nums leading-5 hidden sm:block"
						data-testid="grid-stats-row"
					>
						<ForumStats threads={forum.threads} posts={forum.posts} variant="inline" />
					</div>
				</div>

				{/* Moderator line is auxiliary meta — desktop only on the grid card. */}
				<div className="hidden sm:block">
					<ModeratorLinks mods={forum.moderatorList ?? []} />
				</div>

				{/* Desktop last-post row (>=sm). Mobile uses MobileLastPostLine
				    below so wide/grid stay aligned at 2-row density. */}
				{forum.lastPostAt > 0 && (
					<div
						className="mt-1 hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground leading-5"
						data-testid="grid-last-post-row"
					>
						<Link
							href={`/threads/${forum.lastThreadId}`}
							prefetch={false}
							className="relative z-10 text-forum-link hover:underline truncate min-w-0 flex-1"
							data-testid="grid-last-thread-link"
						>
							{forum.lastThreadSubject || "最新主题"}
						</Link>
						<LastPosterAvatarLink
							userId={forum.lastPosterId}
							userName={forum.lastPoster}
							avatarPath={forum.lastPosterAvatarPath}
						/>
						{forum.lastPosterId > 0 ? (
							<Link
								href={`/users/${forum.lastPosterId}`}
								prefetch={false}
								className="truncate min-w-0 max-w-[35%] shrink-0 text-xs text-forum-link hover:underline"
								data-testid="last-poster-link-grid"
							>
								{forum.lastPoster}
							</Link>
						) : (
							<span className="truncate min-w-0 max-w-[35%] shrink-0 text-xs">
								{forum.lastPoster}
							</span>
						)}
					</div>
				)}

				{/* Mobile Row 2 (<640px): shared helper keeps grid in sync with
				    wide layout — avatar + thread title + user/date, or empty
				    state so the row never collapses to 1 line. */}
				<div className="sm:hidden">
					<MobileLastPostLine forum={forum} />
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function ForumCard({ forum, layout = "wide" }: ForumCardProps) {
	return layout === "grid" ? <ForumCardGrid forum={forum} /> : <ForumCardWide forum={forum} />;
}
