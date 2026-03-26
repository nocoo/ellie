// (forum)/users/[id]/page.tsx — User profile page
// Ref: 04d §用户主页 — user info + tabs (threads/posts)
//
// Server component: fetches user profile and recent activity.

import { UserAvatar } from "@/components/user-avatar";
import {
	fetchUserPosts,
	fetchUserProfile,
	fetchUserThreads,
} from "@/viewmodels/forum/user-profile";
import { createRepositories } from "@ellie/repositories";
import Link from "next/link";
import { notFound } from "next/navigation";

interface PageProps {
	params: Promise<{ id: string }>;
}

export default async function UserProfilePage({ params }: PageProps) {
	const { id } = await params;
	const userId = Number(id);
	const repos = createRepositories();
	const data = await fetchUserProfile(repos, userId);

	if (!data) notFound();

	const { user, roleLabel, statusLabel } = data;

	// Fetch recent activity
	const [threadsResult, postsResult] = await Promise.all([
		fetchUserThreads(repos, userId, { limit: 10 }),
		fetchUserPosts(repos, userId, { limit: 10 }),
	]);

	return (
		<div className="space-y-4">
			{/* User info card */}
			<div className="rounded-[14px] bg-card p-6">
				<div className="flex items-start gap-4">
					<UserAvatar avatar={user.avatar} username={user.username} size="lg" />
					<div>
						<h1 className="text-2xl font-bold">{user.username}</h1>
						<div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
							<span>Role: {roleLabel}</span>
							<span>Status: {statusLabel}</span>
						</div>
						<div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
							<span>Threads: {user.threads}</span>
							<span>Posts: {user.posts}</span>
							<span>Credits: {user.credits}</span>
						</div>
					</div>
				</div>
			</div>

			{/* Recent threads */}
			<div className="rounded-[14px] bg-card p-6">
				<h2 className="mb-3 text-lg font-semibold">Recent Threads</h2>
				{threadsResult.items.length === 0 ? (
					<p className="text-sm text-muted-foreground">No threads yet.</p>
				) : (
					<ul className="space-y-2">
						{threadsResult.items.map((thread) => (
							<li key={thread.id} className="flex items-center justify-between text-sm">
								<Link href={`/threads/${thread.id}`} className="truncate hover:underline">
									{thread.subject}
								</Link>
								<span className="shrink-0 text-xs text-muted-foreground">
									{thread.replies} replies
								</span>
							</li>
						))}
					</ul>
				)}
			</div>

			{/* Recent posts */}
			<div className="rounded-[14px] bg-card p-6">
				<h2 className="mb-3 text-lg font-semibold">Recent Posts</h2>
				{postsResult.items.length === 0 ? (
					<p className="text-sm text-muted-foreground">No posts yet.</p>
				) : (
					<ul className="space-y-2">
						{postsResult.items.map((post) => (
							<li key={post.id} className="text-sm">
								<Link href={`/threads/${post.threadId}`} className="block truncate hover:underline">
									{post.content.slice(0, 100)}
									{post.content.length > 100 ? "..." : ""}
								</Link>
								<span className="text-xs text-muted-foreground">in thread #{post.threadId}</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
