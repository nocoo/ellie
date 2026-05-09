"use client";

// components/forum/thread-item.tsx — Discuz classic thread row
// Desktop: 4-column table layout (Icon | Subject | Author | Stats | Last Post)
// Mobile: 2-row compact layout (Icon + badges + subject on row 1, stats inline on row 2)

import { type ThreadDisplayItem, highlightStyle } from "@/viewmodels/forum/thread-list";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import Image from "next/image";
import Link from "next/link";
import { ThreadBadgeList } from "./thread-badge";
import { ThreadLastPostCell } from "./thread-last-post-cell";
import { ThreadRowStats } from "./thread-row-stats";
import { ForumAvatar } from "./user-avatar";
import { UserPopover } from "./user-popover";

interface ThreadItemProps {
	item: ThreadDisplayItem;
}

export function ThreadItem({ item }: ThreadItemProps) {
	const { thread, badges, highlight: hl, iconSrc } = item;

	return (
		<div className="border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset">
			{/* Desktop layout: single row with columns */}
			<div className="hidden sm:flex items-center">
				{/* Thread icon column */}
				<div className="flex items-center justify-center w-[36px] shrink-0 pl-2">
					<Image src={iconSrc} alt="" width={16} height={16} className="opacity-70" unoptimized />
				</div>

				{/* Column 1: Subject (flex) */}
				<div className="min-w-0 flex-1 flex items-center gap-2 py-2 px-3">
					{badges.length > 0 && <ThreadBadgeList badges={badges} />}
					<Link
						href={`/threads/${thread.id}`}
						prefetch={false}
						className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
						style={highlightStyle(hl)}
					>
						{thread.subject}
					</Link>
				</div>

				{/* Column 2: Author (fixed, left-aligned with avatar) */}
				<div className="flex items-center gap-1.5 w-[120px] shrink-0 py-2 px-2">
					<Link href={`/users/${thread.authorId}`} prefetch={false} className="shrink-0">
						<ForumAvatar
							userId={thread.authorId}
							userName={thread.authorName}
							avatarPath={thread.authorAvatarPath}
							shadow
						/>
					</Link>
					<div className="min-w-0">
						<UserPopover userId={thread.authorId}>
							<span className="text-xs text-foreground font-medium hover:text-primary transition-colors truncate block max-w-full cursor-pointer">
								{thread.authorName}
							</span>
						</UserPopover>
						<span className="text-xs text-muted-foreground">
							{formatRelativeTime(thread.createdAt)}
						</span>
					</div>
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
				{/* Row 1: Icon + badges + subject */}
				<div className="flex items-start gap-2">
					<Image
						src={iconSrc}
						alt=""
						width={14}
						height={14}
						className="opacity-70 mt-0.5 shrink-0"
						unoptimized
					/>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							{badges.length > 0 && <ThreadBadgeList badges={badges} />}
						</div>
						<Link
							href={`/threads/${thread.id}`}
							prefetch={false}
							className="block truncate text-sm text-foreground hover:text-primary transition-colors"
							style={highlightStyle(hl)}
						>
							{thread.subject}
						</Link>
					</div>
				</div>
				{/* Row 2: avatar · author · time · stats */}
				<div className="mt-1 ml-6 flex items-center gap-1.5 text-xs text-muted-foreground">
					<Link href={`/users/${thread.authorId}`} prefetch={false} className="shrink-0">
						<ForumAvatar
							userId={thread.authorId}
							userName={thread.authorName}
							avatarPath={thread.authorAvatarPath}
							size="xs"
						/>
					</Link>
					<UserPopover userId={thread.authorId}>
						<span className="min-w-0 truncate text-foreground hover:text-primary cursor-pointer">
							{thread.authorName}
						</span>
					</UserPopover>
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
