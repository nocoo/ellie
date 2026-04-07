// components/forum/user-threads-tab.tsx — Threads tab for user profile page

import { ThreadBadgeList } from "@/components/forum/thread-badge";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import { getThreadBadges } from "@ellie/types";
import Link from "next/link";

export function UserThreadsTab({
	threads,
}: {
	threads: UserProfileData["threads"];
}) {
	if (threads.items.length === 0) {
		return <div className="py-8 text-center text-sm text-muted-foreground">暂无发帖记录</div>;
	}

	return (
		<div className="divide-y divide-border/50">
			{threads.items.map((thread) => {
				const badges = getThreadBadges(thread);
				return (
					<div key={thread.id} className="flex items-center gap-2 py-1.5">
						{badges.length > 0 && <ThreadBadgeList badges={badges} />}
						<Link
							href={`/threads/${thread.id}`}
							className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary transition-colors"
						>
							{thread.subject}
						</Link>
						<span className="text-xs text-muted-foreground shrink-0">
							{formatRelativeTime(thread.lastPostAt ?? thread.createdAt)}
						</span>
					</div>
				);
			})}
		</div>
	);
}
