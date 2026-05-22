// Ref: 04f §6 — RSC page, Discuz classic thread list layout with page-number pagination

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
import { getCachedForumThreadTypes, getCachedPostsPerPage } from "@/lib/forum-cache";
import { getSelfForumUser } from "@/lib/forum-self";
import {
	type RecommendedThreadItem,
	loadRecommendedThreads,
} from "@/viewmodels/forum/recommended-threads.server";
import {
	type ThreadListPagedData,
	loadThreadListPaged,
} from "@/viewmodels/forum/thread-list.server";
import {
	type ForumThreadTypesPublic,
	buildForumListReturnTo,
	coerceTypeIdParam,
	normalizeTypeId,
	shouldShowFilter,
	shouldShowTypeNameBadge,
} from "@/viewmodels/forum/thread-types";
import { getForumTitle } from "@/viewmodels/forum/title.server";
import { parseIntParam, parsePageParam } from "@/viewmodels/shared/params";
import { ForumType, canModerate } from "@ellie/types";
import type { Metadata } from "next";
import Link from "next/link";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ page?: string; typeId?: string }>;
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
	// Strict positive-integer parse — non-numeric / 0 / signs / leading
	// zeros all become null. Whitelist normalization against the public
	// payload happens AFTER we fetch the payload so we can drop stale /
	// disabled / cross-forum ids without round-tripping to the Worker.
	const rawTypeId = coerceTypeIdParam(sp.typeId);

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
	let threadTypes: ForumThreadTypesPublic | null = null;

	// Parallel: loader + self-user fetch + postsPerPage + thread-types
	// config + recommended threads. All independent. self uses fail-soft
	// (.catch → null); the thread-types config also fails soft because
	// most forums won't even have category UI — a 404 / outage there
	// should not break the list. `recommendedThreadsPromise` is also
	// fail-soft: the recommended card is decorative and must never block
	// the page if its endpoint 500s or 404s on a private-forum probe.
	const selfPromise = getSelfForumUser().catch(() => null);
	const postsPerPagePromise = getCachedPostsPerPage();
	const threadTypesPromise = getCachedForumThreadTypes(forumId).catch(() => null);
	const recommendedThreadsPromise = loadRecommendedThreads(forumId)
		.then((res) => res.threads)
		.catch(() => [] as RecommendedThreadItem[]);

	try {
		// Fetch the type payload first so we can whitelist-normalize the
		// typeId before passing it to the threads loader. This avoids a
		// 400 round-trip when the URL carries a stale / disabled id.
		threadTypes = await threadTypesPromise;
		const normalizedTypeId = normalizeTypeId(rawTypeId, threadTypes);

		data = await loadThreadListPaged({
			forumId,
			page,
			typeId: normalizedTypeId,
			// Respect the per-forum `thread_types_prefix` switch: when off,
			// suppress the prefix badge on every list row. `null` payload
			// (loader fail-soft) keeps the historical default (badge on).
			includeTypeNameBadge: shouldShowTypeNameBadge(threadTypes),
		});
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
	const recommendedThreads = await recommendedThreadsPromise;

	// Re-derive the effective typeId for URL builders: only set if the
	// page actually filtered. After the catch path threadTypes may be
	// null — that's fine, normalizeTypeId returns null and the rest of
	// the UI behaves as no-filter.
	const activeTypeId = normalizeTypeId(rawTypeId, threadTypes);
	// `basePath` is the bare forum path — page-pagination + jump-to-page
	// + floating toolbar all take typeId separately via `extraParams` so
	// they can append `?page=N&typeId=N` in canonical order.
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
		<div className="space-y-2">
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

			{/* Per-forum "推荐主题" card. Rendered below the forum header
			    and above the thread list / error banner so it stays
			    visible on the type-filter views too. Self-hides when the
			    backend returns zero recommendations. */}
			<ForumRecommendedCard threads={recommendedThreads} />

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

					{/* 主题分类 filter pills — only when forum enables listable categories. */}
					{showFilter && threadTypes && (
						<ThreadTypeFilter
							forumId={forumId}
							types={threadTypes.types}
							activeTypeId={activeTypeId}
						/>
					)}

					{/* Toolbar: new post button (left) + pagination (right) */}
					<div className="flex items-center gap-2 py-2">
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
					<div className="flex items-center gap-2 py-2">
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
