// components/forum/digest-card.tsx — Digest thread row with enhanced visual
// Desktop: 4-column layout (Avatar+Title | Author | Stats | Last Reply)
// Includes digest level border color, highlight-styled title, and recommends

import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import type { Thread, ThreadBadge } from "@ellie/types";
import { decodeHighlight } from "@ellie/types";
import { Heart } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
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
			return "border-l-amber-500"; // Gold for level III
		case 2:
			return "border-l-blue-500"; // Blue for level II
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

	return (
		<div
			className={`border-l-4 ${borderClass} border-b border-border/50 last:border-b-0 transition-colors hover:bg-accent/50`}
		>
			{/* Desktop layout: multi-column */}
			<div className="hidden sm:flex items-center">
				{/* Column 1: Avatar + Title (flex) */}
				<div className="min-w-0 flex-1 flex items-center gap-3 py-2 px-3">
					<Link href={`/users/${thread.authorId}`} className="shrink-0">
						<ForumAvatar
							userId={thread.authorId}
							userName={thread.authorName}
							avatarPath={thread.authorAvatarPath}
							shadow
						/>
					</Link>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							{badges.length > 0 && <ThreadBadgeList badges={badges} />}
							<Link
								href={`/threads/${thread.id}`}
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

				{/* Column 4: Last Reply (fixed) */}
				<div className="flex flex-col items-center justify-center w-[120px] shrink-0 py-2 pr-3 text-center">
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

			{/* Mobile layout: compact two-row */}
			<div className="sm:hidden px-3 py-2">
				{/* Row 1: Avatar + badges + subject */}
				<div className="flex items-center gap-2">
					<Link href={`/users/${thread.authorId}`} className="shrink-0">
						<ForumAvatar
							userId={thread.authorId}
							userName={thread.authorName}
							avatarPath={thread.authorAvatarPath}
						/>
					</Link>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							{badges.length > 0 && <ThreadBadgeList badges={badges} />}
						</div>
						<Link
							href={`/threads/${thread.id}`}
							className="block truncate text-sm text-foreground hover:text-primary transition-colors"
							style={titleStyle}
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
