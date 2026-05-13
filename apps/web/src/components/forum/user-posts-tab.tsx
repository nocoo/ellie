// components/forum/user-posts-tab.tsx — Posts (reply history) tab for user profile page

import { ForumEmptyState } from "@/components/forum/empty-state";
import { UserProfileListRow } from "@/components/forum/user-profile-list-row";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";

export function UserPostsTab({
	posts,
	forumsById,
}: {
	posts: UserProfileData["posts"];
	forumsById: UserProfileData["forumsById"];
}) {
	if (posts.items.length === 0) {
		return <ForumEmptyState>暂无回复</ForumEmptyState>;
	}

	// Worker returns UserPostHistoryItem = { post, thread }. The shared row
	// renders the parent thread (title/forum/replies/views), and the *time*
	// uses the user's reply timestamp (post.createdAt) so the row reflects
	// when this user actually replied, not when the thread was created.
	return (
		<div>
			{posts.items.map(({ post, thread }) => (
				<UserProfileListRow
					key={post.id}
					thread={{ ...thread, createdAt: post.createdAt }}
					forumsById={forumsById}
					timeSource="created"
				/>
			))}
		</div>
	);
}
