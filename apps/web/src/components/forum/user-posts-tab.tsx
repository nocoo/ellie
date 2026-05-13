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
	// is supplied explicitly via `displayTime = post.createdAt` so the row
	// reflects when this user actually replied, without mutating the
	// thread's own `createdAt`.
	return (
		<div>
			{posts.items.map(({ post, thread }) => (
				<UserProfileListRow
					key={post.id}
					thread={thread}
					forumsById={forumsById}
					displayTime={post.createdAt}
				/>
			))}
		</div>
	);
}
