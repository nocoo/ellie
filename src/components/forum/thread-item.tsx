// components/forum/thread-item.tsx — Single thread row in thread list
// Ref: 04d §ThreadItem — title + badges + author + stats

import type { HighlightStyle } from "@/models/thread";
import type { ThreadBadge as ThreadBadgeType } from "@/models/thread";
import type { Thread } from "@/models/types";
import { Eye, MessageSquare } from "lucide-react";
import Link from "next/link";
import { formatCount, formatRelativeTime } from "./forum-card";
import { ThreadBadge } from "./thread-badge";

export interface ThreadItemProps {
	thread: Thread;
	badges: ThreadBadgeType[];
	highlightStyle: HighlightStyle | null;
}

/**
 * Convert HighlightStyle to inline CSS.
 * Pure function, exported for testing.
 */
export function highlightToStyle(hl: HighlightStyle | null): React.CSSProperties {
	if (!hl) return {};
	const style: React.CSSProperties = {};
	if (hl.color) style.color = hl.color;
	if (hl.bold) style.fontWeight = "bold";
	if (hl.italic) style.fontStyle = "italic";
	if (hl.underline) style.textDecoration = "underline";
	return style;
}

export function ThreadItem({ thread, badges, highlightStyle }: ThreadItemProps) {
	return (
		<div className="flex items-start gap-3 rounded-[10px] bg-secondary px-4 py-3">
			<div className="min-w-0 flex-1">
				{/* Title + badges */}
				<div className="flex flex-wrap items-center gap-1.5">
					{badges.map((badge) => (
						<ThreadBadge key={`${badge.type}-${badge.label}`} badge={badge} />
					))}
					<Link
						href={`/threads/${thread.id}`}
						className="font-medium hover:text-primary transition-colors"
						style={highlightToStyle(highlightStyle)}
					>
						{thread.subject}
					</Link>
				</div>

				{/* Meta */}
				<div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
					<span>
						by{" "}
						<Link
							href={`/users/${thread.authorId}`}
							className="hover:text-foreground transition-colors"
						>
							{thread.authorName}
						</Link>
					</span>
					{thread.lastPoster && (
						<span>
							latest by {thread.lastPoster} {formatRelativeTime(thread.lastPostAt)}
						</span>
					)}
				</div>
			</div>

			{/* Stats */}
			<div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
				<span className="flex items-center gap-1">
					<Eye className="h-3.5 w-3.5" />
					{formatCount(thread.views)}
				</span>
				<span className="flex items-center gap-1">
					<MessageSquare className="h-3.5 w-3.5" />
					{formatCount(thread.replies)}
				</span>
			</div>
		</div>
	);
}
