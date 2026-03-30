// components/forum/thread-item.tsx — Single-line dense thread row
// Ref: 04f §6 — badges + title + author/time + stats on one line

import {
	type ThreadDisplayItem,
	formatStat,
	formatTime,
	highlightStyle,
} from "@/viewmodels/forum/thread-list";
import Link from "next/link";
import { ThreadBadgeList } from "./thread-badge";

interface ThreadItemProps {
	item: ThreadDisplayItem;
}

export function ThreadItem({ item }: ThreadItemProps) {
	const { thread, badges, highlight: hl } = item;

	return (
		<div className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50">
			{badges.length > 0 && <ThreadBadgeList badges={badges} />}
			<Link
				href={`/threads/${thread.id}`}
				className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
				style={highlightStyle(hl)}
			>
				{thread.subject}
			</Link>
			<div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground shrink-0">
				<Link href={`/users/${thread.authorId}`} className="hover:text-primary transition-colors">
					{thread.authorName}
				</Link>
				<span>·</span>
				<span>{formatTime(thread.createdAt)}</span>
			</div>
			<div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
				<span>{formatStat(thread.views)} 览</span>
				<span>{formatStat(thread.replies)} 回</span>
			</div>
		</div>
	);
}
