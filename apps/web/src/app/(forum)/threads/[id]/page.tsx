// Ref: 04f §7 — Discuz classic two-column layout with mod action bar

import { getThreadBadges } from "@ellie/types";
import { Clock3, Eye, MessageCircle, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { ForumPageHeader } from "@/components/forum/forum-page-header";
import { ModProvider } from "@/components/forum/mod-context";
import { PagePagination } from "@/components/forum/page-pagination";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { ThreadPostsClient } from "@/components/forum/thread-posts-client";
import { ThreadReportButton } from "@/components/forum/thread-report-button";
import { ThreadTitleEditButton } from "@/components/forum/thread-title-edit-button";
import { Card, CardContent } from "@/components/ui/card";
import { getCachedPostsPerPage } from "@/lib/forum-cache";
import { parseThreadLocation, THREAD_LOCATION_HEADER } from "@/lib/thread-location";
import {
	loadThreadDetail,
	type ThreadDetailPageData,
} from "@/viewmodels/forum/thread-detail.server";
import {
	getThreadPageCount,
	getThreadPageUrl,
	resolveCurrentPage,
	validateReturnTo,
} from "@/viewmodels/forum/thread-list";
import { getThreadTitle } from "@/viewmodels/forum/title.server";
import { formatNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import { parseIntParam } from "@/viewmodels/shared/params";

interface ThreadDetailPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{
		cursor?: string;
		direction?: string;
		last?: string;
		page?: string;
		returnTo?: string;
	}>;
}

export async function generateMetadata({ params }: ThreadDetailPageProps): Promise<Metadata> {
	const { id } = await params;
	const threadId = parseIntParam(id);
	if (threadId == null) return { title: "主题" };
	try {
		return { title: await getThreadTitle(threadId) };
	} catch {
		return { title: "主题" };
	}
}

/** Thread-detail header author label — three-way branching kept out of the
 * page component itself so the page stays under the cognitive-complexity
 * ceiling. Same contract as post-card / thread-item / digest-card. */
function ThreadHeaderAuthor({
	thread,
}: {
	thread: { authorId: number; authorName: string; anonymousAuthor?: number };
}) {
	if (thread.anonymousAuthor === 1 && thread.authorId === 0) {
		return <span className="text-muted-foreground">匿名</span>;
	}
	if (thread.authorId === 0) {
		return <span className="text-muted-foreground">未知用户</span>;
	}
	return (
		<Link
			prefetch={false}
			href={`/users/${thread.authorId}`}
			className="hover:text-primary transition-colors"
		>
			{thread.authorName}
		</Link>
	);
}

export default async function ThreadDetailPage({ params, searchParams }: ThreadDetailPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const threadId = parseIntParam(id);

	if (threadId == null) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">无效的主题 ID</p>
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

	let data: ThreadDetailPageData;
	let error: string | null = null;

	const postsPerPage = await getCachedPostsPerPage();

	try {
		data = await loadThreadDetail({ threadId });
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load thread";
		data = {
			thread: null,
			forum: null,
			posts: [],
			nextCursor: null,
			prevCursor: null,
			total: 0,
			breadcrumbs: [],
			canModerateForum: false,
			canManageThread: false,
			canMoveThread: false,
			canDeleteThread: false,
			canEditSubject: false,
			currentUser: null,
		};
	}

	const self = data.currentUser;

	if (error || !data.thread) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">{error ?? "主题不存在"}</p>
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

	const thread = data.thread;

	const badges = getThreadBadges(thread);
	const threadPages = getThreadPageCount(thread.replies, postsPerPage);
	const basePath = `/threads/${threadId}`;

	// Derive current page from search params (priority: cursor > last > page > 1)
	const location = parseThreadLocation((await headers()).get(THREAD_LOCATION_HEADER));
	const currentPage = resolveCurrentPage(location ?? {}, postsPerPage, threadPages);

	// Validate returnTo once — all downstream surfaces use the validated value.
	// Invalid returnTo is silently dropped so the next pagination click cleans it out.
	const validReturnTo = validateReturnTo(sp.returnTo, thread.forumId);

	// Page-based prev/next hrefs — bypass Worker cursor backward limitation
	const prevHref =
		currentPage > 1
			? getThreadPageUrl(threadId, currentPage - 1, validReturnTo ?? undefined)
			: null;
	const nextHref =
		currentPage < threadPages
			? getThreadPageUrl(threadId, currentPage + 1, validReturnTo ?? undefined)
			: null;

	// Back button / ESC target — validated returnTo or fallback to forum root
	const backHref = validReturnTo ?? `/forums/${thread.forumId}`;

	// Extra query params for pagination links (preserves returnTo across page navigation)
	const paginationExtra = validReturnTo ? { returnTo: validReturnTo } : undefined;

	return (
		<div className="space-y-3">
			{/* Breadcrumbs — mobile collapses intermediate forum-ancestor links
			    (首页 → 分区A → 分区B → 版块 → 主题  becomes  首页 → 版块 → 主题)
			    per reviewer freeze msg=5a91dfd3. Desktop unchanged. */}
			<BreadcrumbBar items={data.breadcrumbs} mobileCompact="hide-intermediate" />

			<ForumPageHeader
				icon={<MessageSquare />}
				title={
					<span className="flex flex-wrap items-center gap-2">
						<ThreadBadgeList badges={badges} digestLevel={thread.digest} />
						<span>{thread.subject}</span>
						{data.canEditSubject && (
							<ThreadTitleEditButton threadId={thread.id} currentSubject={thread.subject} />
						)}
					</span>
				}
				actions={
					<ThreadReportButton
						threadId={thread.id}
						authorId={thread.authorId}
						currentUserId={data.currentUser?.id ?? null}
					/>
				}
				description={
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
						<Link
							prefetch={false}
							href={`/forums/${thread.forumId}`}
							className="font-medium text-primary hover:underline"
						>
							{data.forum?.name ?? "版块"}
						</Link>
						<ThreadHeaderAuthor thread={thread} />
						<span>{formatRelativeTime(thread.createdAt)}</span>
					</div>
				}
			>
				<div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground tabular-nums">
					<span className="inline-flex items-center gap-1.5">
						<Eye className="size-4" aria-hidden="true" />
						{formatNumber(thread.views)} 次查看
					</span>
					<span className="inline-flex items-center gap-1.5">
						<MessageCircle className="size-4" aria-hidden="true" />
						{formatNumber(thread.replies)} 条回复
					</span>
					{thread.lastPostAt > 0 && (
						<Link
							prefetch={false}
							href={getThreadPageUrl(thread.id, threadPages, validReturnTo ?? undefined)}
							className="inline-flex items-center gap-1.5 hover:text-primary"
						>
							<Clock3 className="size-4" aria-hidden="true" />
							最后回复 {formatRelativeTime(thread.lastPostAt)}
						</Link>
					)}
				</div>
			</ForumPageHeader>

			{/* Top pagination */}
			<PagePagination
				page={currentPage}
				pages={threadPages}
				total={thread.replies}
				basePath={basePath}
				totalLabel="条回复"
				showPageInfo
				extraParams={paginationExtra}
			/>

			{/* Posts - wrapped in ModProvider for permission context */}
			<ModProvider
				canModerate={data.canModerateForum}
				forumId={thread.forumId}
				threadId={thread.id}
			>
				<ThreadPostsClient
					thread={thread}
					posts={data.posts}
					canModerateForum={data.canModerateForum}
					canManageThread={data.canManageThread}
					canMoveThread={data.canMoveThread}
					canDeleteThread={data.canDeleteThread}
					currentUserId={data.currentUser?.id ?? null}
					currentUserRole={data.currentUser?.role ?? null}
					selfEmailVerifiedAt={self?.emailVerifiedAt ?? null}
					prevHref={prevHref}
					nextHref={nextHref}
					backHref={backHref}
					jumpPage={
						threadPages > 1
							? { basePath, pages: threadPages, returnTo: validReturnTo ?? undefined }
							: undefined
					}
				/>
			</ModProvider>

			{data.posts.length === 0 && (
				<Card size="sm">
					<CardContent className="text-center py-4 text-sm text-muted-foreground">
						暂无回复
					</CardContent>
				</Card>
			)}

			{/* Bottom pagination */}
			<PagePagination
				page={currentPage}
				pages={threadPages}
				total={thread.replies}
				basePath={basePath}
				totalLabel="条回复"
				showPageInfo
				extraParams={paginationExtra}
			/>
		</div>
	);
}
