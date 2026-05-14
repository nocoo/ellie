// components/forum/user-posts-tab.tsx — Posts (reply history) tab for user profile page

import { ForumEmptyState } from "@/components/forum/empty-state";
import {
	UserProfileListHeader,
	UserProfileListRow,
} from "@/components/forum/user-profile-list-row";
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
	// Partially-deployed environment ERROR state: the deployed Worker still
	// returns the old `Post[]` shape (without joined thread columns), so we
	// can't render the forum-list row at all. Show a clear error — not a
	// fake empty/"暂不可用" — so it's obvious this is a deployment problem,
	// not a "user has no replies" outcome. Pagination is suppressed upstream
	// in this state. Scoped to THIS tab only so the rest of the profile page
	// (hero/stats/主题/精华) stays usable while Worker catches up.
	if (postsShape === "legacy") {
		return (
			<div
				role="alert"
				className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm text-destructive"
				data-testid="posts-legacy-error"
			>
				回复列表加载失败：Worker 接口未同步至新数据形态，请先部署后端更新
			</div>
		);
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
			<UserProfileListHeader />
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
