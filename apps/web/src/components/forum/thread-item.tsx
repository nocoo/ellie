"use client";

// components/forum/thread-item.tsx — Discuz classic thread row
// Desktop: 4-column table layout (Icon | Subject | Author | Stats | Last Post)
// Mobile: 2-row compact layout (Subject + badges on row 1, stats inline on row 2)

import {
	type ThreadDisplayItem,
	getThreadIconSrc,
	highlightStyle,
} from "@/viewmodels/forum/thread-list";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import Link from "next/link";
import { ThreadBadgeList } from "./thread-badge";
import { UserPopover } from "./user-popover";

interface ThreadItemProps {
	item: ThreadDisplayItem;
}

export function ThreadItem({ item }: ThreadItemProps) {
	const { thread, badges, highlight: hl } = item;

	return (
		<div className="border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset">
			{/* Desktop layout: single row with columns */}
			<div className="hidden sm:flex items-center">
				{/* Icon column */}
				<div className="flex items-center justify-center w-[28px] shrink-0 pl-2">
					<img src={getThreadIconSrc(thread)} alt="" className="h-4 w-auto" aria-hidden="true" />
				</div>

				{/* Column 1: Subject (flex) */}
				<div className="min-w-0 flex-1 flex items-center gap-2 py-2 px-3">
					{badges.length > 0 && <ThreadBadgeList badges={badges} />}
					<Link
						href={`/threads/${thread.id}`}
						className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
						style={highlightStyle(hl)}
					>
						{thread.subject}
					</Link>
				</div>

				{/* Column 2: Author (fixed) */}
				<div className="flex flex-col items-center justify-center w-[100px] shrink-0 py-2 text-center">
					<UserPopover userId={thread.authorId}>
						<span className="text-2xs text-foreground font-medium hover:text-primary transition-colors truncate max-w-full cursor-pointer">
							{thread.authorName}
						</span>
					</UserPopover>
					<span className="text-2xs text-muted-foreground">{formatRelativeTime(thread.createdAt)}</span>
				</div>

				{/* Column 3: Replies / Views (fixed) */}
				<div className="flex flex-col items-center justify-center w-[80px] shrink-0 py-2 text-center tabular-nums">
					<span className="text-2xs text-foreground font-medium">{formatCompactNumber(thread.replies)}</span>
					<span className="text-2xs text-muted-foreground">{formatCompactNumber(thread.views)}</span>
				</div>

				{/* Column 4: Last Post (fixed) */}
				<div className="flex flex-col items-center justify-center w-[120px] shrink-0 py-2 text-center">
					{thread.lastPosterId > 0 ? (
						<UserPopover userId={thread.lastPosterId}>
							<span className="text-2xs text-foreground font-medium truncate max-w-full hover:text-primary transition-colors cursor-pointer">
								{thread.lastPoster || "-"}
							</span>
						</UserPopover>
					) : (
						<span className="text-2xs text-muted-foreground truncate max-w-full">
							{thread.lastPoster || "-"}
						</span>
					)}
					<span className="text-2xs text-muted-foreground">
						{thread.lastPostAt ? formatRelativeTime(thread.lastPostAt) : "-"}
					</span>
				</div>
			</div>

			{/* Mobile layout: two-row compact display */}
			<div className="sm:hidden px-3 py-2">
				{/* Row 1: badges + subject */}
				<div className="flex items-center gap-2">
					{badges.length > 0 && <ThreadBadgeList badges={badges} />}
					<Link
						href={`/threads/${thread.id}`}
						className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
						style={highlightStyle(hl)}
					>
						{thread.subject}
					</Link>
				</div>
				{/* Row 2: author · time · replies/views */}
				<div className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
					<UserPopover userId={thread.authorId}>
						<span className="text-foreground hover:text-primary cursor-pointer">
							{thread.authorName}
						</span>
					</UserPopover>
					<span>·</span>
					<span>{formatRelativeTime(thread.createdAt)}</span>
					<span className="ml-auto tabular-nums">
						{formatCompactNumber(thread.replies)} 回 / {formatCompactNumber(thread.views)} 览
					</span>
				</div>
			</div>
		</div>
	);
}
