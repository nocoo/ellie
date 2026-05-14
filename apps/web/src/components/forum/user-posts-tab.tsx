// components/forum/user-posts-tab.tsx — Posts (reply history) tab for user profile page

import { ForumEmptyState } from "@/components/forum/empty-state";
import { UserProfileListRow } from "@/components/forum/user-profile-list-row";
import { isUserPostHistoryItem } from "@/viewmodels/forum/user-profile";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";

export function UserPostsTab({
	posts,
	postsShape,
	forumsById,
}: {
	posts: UserProfileData["posts"];
	postsShape: UserProfileData["postsShape"];
	forumsById: UserProfileData["forumsById"];
}) {
	// Partially-deployed environment safeguard: the deployed Worker still
	// returns the old `Post[]` shape, so we cannot render the thread-derived
	// row (title/forum/replies/views). Pagination is also suppressed upstream
	// in this state to avoid claiming there are pages the user can't see.
	if (postsShape === "legacy") {
		return <ForumEmptyState>回复列表暂不可用：后端接口待升级后显示</ForumEmptyState>;
	}

	if (posts.items.length === 0) {
		return <ForumEmptyState>暂无回复</ForumEmptyState>;
	}

	// Worker returns UserPostHistoryItem = { post, thread }. The shared row
	// renders the parent thread (title/forum/replies/views), and the *time*
	// is supplied explicitly via `displayTime = post.createdAt` so the row
	// reflects when this user actually replied, without mutating the
	// thread's own `createdAt`.
	//
	// Per-item defense: reuse the same `isUserPostHistoryItem` guard the
	// server loader uses so the component only renders items that have all
	// fields `UserProfileListRow` actually reads (replies/views/lastPostAt/
	// badges). A partial payload that slips through (e.g. stale cache) is
	// skipped instead of crashing the row with a TypeError on missing fields.
	return (
		<div>
			{posts.items.map((item) => {
				if (!isUserPostHistoryItem(item)) return null;
				return (
					<UserProfileListRow
						key={item.post.id}
						thread={item.thread}
						forumsById={forumsById}
						displayTime={item.post.createdAt}
					/>
				);
			})}
		</div>
	);
}
