"use client";

// components/forum/thread-item.tsx — Discuz classic thread row
// Desktop: 4-column table layout (Avatar | Subject | Author | Stats | Last Post)
// Mobile: 2-row compact layout (Avatar + badges + subject on row 1, stats inline on row 2)

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { type ThreadDisplayItem, highlightStyle } from "@/viewmodels/forum/thread-list";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import { Heart } from "lucide-react";
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
				{/* Avatar column */}
				<div className="flex items-center justify-center w-[36px] shrink-0 pl-2">
					<Link href={`/users/${thread.authorId}`} className="shrink-0">
						<Avatar size="sm" className="rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.1)]">
							<AvatarImage
								src={getAvatarUrl(thread.authorId, "small")}
								alt={thread.authorName}
								className="rounded-sm"
							/>
							<AvatarFallback className="text-xs rounded-sm bg-muted p-0 overflow-hidden">
								<img
									src={getStaticImageUrl("tavatar.gif")}
									alt=""
									className="h-full w-full object-cover"
								/>
							</AvatarFallback>
						</Avatar>
					</Link>
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
						<span className="text-xs text-foreground font-medium hover:text-primary transition-colors truncate max-w-full cursor-pointer">
							{thread.authorName}
						</span>
					</UserPopover>
					<span className="text-xs text-muted-foreground">
						{formatRelativeTime(thread.createdAt)}
					</span>
				</div>

				{/* Column 3: Replies / Views / Recommends (fixed) */}
				<div className="flex flex-col items-center justify-center w-[80px] shrink-0 py-2 text-center tabular-nums">
					<span className="text-xs text-foreground font-medium">
						{formatCompactNumber(thread.replies)} / {formatCompactNumber(thread.views)}
					</span>
					{thread.recommends > 0 ? (
						<span className="inline-flex items-center gap-0.5 text-xs text-rose-500">
							<Heart className="h-3 w-3 fill-current" />
							{formatCompactNumber(thread.recommends)}
						</span>
					) : (
						<span className="text-xs text-muted-foreground">回/览</span>
					)}
				</div>

				{/* Column 4: Last Post (fixed) */}
				<div className="flex flex-col items-center justify-center w-[120px] shrink-0 py-2 text-center">
					{thread.lastPosterId > 0 ? (
						<UserPopover userId={thread.lastPosterId}>
							<span className="text-xs text-foreground font-medium truncate max-w-full hover:text-primary transition-colors cursor-pointer">
								{thread.lastPoster || "-"}
							</span>
						</UserPopover>
					) : (
						<span className="text-xs text-muted-foreground truncate max-w-full">
							{thread.lastPoster || "-"}
						</span>
					)}
					<span className="text-xs text-muted-foreground">
						{thread.lastPostAt ? formatRelativeTime(thread.lastPostAt) : "-"}
					</span>
				</div>
			</div>

			{/* Mobile layout: two-row compact display */}
			<div className="sm:hidden px-3 py-2">
				{/* Row 1: Avatar + badges + subject */}
				<div className="flex items-center gap-2">
					<Link href={`/users/${thread.authorId}`} className="shrink-0">
						<Avatar size="sm" className="rounded-sm">
							<AvatarImage
								src={getAvatarUrl(thread.authorId, "small")}
								alt={thread.authorName}
								className="rounded-sm"
							/>
							<AvatarFallback className="text-xs rounded-sm bg-muted p-0 overflow-hidden">
								<img
									src={getStaticImageUrl("tavatar.gif")}
									alt=""
									className="h-full w-full object-cover"
								/>
							</AvatarFallback>
						</Avatar>
					</Link>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							{badges.length > 0 && <ThreadBadgeList badges={badges} />}
						</div>
						<Link
							href={`/threads/${thread.id}`}
							className="block truncate text-sm text-foreground hover:text-primary transition-colors"
							style={highlightStyle(hl)}
						>
							{thread.subject}
						</Link>
					</div>
				</div>
				{/* Row 2: author · time · stats */}
				<div className="mt-1 ml-8 flex items-center gap-1.5 text-xs text-muted-foreground">
					<UserPopover userId={thread.authorId}>
						<span className="text-foreground hover:text-primary cursor-pointer">
							{thread.authorName}
						</span>
					</UserPopover>
					<span>·</span>
					<span>{formatRelativeTime(thread.createdAt)}</span>
					<span className="ml-auto tabular-nums">
						{formatCompactNumber(thread.replies)} 回 / {formatCompactNumber(thread.views)} 览
						{thread.recommends > 0 && (
							<span className="inline-flex items-center gap-0.5 ml-1.5 text-rose-500">
								<Heart className="h-3 w-3 fill-current" />
								{formatCompactNumber(thread.recommends)}
							</span>
						)}
					</span>
				</div>
			</div>
		</div>
	);
}
