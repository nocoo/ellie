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
		<div className="flex items-start gap-3 rounded-lg bg-secondary p-3 transition-colors hover:bg-accent">
			{/* Badges */}
			<ThreadBadgeList badges={badges} />

			{/* Content */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<Link
						href={`/threads/${thread.id}`}
						className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
						style={highlightStyle(hl)}
					>
						{thread.subject}
					</Link>
				</div>
				<div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
					<Link href={`/users/${thread.authorId}`} className="hover:text-primary transition-colors">
						{thread.authorName}
					</Link>
					<span>·</span>
					<span>{formatTime(thread.createdAt)}</span>
					{thread.lastPoster && (
						<>
							<span>·</span>
							<span>最后回复: {thread.lastPoster}</span>
						</>
					)}
				</div>
			</div>

			{/* Stats */}
			<div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground shrink-0">
				<span>{formatStat(thread.views)} 浏览</span>
				<span>{formatStat(thread.replies)} 回复</span>
			</div>
		</div>
	);
}
