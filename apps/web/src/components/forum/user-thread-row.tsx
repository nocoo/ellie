// components/forum/user-thread-row.tsx — Shared thread row for user profile tabs

import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import type { Thread } from "@ellie/types";
import { getThreadBadges } from "@ellie/types";
import Link from "next/link";

interface UserThreadRowProps {
	thread: Thread;
	/** Show views/replies stats column. Default false. */
	showStats?: boolean;
	/** Which timestamp to display. Default "lastPost" (falls back to createdAt). */
	timeSource?: "created" | "lastPost";
}

/** Compact single-row thread link used in user profile tabs. */
export function UserThreadRow({
	thread,
	showStats = false,
	timeSource = "lastPost",
}: UserThreadRowProps) {
	const badges = getThreadBadges(thread);
	const time =
		timeSource === "created" ? thread.createdAt : (thread.lastPostAt ?? thread.createdAt);

	return (
		<div className="flex items-center gap-2 py-1.5">
			{badges.length > 0 && <ThreadBadgeList badges={badges} />}
			<Link
				href={`/threads/${thread.id}`}
				className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
			>
				{thread.subject}
			</Link>
			{showStats && (
				<div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
					<span>{formatCompactNumber(thread.views)} 览</span>
					<span>{formatCompactNumber(thread.replies)} 回</span>
				</div>
			)}
			<span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(time)}</span>
		</div>
	);
}
