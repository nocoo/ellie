// components/forum/user-posts-tab.tsx — Posts tab for user profile page

import { ForumEmptyState } from "@/components/forum/empty-state";
import type { UserProfileData } from "@/viewmodels/forum/user-profile.server";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import Link from "next/link";

export function UserPostsTab({
	posts,
}: {
	posts: UserProfileData["posts"];
}) {
	if (posts.items.length === 0) {
		return <ForumEmptyState>暂无回复（Worker v1 尚不支持按用户查询历史）</ForumEmptyState>;
	}

	return (
		<div className="divide-y divide-border/50">
			{posts.items.map((post) => (
				<div key={post.id} className="py-2">
					<Link
						href={`/threads/${post.threadId}`}
						prefetch={false}
						className="text-xs text-muted-foreground hover:text-primary transition-colors"
					>
						回复主题 #{post.threadId}
					</Link>
					<p className="mt-0.5 text-sm text-foreground line-clamp-2">
						{post.content.replace(/<[^>]*>/g, "").slice(0, 200)}
					</p>
					<span className="text-xs text-muted-foreground">
						{formatRelativeTime(post.createdAt)}
					</span>
				</div>
			))}
		</div>
	);
}
