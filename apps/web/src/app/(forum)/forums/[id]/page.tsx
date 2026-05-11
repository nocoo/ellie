// Ref: 04f §6 — RSC page, Discuz classic thread list layout with page-number pagination

import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { ForumFloatingToolbar } from "@/components/forum/forum-floating-toolbar";
import { ForumHeaderClient } from "@/components/forum/forum-header-client";
import { ForumNewPostButton } from "@/components/forum/forum-new-post-button";
import { ForumPanel } from "@/components/forum/forum-panel";
import { PagePagination } from "@/components/forum/page-pagination";
import { ThreadItem } from "@/components/forum/thread-item";
import { ThreadListHeader } from "@/components/forum/thread-list-header";
import { Card, CardContent } from "@/components/ui/card";
import { getCachedPostsPerPage } from "@/lib/forum-cache";
import { getSelfForumUser } from "@/lib/forum-self";
import {
	type ThreadListPagedData,
	loadThreadListPaged,
} from "@/viewmodels/forum/thread-list.server";
import { getForumTitle } from "@/viewmodels/forum/title.server";
import { parseIntParam, parsePageParam } from "@/viewmodels/shared/params";
import { ForumType } from "@ellie/types";
import type { Metadata } from "next";
import Link from "next/link";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: ForumThreadsPageProps): Promise<Metadata> {
	const { id } = await params;
	const forumId = parseIntParam(id);
	if (forumId == null) return { title: "版块" };
	try {
		return { title: await getForumTitle(forumId) };
	} catch {
		return { title: "版块" };
	}
}

export default async function ForumThreadsPage({ params, searchParams }: ForumThreadsPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const forumId = parseIntParam(id);
	const page = parsePageParam(sp.page);

	if (forumId == null) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">无效的版块 ID</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	let data: ThreadListPagedData;
	let error: string | null = null;

	// Parallel: loader + self-user fetch + postsPerPage. All independent.
	// self uses fail-soft (.catch → null) so it never breaks the page.
	const selfPromise = getSelfForumUser().catch(() => null);
	const postsPerPagePromise = getCachedPostsPerPage();

	try {
		data = await loadThreadListPaged({ forumId, page });
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load threads";
		data = {
			forum: null,
			forums: [],
			items: [],
			page: 1,
			pages: 1,
			total: 0,
			limit: 100,
			breadcrumbs: [],
		};
	}

	const self = await selfPromise;
	const postsPerPage = await postsPerPagePromise;

	const basePath = `/forums/${forumId}`;
	const returnTo = page > 1 ? `${basePath}?page=${page}` : basePath;
	const isGroup = data.forum?.type === ForumType.Group;

	return (
		<div className="space-y-2">
			{/* Breadcrumbs */}
			<BreadcrumbBar items={data.breadcrumbs} />
			{/* Forum header with new thread button */}
			{data.forum && (
				<ForumHeaderClient
					forum={data.forum}
					isGroup={isGroup}
					selfEmailVerifiedAt={self?.emailVerifiedAt ?? null}
				/>
			)}

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{isGroup && data.forum ? (
				/* Group forum — render children as forum cards instead of thread list */
				<div className="overflow-hidden rounded-sm border border-border bg-card">
					<ForumPanel forums={data.forum.children} layout="auto" />
				</div>
			) : (
				/* Regular forum — thread list */
				<>
					{/* Sub-forums above thread list */}
					{data.forum && data.forum.children.length > 0 && (
						<div className="overflow-hidden rounded-sm border border-border bg-card">
							<ForumPanel forums={data.forum.children} layout="auto" />
						</div>
					)}

					{/* Toolbar: new post button (left) + pagination (right) */}
					<div className="flex items-center gap-2 py-2">
						{data.forum && !isGroup && (
							<ForumNewPostButton
								forumId={data.forum.id}
								forumName={data.forum.name}
								selfEmailVerifiedAt={self?.emailVerifiedAt ?? null}
							/>
						)}
						<PagePagination
							page={data.page}
							pages={data.pages}
							total={data.total}
							basePath={basePath}
							totalLabel="个主题"
							className="flex flex-1 flex-wrap items-center justify-end gap-2"
						/>
					</div>

					<Card className="py-0">
						<CardContent className="p-0">
							<ThreadListHeader />

							{data.items.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">暂无主题</div>
							) : (
								<div>
									{data.items.map((item) => (
										<ThreadItem
											key={item.thread.id}
											item={item}
											postsPerPage={postsPerPage}
											returnTo={returnTo}
										/>
									))}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Toolbar: same layout below the list */}
					<div className="flex items-center gap-2 py-2">
						{data.forum && !isGroup && (
							<ForumNewPostButton
								forumId={data.forum.id}
								forumName={data.forum.name}
								selfEmailVerifiedAt={self?.emailVerifiedAt ?? null}
							/>
						)}
						<PagePagination
							page={data.page}
							pages={data.pages}
							total={data.total}
							basePath={basePath}
							totalLabel="个主题"
							className="flex flex-1 flex-wrap items-center justify-end gap-2"
						/>
					</div>

					{/* Floating toolbar with keyboard shortcuts, pagination, and new-thread */}
					<ForumFloatingToolbar
						page={data.page}
						pages={data.pages}
						basePath={basePath}
						forumId={data.forum?.id}
						forumName={data.forum?.name}
						showNewThread={!!data.forum && !isGroup}
						selfEmailVerifiedAt={self?.emailVerifiedAt ?? null}
					/>
				</>
			)}
		</div>
	);
}
