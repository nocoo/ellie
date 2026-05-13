// components/forum/user-digest-tab.tsx — Digest threads tab for user profile page

import { ForumEmptyState } from "@/components/forum/empty-state";
import { UserProfileListRow } from "@/components/forum/user-profile-list-row";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";

export function UserDigestTab({
	digest,
	forumsById,
}: {
	digest: UserProfileData["digest"];
	forumsById: UserProfileData["forumsById"];
}) {
	if (digest.items.length === 0) {
		return <ForumEmptyState>暂无精华帖</ForumEmptyState>;
	}

	return (
		<div>
			{digest.items.map((thread) => (
				<UserProfileListRow
					key={thread.id}
					thread={thread}
					forumsById={forumsById}
					timeSource="created"
				/>
			))}
		</div>
	);
}
