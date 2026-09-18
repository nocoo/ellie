"use client";

// components/forum/thread-item.tsx — Discuz classic thread row
// Desktop: 4-column table layout (Icon | Subject | Author | Stats | Last Post)
// Mobile: 2-row compact layout (Icon + badges + subject on row 1, stats inline on row 2)

import { Award, Sprout } from "lucide-react";
import Link from "next/link";
import { highlightStyle, type ThreadDisplayItem } from "@/viewmodels/forum/thread-list";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import { ThreadBadgeList } from "./thread-badge";
import { ThreadInlinePages } from "./thread-inline-pages";
import { ThreadLastPostCell } from "./thread-last-post-cell";
import { ThreadRowIcon } from "./thread-row-icon";
import { ThreadRowStats } from "./thread-row-stats";
import { ForumAvatar } from "./user-avatar";
import { UserPopover } from "./user-popover";

interface ThreadItemProps {
	item: ThreadDisplayItem;
	postsPerPage: number;
	/** URL to return to when navigating back from the thread detail page. */
	returnTo?: string;
}

export function ThreadItem({ item, postsPerPage, returnTo }: ThreadItemProps) {
	const {
		thread,
		badges,
		highlight: hl,
		iconSrc,
		digestSrc,
		newbieStampSrc,
		isGlobalAnnouncement,
	} = item;
	const threadHref = returnTo
		? `/threads/${thread.id}?returnTo=${encodeURIComponent(returnTo)}`
		: `/threads/${thread.id}`;
	// Three author-render branches, mutually exclusive:
	//   isAnonAuthor   — anonymous=1 + authorId=0 (intentional anonymous;
	//                    render "匿名"). Worker unmasks for staff/self so
	//                    they end up with authorId>0 and skip this branch.
	//   isOrphanAuthor — anonymous=0 + authorId=0 (placeholder/tombstoned
	//                    user). No /users/0 link, but copy is "未知用户"
	//                    not "匿名" — semantically distinct.
	//   default        — real authorId>0, normal profile link + popover.
	const isAnonAuthor = thread.anonymousAuthor === 1 && thread.authorId === 0;
	const isOrphanAuthor = !isAnonAuthor && thread.authorId === 0;

	return (
		<div
			className="border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset"
			data-testid="thread-item"
		>
			{/* Desktop layout: single row with columns */}
			<div className="hidden sm:flex items-center">
				{/* Thread icon column */}
				<div className="flex items-center justify-center w-[36px] shrink-0 pl-2">
					<ThreadRowIcon iconSrc={iconSrc} isGlobalAnnouncement={isGlobalAnnouncement} />
				</div>

				{/* Avatar column (between icon and subject) */}
				{isAnonAuthor || isOrphanAuthor ? (
					<div className="shrink-0 pl-1">
						<ForumAvatar
							userId={0}
							userName={isAnonAuthor ? "匿名" : "未知用户"}
							avatarPath=""
							shadow
						/>
					</div>
				) : (
					<Link href={`/users/${thread.authorId}`} prefetch={false} className="shrink-0 pl-1">
						<ForumAvatar
							userId={thread.authorId}
							userName={thread.authorName}
							avatarPath={thread.authorAvatarPath}
							shadow
						/>
					</Link>
				)}

				{/* Column 1: Subject — flex row so title truncates but accessories stay visible */}
				<div className="min-w-0 flex-1 py-3 px-3 flex flex-wrap items-center gap-1.5">
					{badges.length > 0 && (
						<span className="inline-flex items-center gap-1 shrink-0">
							<ThreadBadgeList badges={badges} />
						</span>
					)}
					<Link
						href={threadHref}
						prefetch={false}
						className="forum-thread-title min-w-0 line-clamp-2 break-words text-sm font-medium text-foreground hover:text-primary transition-colors"
						style={highlightStyle(hl)}
					>
						{thread.subject}
					</Link>
					{digestSrc && (
						<Award
							role="img"
							aria-label={`精华 ${thread.digest}`}
							className="size-4 shrink-0 text-success"
						/>
					)}
					{newbieStampSrc && (
						<Sprout role="img" aria-label="首次发帖" className="size-4 shrink-0 text-success" />
					)}
					<span className="shrink-0">
						<ThreadInlinePages
							threadId={thread.id}
							replies={thread.replies}
							postsPerPage={postsPerPage}
							returnTo={returnTo}
						/>
					</span>
				</div>

				{/* Column 2: Author (fixed, centered) */}
				<div className="flex flex-col items-center justify-center w-[100px] shrink-0 py-2 text-center">
					{isAnonAuthor ? (
						<span className="block text-xs text-muted-foreground font-medium truncate max-w-full">
							匿名
						</span>
					) : isOrphanAuthor ? (
						<span className="block text-xs text-muted-foreground font-medium truncate max-w-full">
							未知用户
						</span>
					) : (
						<UserPopover userId={thread.authorId} triggerClassName="max-w-full min-w-0">
							<span className="block text-xs text-foreground font-medium hover:text-primary transition-colors truncate max-w-full cursor-pointer">
								{thread.authorName}
							</span>
						</UserPopover>
					)}
					<span className="text-xs text-muted-foreground">
						{formatRelativeTime(thread.createdAt)}
					</span>
				</div>

				{/* Column 3: Replies / Views / Recommends (fixed) */}
				<ThreadRowStats
					replies={thread.replies}
					views={thread.views}
					recommends={thread.recommends}
					variant="desktop"
				/>

				{/* Column 4: Last Post (fixed) */}
				<ThreadLastPostCell
					lastPosterId={thread.lastPosterId}
					lastPoster={thread.lastPoster}
					lastPostAt={thread.lastPostAt}
				/>
			</div>

			{/* Mobile layout: two-row compact display */}
			<div className="sm:hidden px-3 py-3">
				{/* Row 1: Icon + badges + subject (avatar moved to Row 2 per
				    reviewer freeze msg=5a91dfd3 — keeps the title area free
				    of the avatar visual on phones). */}
				<div className="flex items-start gap-1.5">
					<ThreadRowIcon
						iconSrc={iconSrc}
						isGlobalAnnouncement={isGlobalAnnouncement}
						extraClass="mt-0.5 shrink-0"
					/>
					<div className="min-w-0 flex-1">
						{badges.length > 0 && (
							<div className="flex items-center gap-1.5">
								<ThreadBadgeList badges={badges} />
							</div>
						)}
						<div className="flex items-center gap-1.5">
							<Link
								href={threadHref}
								prefetch={false}
								className="forum-thread-title min-w-0 line-clamp-2 break-words text-sm font-medium text-foreground hover:text-primary transition-colors"
								style={highlightStyle(hl)}
								data-testid="thread-item-mobile-title-link"
							>
								{thread.subject}
							</Link>
							{digestSrc && (
								<Award
									role="img"
									aria-label={`精华 ${thread.digest}`}
									className="size-4 shrink-0 text-success"
								/>
							)}
							{newbieStampSrc && (
								<Sprout role="img" aria-label="首次发帖" className="size-4 shrink-0 text-success" />
							)}
							<span className="shrink-0">
								<ThreadInlinePages
									threadId={thread.id}
									replies={thread.replies}
									postsPerPage={postsPerPage}
									returnTo={returnTo}
								/>
							</span>
						</div>
					</div>
				</div>
				<div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
					{isAnonAuthor || isOrphanAuthor ? (
						<div className="shrink-0" data-testid="thread-item-mobile-avatar-link">
							<ForumAvatar
								userId={0}
								userName={isAnonAuthor ? "匿名" : "未知用户"}
								avatarPath=""
								size="xs"
							/>
						</div>
					) : (
						<Link
							href={`/users/${thread.authorId}`}
							prefetch={false}
							className="shrink-0"
							data-testid="thread-item-mobile-avatar-link"
						>
							<ForumAvatar
								userId={thread.authorId}
								userName={thread.authorName}
								avatarPath={thread.authorAvatarPath}
								size="xs"
							/>
						</Link>
					)}
					<span className="min-w-0 max-w-32 truncate">
						{isAnonAuthor ? (
							<span className="block truncate text-muted-foreground">匿名</span>
						) : isOrphanAuthor ? (
							<span className="block truncate text-muted-foreground">未知用户</span>
						) : (
							<UserPopover userId={thread.authorId} triggerClassName="max-w-full min-w-0">
								<span className="block truncate text-foreground hover:text-primary cursor-pointer">
									{thread.authorName}
								</span>
							</UserPopover>
						)}
					</span>
					<span className="shrink-0">·</span>
					<span className="shrink-0">{formatRelativeTime(thread.createdAt)}</span>
					<span className="ml-auto shrink-0 tabular-nums">
						<ThreadRowStats
							replies={thread.replies}
							views={thread.views}
							recommends={thread.recommends}
							variant="mobile"
						/>
					</span>
				</div>
			</div>
		</div>
	);
}
