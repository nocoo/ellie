// components/forum/digest-card.tsx — Digest thread row with enhanced visual
// Desktop: 4-column layout (Avatar+Title | Author | Stats | Last Reply)
// Includes digest level border color, highlight-styled title, and recommends

import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import type { Thread, ThreadBadge } from "@ellie/types";
import { decodeHighlight } from "@ellie/types";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ThreadLastPostCell } from "./thread-last-post-cell";
import { ThreadRowStats } from "./thread-row-stats";
import { ForumAvatar } from "./user-avatar";
import { UserPopover } from "./user-popover";

interface DigestCardProps {
	thread: Thread;
	badges: ThreadBadge[];
}

/** Get border color class based on digest level */
function getDigestBorderClass(digest: number): string {
	switch (digest) {
		case 3:
			return "border-l-forum-accent"; // Gold-equivalent (forum accent) for level III
		case 2:
			return "border-l-primary"; // Blue-equivalent (primary) for level II
		default:
			return "border-l-success"; // Green for level I
	}
}

/** Build inline style for highlight-styled title */
function getTitleStyle(highlight: number): CSSProperties | undefined {
	const style = decodeHighlight(highlight);
	if (!style) return undefined;

	const css: CSSProperties = {};
	if (style.color) css.color = style.color;
	if (style.bold) css.fontWeight = 600;
	if (style.italic) css.fontStyle = "italic";
	if (style.underline) css.textDecoration = "underline";

	return Object.keys(css).length > 0 ? css : undefined;
}

export function DigestCard({ thread, badges }: DigestCardProps) {
	const borderClass = getDigestBorderClass(thread.digest);
	const titleStyle = getTitleStyle(thread.highlight);
	// Three branches, mutually exclusive:
	//   isAnonAuthor   — anonymous=1 + authorId=0  → "匿名"
	//   isOrphanAuthor — anonymous=0 + authorId=0  → "未知用户" (placeholder/
	//                    tombstoned author; no /users/0 link, no popover)
	//   default        — real authorId>0 → normal profile link
	const isAnonAuthor = thread.anonymousAuthor === 1 && thread.authorId === 0;
	const isOrphanAuthor = !isAnonAuthor && thread.authorId === 0;

	return (
		<div
			className={`border-l-4 ${borderClass} border-b border-border/50 last:border-b-0 transition-colors hover:bg-accent/50`}
		>
			{/* Desktop layout: multi-column */}
			<div className="hidden sm:flex items-center">
				{/* Column 1: Avatar + Title (flex) */}
				<div className="min-w-0 flex-1 flex items-center gap-3 py-2 px-3">
					{isAnonAuthor || isOrphanAuthor ? (
						<div className="shrink-0">
							<ForumAvatar
								userId={0}
								userName={isAnonAuthor ? "匿名" : "未知用户"}
								avatarPath=""
								shadow
							/>
						</div>
					) : (
						<Link href={`/users/${thread.authorId}`} prefetch={false} className="shrink-0">
							<ForumAvatar
								userId={thread.authorId}
								userName={thread.authorName}
								avatarPath={thread.authorAvatarPath}
								shadow
							/>
						</Link>
					)}
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							{badges.length > 0 && <ThreadBadgeList badges={badges} />}
							<Link
								href={`/threads/${thread.id}`}
								prefetch={false}
								className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
								style={titleStyle}
							>
								{thread.subject}
							</Link>
						</div>
					</div>
				</div>

				{/* Column 2: Author + Time (fixed) */}
				<div className="flex flex-col items-center justify-center w-[100px] shrink-0 py-2 text-center">
					{isAnonAuthor ? (
						<span className="text-xs text-muted-foreground font-medium truncate max-w-full">
							匿名
						</span>
					) : isOrphanAuthor ? (
						<span className="text-xs text-muted-foreground font-medium truncate max-w-full">
							未知用户
						</span>
					) : (
						<UserPopover userId={thread.authorId}>
							<span className="text-xs text-foreground font-medium hover:text-primary transition-colors truncate max-w-full cursor-pointer">
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

				{/* Column 4: Last Reply (fixed) */}
				<ThreadLastPostCell
					lastPosterId={thread.lastPosterId}
					lastPoster={thread.lastPoster}
					lastPostAt={thread.lastPostAt}
					className="pr-3"
				/>
			</div>

			{/* Mobile layout: compact two-row */}
			<div className="sm:hidden px-3 py-2">
				{/* Row 1: Avatar + badges + subject */}
				<div className="flex items-center gap-2">
					{isAnonAuthor || isOrphanAuthor ? (
						<div className="shrink-0">
							<ForumAvatar userId={0} userName={isAnonAuthor ? "匿名" : "未知用户"} avatarPath="" />
						</div>
					) : (
						<Link href={`/users/${thread.authorId}`} prefetch={false} className="shrink-0">
							<ForumAvatar
								userId={thread.authorId}
								userName={thread.authorName}
								avatarPath={thread.authorAvatarPath}
							/>
						</Link>
					)}
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							{badges.length > 0 && <ThreadBadgeList badges={badges} />}
						</div>
						<Link
							href={`/threads/${thread.id}`}
							prefetch={false}
							className="block truncate text-sm text-foreground hover:text-primary transition-colors"
							style={titleStyle}
						>
							{thread.subject}
						</Link>
					</div>
				</div>
				{/* Row 2: author · time · stats */}
				<div className="mt-1 ml-8 flex items-center gap-1.5 text-xs text-muted-foreground">
					{isAnonAuthor ? (
						<span className="text-muted-foreground">匿名</span>
					) : isOrphanAuthor ? (
						<span className="text-muted-foreground">未知用户</span>
					) : (
						<UserPopover userId={thread.authorId}>
							<span className="text-foreground hover:text-primary cursor-pointer">
								{thread.authorName}
							</span>
						</UserPopover>
					)}
					<span>·</span>
					<span>{formatRelativeTime(thread.createdAt)}</span>
					<span className="ml-auto tabular-nums">
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
