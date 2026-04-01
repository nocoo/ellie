// Ref: 04f §7 — Discuz classic two-column layout with mod action bar

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { ModActionBar } from "@/components/forum/mod-action-bar";
import { PostCard } from "@/components/forum/post-card";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { type ThreadDetailPageData, loadThreadDetail } from "@/viewmodels/forum/thread-detail.server";
import { formatTime } from "@/viewmodels/forum/thread-list";
import { getThreadBadges } from "@ellie/types";
import { parseIntParam } from "@/viewmodels/shared/params";
import Link from "next/link";

interface ThreadDetailPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ cursor?: string; direction?: string }>;
}

export default async function ThreadDetailPage({ params, searchParams }: ThreadDetailPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const threadId = parseIntParam(id);

	if (threadId == null) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">无效的帖子 ID</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	let data: ThreadDetailPageData;
	let error: string | null = null;

	try {
		data = await loadThreadDetail({
			threadId,
			cursor: sp.cursor,
			direction: sp.direction === "backward" ? "backward" : "forward",
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load thread";
		data = {
			thread: null,
			forums: [],
			posts: [],
			nextCursor: null,
			prevCursor: null,
			total: 0,
			breadcrumbs: [],
		};
	}

	if (error || !data.thread) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">{error ?? "帖子不存在"}</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	const thread = data.thread;

	const badges = getThreadBadges(thread);

	return (
		<div className="space-y-3">
			{/* Breadcrumbs */}
			{data.breadcrumbs.length > 1 && (
				<div className="py-2">
					<Breadcrumbs items={data.breadcrumbs} />
				</div>
			)}

			{/* Mod action bar */}
			<ModActionBar />

			{/* Thread header (simplified — views/replies now in first post sidebar) */}
			<Card size="sm">
				<CardContent>
					<div className="flex items-center gap-2 flex-wrap">
						<ThreadBadgeList badges={badges} />
						<h1 className="text-base font-semibold text-foreground">{thread.subject}</h1>
					</div>
					<div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
						<Link
							href={`/forums/${thread.forumId}`}
							className="hover:text-primary transition-colors"
						>
							版块
						</Link>
						<span>·</span>
						<Link
							href={`/users/${thread.authorId}`}
							className="hover:text-primary transition-colors"
						>
							{thread.authorName}
						</Link>
						<span>·</span>
						<span>{formatTime(thread.createdAt)}</span>
					</div>
				</CardContent>
			</Card>

			{/* Posts */}
			{data.posts.map((post) => {
				const isFirst = post.isFirst || post.position === 1;
				return (
					<PostCard
						key={post.id}
						post={post}
						threadViews={isFirst ? thread.views : undefined}
						threadReplies={isFirst ? thread.replies : undefined}
						threadDigest={isFirst ? thread.digest : undefined}
					/>
				);
			})}

			{data.posts.length === 0 && (
				<Card size="sm">
					<CardContent className="text-center py-4 text-sm text-muted-foreground">
						暂无回复
					</CardContent>
				</Card>
			)}

			{/* Pagination */}
			<KeysetPagination
				total={data.total}
				totalLabel="条回复"
				prevHref={
					data.prevCursor
						? `/threads/${threadId}?cursor=${data.prevCursor}&direction=backward`
						: null
				}
				nextHref={data.nextCursor ? `/threads/${threadId}?cursor=${data.nextCursor}` : null}
			/>
		</div>
	);
}
