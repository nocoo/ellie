// components/forum/user-threads-tab.tsx — Threads tab for user profile page

import { ForumEmptyState } from "@/components/forum/empty-state";
import { UserThreadRow } from "@/components/forum/user-thread-row";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";

export function UserThreadsTab({
	threads,
}: {
	threads: UserProfileData["threads"];
}) {
	if (threads.items.length === 0) {
		return <ForumEmptyState>暂无发帖记录</ForumEmptyState>;
	}

	return (
		<div className="divide-y divide-border/50">
			{threads.items.map((thread) => (
				<UserThreadRow key={thread.id} thread={thread} timeSource="lastPost" />
			))}
		</div>
	);
}
