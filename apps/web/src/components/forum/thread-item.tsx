"use client";

// components/forum/thread-item.tsx — Discuz classic 4-column table row
// Columns: Icon | Subject | Author | Replies/Views | Last Post

import {
	type ThreadDisplayItem,
	formatStat,
	formatTime,
	getThreadIconSrc,
	highlightStyle,
} from "@/viewmodels/forum/thread-list";
import Link from "next/link";
import { ThreadBadgeList } from "./thread-badge";
import { UserPopover } from "./user-popover";

interface ThreadItemProps {
	item: ThreadDisplayItem;
}

export function ThreadItem({ item }: ThreadItemProps) {
	const { thread, badges, highlight: hl } = item;

	return (
		<div className="flex items-center border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50">
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

			{/* Column 2: Author (fixed) - primary info */}
			<div className="hidden sm:flex flex-col items-center justify-center w-[100px] shrink-0 py-2 text-center">
				<UserPopover userId={thread.authorId}>
					<span className="text-2xs text-foreground font-medium hover:text-primary transition-colors truncate max-w-full cursor-pointer">
						{thread.authorName}
					</span>
				</UserPopover>
				<span className="text-2xs text-muted-foreground">{formatTime(thread.createdAt)}</span>
			</div>

			{/* Column 3: Replies / Views (fixed) - replies primary, views secondary */}
			<div className="hidden sm:flex flex-col items-center justify-center w-[80px] shrink-0 py-2 text-center tabular-nums">
				<span className="text-2xs text-foreground font-medium">{formatStat(thread.replies)}</span>
				<span className="text-2xs text-muted-foreground">{formatStat(thread.views)}</span>
			</div>

			{/* Column 4: Last Post (fixed) - author primary, time secondary */}
			<div className="hidden sm:flex flex-col items-center justify-center w-[120px] shrink-0 py-2 text-center">
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
					{thread.lastPostAt ? formatTime(thread.lastPostAt) : "-"}
				</span>
			</div>
		</div>
	);
}
