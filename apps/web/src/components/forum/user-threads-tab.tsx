// components/forum/user-threads-tab.tsx — Threads tab for user profile page

import { ForumEmptyState } from "@/components/forum/empty-state";
import { UserProfileListRow } from "@/components/forum/user-profile-list-row";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";

export function UserThreadsTab({
	threads,
	forumsById,
}: {
	threads: UserProfileData["threads"];
	forumsById: UserProfileData["forumsById"];
}) {
	if (threads.items.length === 0) {
		return <ForumEmptyState>暂无主题</ForumEmptyState>;
	}

	return (
		<div>
			{threads.items.map((thread) => (
				<UserProfileListRow
					key={thread.id}
					thread={thread}
					forumsById={forumsById}
					timeSource="lastPost"
				/>
			))}
		</div>
	);
}
