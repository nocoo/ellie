"use client";

// components/forum/thread-item.tsx — Discuz classic thread row
// Desktop: 4-column table layout (Icon | Subject | Author | Stats | Last Post)
// Mobile: 2-row compact layout (Icon + badges + subject on row 1, stats inline on row 2)

import { type ThreadDisplayItem, highlightStyle } from "@/viewmodels/forum/thread-list";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import Link from "next/link";
import { ThreadBadgeList } from "./thread-badge";
import { ThreadInlinePages } from "./thread-inline-pages";
import { ThreadLastPostCell } from "./thread-last-post-cell";
import { ThreadRowStats } from "./thread-row-stats";
import { ForumAvatar } from "./user-avatar";
import { UserPopover } from "./user-popover";

interface ThreadItemProps {
	item: ThreadDisplayItem;
	postsPerPage: number;
}

export function ThreadItem({ item, postsPerPage }: ThreadItemProps) {
	const { thread, badges, highlight: hl, iconSrc, digestSrc } = item;

	return (
		<div className="border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset">
			{/* Desktop layout: single row with columns */}
			<div className="hidden sm:flex items-center">
				{/* Thread icon column */}
				<div className="flex items-center justify-center w-[36px] shrink-0 pl-2">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={iconSrc} alt="" className="opacity-70" />
				</div>

				{/* Avatar column (between icon and subject) */}
				<Link href={`/users/${thread.authorId}`} prefetch={false} className="shrink-0 pl-1">
					<ForumAvatar
						userId={thread.authorId}
						userName={thread.authorName}
						avatarPath={thread.authorAvatarPath}
						shadow
					/>
				</Link>

				{/* Column 1: Subject — flex row so title truncates but accessories stay visible */}
				<div className="min-w-0 flex-1 py-2 px-3 flex items-center gap-1.5">
					{badges.length > 0 && (
						<span className="inline-flex items-center gap-1 shrink-0">
							<ThreadBadgeList badges={badges} />
						</span>
					)}
					<Link
						href={`/threads/${thread.id}`}
						prefetch={false}
						className="min-w-0 truncate text-sm text-foreground hover:text-primary transition-colors"
						style={highlightStyle(hl)}
					>
						{thread.subject}
					</Link>
					{digestSrc && <img src={digestSrc} alt="digest" className="shrink-0" />}
					<span className="shrink-0">
						<ThreadInlinePages
							threadId={thread.id}
							replies={thread.replies}
							postsPerPage={postsPerPage}
						/>
					</span>
				</div>

				{/* Column 2: Author (fixed, centered) */}
				<div className="flex flex-col items-center justify-center w-[100px] shrink-0 py-2 text-center">
					<UserPopover userId={thread.authorId}>
						<span className="block text-xs text-foreground font-medium hover:text-primary transition-colors truncate max-w-full cursor-pointer">
							{thread.authorName}
						</span>
					</UserPopover>
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
			<div className="sm:hidden px-3 py-2">
				{/* Row 1: Icon + avatar + badges + subject */}
				<div className="flex items-start gap-1.5">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={iconSrc} alt="" className="opacity-70 mt-0.5 shrink-0" />
					<Link href={`/users/${thread.authorId}`} prefetch={false} className="shrink-0 mt-0.5">
						<ForumAvatar
							userId={thread.authorId}
							userName={thread.authorName}
							avatarPath={thread.authorAvatarPath}
							size="xs"
						/>
					</Link>
					<div className="min-w-0 flex-1">
						{badges.length > 0 && (
							<div className="flex items-center gap-1.5">
								<ThreadBadgeList badges={badges} />
							</div>
						)}
						<div className="flex items-center gap-1.5">
							<Link
								href={`/threads/${thread.id}`}
								prefetch={false}
								className="min-w-0 truncate text-sm text-foreground hover:text-primary transition-colors"
								style={highlightStyle(hl)}
							>
								{thread.subject}
							</Link>
							{digestSrc && <img src={digestSrc} alt="digest" className="shrink-0" />}
							<span className="shrink-0">
								<ThreadInlinePages
									threadId={thread.id}
									replies={thread.replies}
									postsPerPage={postsPerPage}
								/>
							</span>
						</div>
					</div>
				</div>
				{/* Row 2: author · time · stats */}
				<div className="mt-1 ml-6 flex items-center gap-1.5 text-xs text-muted-foreground">
					<span className="min-w-0 truncate">
						<UserPopover userId={thread.authorId}>
							<span className="block truncate text-foreground hover:text-primary cursor-pointer">
								{thread.authorName}
							</span>
						</UserPopover>
					</span>
					<span className="shrink-0">·</span>
					<span className="shrink-0">{formatRelativeTime(thread.createdAt)}</span>
					<span className="shrink-0 ml-auto tabular-nums">
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
