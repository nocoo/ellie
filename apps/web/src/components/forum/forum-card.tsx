"use client";

// components/forum/forum-card.tsx — Forum card with two layout variants
// "wide" = full-width row (学习与学术区 style), "grid" = compact cell in 2-col grid (社团与爱好区 style)
//
// Wide layout uses a fixed CSS grid template so the icon, info, stats, and
// last-post columns line up across rows regardless of name/description length.
// - <640px:  single-column mobile compact stack
// - 640–1023: `36px minmax(0,1fr) 96px`  — stats anchor stays put, last-post hidden
// - >=1024:   `36px minmax(0,1fr) 104px 240px` — full 4-column row
//
// `<ForumMetaLine>` and `<LastPostPreview>` keep the visual rhythm centralised
// so future tweaks don't have to chase 2 layouts.

import { getStaticImageUrl } from "@/lib/cdn";
import { formatCount } from "@/viewmodels/forum/forum-list";
import { formatDateTime } from "@/viewmodels/shared/formatting";
import type { ForumTreeNode } from "@ellie/types";
import Link from "next/link";
import { SafeHtml } from "./safe-html";
import { ForumAvatar } from "./user-avatar";
import { UserPopover } from "./user-popover";

interface ForumCardProps {
	forum: ForumTreeNode;
	layout?: "wide" | "grid";
}

/** Forum icon — Discuz original: forum_new.gif when active, forum.gif when idle */
function ForumIcon({ hasActivity = false }: { hasActivity?: boolean }) {
	const src = getStaticImageUrl(hasActivity ? "forum_new.gif" : "forum.gif");
	return <img src={src} alt="" className="h-7 w-7 object-contain shrink-0" aria-hidden="true" />;
}

/** Last poster avatar wrapped in a user link. Returns null when userId <= 0. */
function LastPosterAvatarLink({
	userId,
	userName,
	avatarPath,
}: { userId: number; userName: string; avatarPath?: string | null }) {
	if (userId <= 0) return null;
	return (
		<Link href={`/users/${userId}`} prefetch={false} className="shrink-0">
			<ForumAvatar userId={userId} userName={userName} avatarPath={avatarPath} shadow />
		</Link>
	);
}

/** Forum thread/post count display — desktop column or inline meta. */
function ForumStats({
	threads,
	posts,
	variant,
}: { threads: number; posts: number; variant: "desktop" | "inline" }) {
	if (variant === "desktop") {
		return (
			<div className="flex flex-col items-end self-start text-xs text-muted-foreground tabular-nums leading-5">
				<span>
					<span className="text-foreground font-medium">{formatCount(threads)}</span>
					{" / "}
					{formatCount(posts)}
				</span>
			</div>
		);
	}
	return (
		<>
			{formatCount(threads)} 帖 / {formatCount(posts)} 回
		</>
	);
}

/** Today's new thread count badge. Returns null when count <= 0. */
function TodayThreadBadge({
	count,
	variant,
}: { count: number; variant: "parenthesized" | "pill" | "plus" }) {
	if (count <= 0) return null;
	if (variant === "pill") {
		// Fixed line-height pill so it never bumps the row height.
		return (
			<span className="inline-flex items-center h-4 rounded-full bg-forum-accent/10 px-1.5 text-2xs font-medium text-forum-accent leading-none">
				+{formatCount(count)}
			</span>
		);
	}
	return (
		<span className="text-xs text-forum-accent font-medium">
			{variant === "parenthesized" ? `(${formatCount(count)})` : `+${formatCount(count)}`}
		</span>
	);
}

/**
 * Inline label + dot-separated link list — used for both 子版面 and 版主.
 * No badges; layered text colour only so the homepage stays calm.
 */
function ForumMetaLine({
	label,
	items,
	renderItem,
}: {
	label: string;
	items: { id: number; name: string }[];
	renderItem: (item: { id: number; name: string }) => React.ReactNode;
}) {
	if (items.length === 0) return null;
	return (
		<div className="mt-1 flex items-baseline gap-1 flex-wrap text-xs leading-5">
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
			renderItem={(mod) => (
				<UserPopover userId={mod.id}>
					<span className="text-forum-link hover:underline cursor-pointer">{mod.name}</span>
				</UserPopover>
			)}
		/>
	);
}

/** Last post column — avatar (32px) + title + meta, top-aligned to row baseline.
 *
 * When the last poster is anonymous / missing (`lastPosterId <= 0`), the
 * avatar slot is dropped entirely and the text spans both grid columns —
 * otherwise the text would slide into the 32px avatar cell and squeeze the
 * column. */
function LastPostPreview({ forum }: { forum: ForumTreeNode }) {
	if (forum.lastPostAt <= 0) return null;
	const hasAvatar = forum.lastPosterId > 0;
	return (
		<div className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-2 text-xs text-muted-foreground self-start">
			{hasAvatar && (
				<LastPosterAvatarLink
					userId={forum.lastPosterId}
					userName={forum.lastPoster}
					avatarPath={forum.lastPosterAvatarPath}
				/>
			)}
			<div className={`min-w-0 flex flex-col leading-5${hasAvatar ? "" : " col-span-2"}`}>
				<Link
					href={`/threads/${forum.lastThreadId}`}
					prefetch={false}
					className="relative z-10 text-forum-link hover:underline truncate"
				>
					{forum.lastThreadSubject || "最新主题"}
				</Link>
				<span className="truncate">
					{formatDateTime(forum.lastPostAt)}{" "}
					{forum.lastPosterId > 0 ? (
						<UserPopover userId={forum.lastPosterId}>
							<span className="text-forum-link hover:underline cursor-pointer">
								{forum.lastPoster}
							</span>
						</UserPopover>
					) : (
						<span className="text-forum-link">{forum.lastPoster}</span>
					)}
				</span>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Wide layout — one forum per row, fixed grid template for column alignment
// ---------------------------------------------------------------------------

function ForumCardWide({ forum }: { forum: ForumTreeNode }) {
	return (
		<div className="relative transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset">
			{/*
			 * Desktop ≥640: CSS grid template ensures stats / last-post columns
			 * line up across rows regardless of name length.
			 *  sm  (640–1023): 36px | 1fr | 96px            (last-post hidden)
			 *  lg  (>=1024) : 36px | 1fr | 104px | 240px   (full)
			 * Top-aligned so multi-line info doesn't push the avatar baseline.
			 */}
			<div className="hidden sm:grid sm:grid-cols-[36px_minmax(0,1fr)_96px] lg:grid-cols-[36px_minmax(0,1fr)_104px_240px] items-start gap-x-4 gap-y-1 px-4 py-3.5">
				<div className="self-start pt-0.5">
					<ForumIcon hasActivity={forum.todayThreads > 0} />
				</div>

				<div className="min-w-0">
					<div className="flex items-baseline gap-1.5 flex-wrap">
						<Link
							href={`/forums/${forum.id}`}
							prefetch={false}
							className="text-sm font-bold text-foreground hover:text-destructive transition-colors"
						>
							{forum.name}
						</Link>
						<TodayThreadBadge count={forum.todayThreads} variant="parenthesized" />
					</div>
					{forum.description && (
						<SafeHtml
							html={forum.description}
							className="mt-1 block text-xs text-muted-foreground leading-5 line-clamp-1"
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

			{/* Mobile <640: compact 2-row stack. */}
			<div className="sm:hidden px-3 py-2.5">
				<div className="flex items-center gap-2">
					<ForumIcon hasActivity={forum.todayThreads > 0} />
					<Link
						href={`/forums/${forum.id}`}
						prefetch={false}
						className="text-sm font-bold text-foreground hover:text-destructive transition-colors"
					>
						{forum.name}
					</Link>
					<TodayThreadBadge count={forum.todayThreads} variant="pill" />
				</div>
				<div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
					<span className="tabular-nums">
						<ForumStats threads={forum.threads} posts={forum.posts} variant="inline" />
					</span>
					{forum.lastPostAt > 0 && (
						<>
							<span className="text-muted-foreground/50">·</span>
							<span className="truncate">
								{forum.lastPoster} {formatDateTime(forum.lastPostAt)}
							</span>
						</>
					)}
				</div>
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
		<div className="relative flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset">
			<div className="mt-0.5 shrink-0">
				<ForumIcon hasActivity={forum.todayThreads > 0} />
			</div>

			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-1.5 flex-wrap">
					<Link
						href={`/forums/${forum.id}`}
						prefetch={false}
						className="text-sm font-bold text-foreground hover:text-destructive transition-colors"
					>
						{forum.name}
					</Link>
					<TodayThreadBadge count={forum.todayThreads} variant="plus" />
				</div>
				<div className="mt-1 text-xs text-muted-foreground tabular-nums leading-5">
					<ForumStats threads={forum.threads} posts={forum.posts} variant="inline" />
				</div>

				<ModeratorLinks mods={forum.moderatorList ?? []} />

				{forum.lastPostAt > 0 && (
					<div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
						<LastPosterAvatarLink
							userId={forum.lastPosterId}
							userName={forum.lastPoster}
							avatarPath={forum.lastPosterAvatarPath}
						/>
						<Link
							href={`/threads/${forum.lastThreadId}`}
							prefetch={false}
							className="relative z-10 text-forum-link hover:underline truncate"
						>
							{forum.lastThreadSubject || "最新主题"}
						</Link>{" "}
						<span className="shrink-0">{forum.lastPoster}</span>
					</div>
				)}
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
