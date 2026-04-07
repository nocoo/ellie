// components/forum/user-digest-tab.tsx — Digest threads tab for user profile page

import { ThreadBadgeList } from "@/components/forum/thread-badge";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import { getThreadBadges } from "@ellie/types";
import Link from "next/link";

export function UserDigestTab({
	digest,
}: {
	digest: UserProfileData["digest"];
}) {
	if (digest.items.length === 0) {
		return <div className="py-8 text-center text-sm text-muted-foreground">暂无精华帖</div>;
	}

	return (
		<div className="divide-y divide-border/50">
			{digest.items.map((thread) => {
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
						<div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
							<span>{formatCompactNumber(thread.views)} 览</span>
							<span>{formatCompactNumber(thread.replies)} 回</span>
						</div>
						<span className="text-xs text-muted-foreground shrink-0">
							{formatRelativeTime(thread.createdAt)}
						</span>
					</div>
				);
			})}
		</div>
	);
}
