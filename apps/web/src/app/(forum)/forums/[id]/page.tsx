// Ref: 04f §6 — RSC page, Discuz classic thread list layout with page-number pagination

import { canModerate, ForumType } from "@ellie/types";
import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { ForumFloatingToolbar } from "@/components/forum/forum-floating-toolbar";
import { ForumHeaderClient } from "@/components/forum/forum-header-client";
import { ForumNewPostButton } from "@/components/forum/forum-new-post-button";
import { ForumPanel } from "@/components/forum/forum-panel";
import { ForumRecommendedCard } from "@/components/forum/forum-recommended-card";
import { PagePagination } from "@/components/forum/page-pagination";
import { ThreadItem } from "@/components/forum/thread-item";
import { ThreadListHeader } from "@/components/forum/thread-list-header";
import { ThreadTypeFilter } from "@/components/forum/thread-type-filter";
import { Card, CardContent } from "@/components/ui/card";
import { getCachedPostsPerPage } from "@/lib/forum-cache";
import {
	loadThreadListPaged,
	type ThreadListPagedData,
} from "@/viewmodels/forum/thread-list.server";
import { buildForumListReturnTo, shouldShowFilter } from "@/viewmodels/forum/thread-types";
import { getForumTitle } from "@/viewmodels/forum/title.server";
import { parseIntParam } from "@/viewmodels/shared/params";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
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

export default async function ForumThreadsPage({ params }: ForumThreadsPageProps) {
	const { id } = await params;
	const forumId = parseIntParam(id);

	if (forumId == null) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">无效的版块 ID</p>
					<Link
						prefetch={false}
						href="/"
						className="mt-4 inline-block text-sm text-primary hover:underline"
					>
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	let data: ThreadListPagedData;
	let error: string | null = null;
	const postsPerPagePromise = getCachedPostsPerPage();
	try {
		data = await loadThreadListPaged(forumId);
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
			hasNext: false,
			breadcrumbs: [],
			user: null,
			typeId: null,
			threadTypes: null,
			recommended: [],
		};
	}

	const self = data.user;
	const threadTypes = data.threadTypes;
	const postsPerPage = await postsPerPagePromise;
	const activeTypeId = data.typeId;
	const basePath = `/forums/${forumId}`;
	const returnTo = buildForumListReturnTo({
		forumId,
		page: data.page,
		typeId: activeTypeId,
	});
	const paginationExtraParams: Record<string, string> | undefined =
		activeTypeId != null && activeTypeId > 0 ? { typeId: String(activeTypeId) } : undefined;
	const showFilter = shouldShowFilter(threadTypes);
	const isGroup = data.forum?.type === ForumType.Group;

	// UX-only permission flag: hide the announcement edit affordance
	// from non-moderators. The Worker still enforces the real boundary
	// via `moderationMiddleware` + `canModerate` before any write.
	const canEditAnnouncement =
		data.forum != null &&
		self != null &&
		canModerate(
			{ id: self.id, username: self.username, role: self.role, status: self.status },
			{ moderators: data.forum.moderators },
		);

	return (
		<div className="space-y-4">
			{/* Breadcrumbs */}
			<BreadcrumbBar items={data.breadcrumbs} />
			{/* Forum header with new thread button */}
			{data.forum && (
				<ForumHeaderClient
					forum={data.forum}
					isGroup={isGroup}
					selfEmailVerifiedAt={self?.emailVerifiedAt ?? null}
					threadTypes={threadTypes}
					canEditAnnouncement={canEditAnnouncement}
				/>
			)}

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{isGroup && data.forum ? (
				/* Group forum — render children as forum cards instead of thread list */
				<div className="overflow-hidden rounded-xl border border-border bg-card">
					<ForumPanel forums={data.forum.children} layout="auto" />
				</div>
			) : (
				/* Regular forum — thread list */
				<>
					{/* Sub-forums above recommended threads */}
					{data.forum && data.forum.children.length > 0 && (
						<div className="overflow-hidden rounded-xl border border-border bg-card">
							<ForumPanel forums={data.forum.children} layout="auto" />
						</div>
					)}

					{/* Per-forum "推荐主题" card — below sub-forums, above thread list */}
					<ForumRecommendedCard threads={data.recommended} />

					{/* 主题分类 filter pills — only when forum enables listable categories. */}
					{showFilter && threadTypes && (
						<ThreadTypeFilter
							forumId={forumId}
							types={threadTypes.types}
							activeTypeId={activeTypeId}
						/>
					)}

					{/* Toolbar: new post button (left) + pagination (right) */}
					<div className="flex flex-wrap items-center gap-2 py-1">
						{data.forum && !isGroup && (
							<ForumNewPostButton
								forumId={data.forum.id}
								forumName={data.forum.name}
								selfEmailVerifiedAt={self?.emailVerifiedAt ?? null}
								threadTypes={threadTypes}
							/>
						)}
						<PagePagination
							page={data.page}
							pages={data.pages}
							total={data.total}
							basePath={basePath}
							totalLabel="个主题"
							extraParams={paginationExtraParams}
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
					<div className="flex flex-wrap items-center gap-2 py-1">
						{data.forum && !isGroup && (
							<ForumNewPostButton
								forumId={data.forum.id}
								forumName={data.forum.name}
								selfEmailVerifiedAt={self?.emailVerifiedAt ?? null}
								threadTypes={threadTypes}
							/>
						)}
						<PagePagination
							page={data.page}
							pages={data.pages}
							total={data.total}
							basePath={basePath}
							totalLabel="个主题"
							extraParams={paginationExtraParams}
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
						extraParams={paginationExtraParams}
						threadTypes={threadTypes}
					/>
				</>
			)}
		</div>
	);
}
