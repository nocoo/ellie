// components/forum/user-digest-tab.tsx — Digest threads tab for user profile page

import { ForumEmptyState } from "@/components/forum/empty-state";
import { UserThreadRow } from "@/components/forum/user-thread-row";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";

export function UserDigestTab({
	digest,
}: {
	digest: UserProfileData["digest"];
}) {
	if (digest.items.length === 0) {
		return <ForumEmptyState>暂无精华帖</ForumEmptyState>;
	}

	return (
		<div className="divide-y divide-border/50">
			{digest.items.map((thread) => (
				<UserThreadRow key={thread.id} thread={thread} showStats timeSource="created" />
			))}
		</div>
	);
}
