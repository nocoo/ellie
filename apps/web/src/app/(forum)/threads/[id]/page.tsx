// (forum)/threads/[id]/page.tsx — Thread detail page
// Ref: 04d §帖子详情 — thread + posts + attachments + reply

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ForumPagination } from "@/components/forum-pagination";
import { PostCard } from "@/components/forum/post-card";
import { ThreadBadge } from "@/components/forum/thread-badge";
import { ThreadReplyForm } from "@/components/forum/thread-reply-form";
import { fetchThreadDetail } from "@/viewmodels/forum/thread-detail";
import { createRepositories } from "@ellie/repositories";
import { notFound } from "next/navigation";

interface PageProps {
	params: Promise<{ id: string }>;
}

/**
 * Thread detail page — server component.
 * Displays thread metadata, badges, and paginated post list.
 */
export default async function ThreadDetailPage({ params }: PageProps) {
	const { id } = await params;
	const threadId = Number(id);
	const repos = createRepositories();
	const data = await fetchThreadDetail(repos, threadId);

	if (!data) notFound();

	const breadcrumbs = [
		...(data.forum ? [{ label: data.forum.name, href: `/forums/${data.forum.id}` }] : []),
		{ label: data.thread.subject },
	];

	return (
		<div className="space-y-4">
			{/* Breadcrumbs */}
			<Breadcrumbs items={breadcrumbs} />

			{/* Thread header */}
			<div className="rounded-[14px] bg-card p-6">
				<div className="flex flex-wrap items-center gap-2">
					{data.badges.map((badge) => (
						<ThreadBadge key={`${badge.type}-${badge.label}`} badge={badge} />
					))}
				</div>
				<h1 className="mt-2 text-2xl font-bold">{data.thread.subject}</h1>
				<div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
					{data.forum && <span>Forum: {data.forum.name}</span>}
					<span>Author: {data.thread.authorName}</span>
					<span>Views: {data.thread.views}</span>
					<span>Replies: {data.thread.replies}</span>
				</div>
			</div>

			{/* Posts */}
			<div className="space-y-3">
				{data.posts.map((item, _i) => (
					<PostCard
						key={item.post.id}
						post={item.post}
						author={item.author}
						attachments={item.attachments}
						floorNumber={item.post.position}
					/>
				))}
			</div>

			{/* Pagination */}
			<ForumPagination
				prevCursor={data.prevCursor}
				nextCursor={data.nextCursor}
				total={data.total}
			/>

			{/* Reply form */}
			<ThreadReplyForm threadId={threadId} closed={data.thread.closed === 1} />
		</div>
	);
}
