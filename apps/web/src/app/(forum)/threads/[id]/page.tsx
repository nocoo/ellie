// Ref: 04f §7 — Discuz classic two-column layout with mod action bar

import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { ModProvider } from "@/components/forum/mod-context";
import { PagePagination } from "@/components/forum/page-pagination";
import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { ThreadPostsClient } from "@/components/forum/thread-posts-client";
import { ThreadReportButton } from "@/components/forum/thread-report-button";
import { Card, CardContent } from "@/components/ui/card";
import { getCachedPostsPerPage } from "@/lib/forum-cache";
import { getSelfForumUser } from "@/lib/forum-self";
import {
	type ThreadDetailPageData,
	loadThreadDetail,
} from "@/viewmodels/forum/thread-detail.server";
import {
	getThreadPageCount,
	getThreadPageUrl,
	resolveCurrentPage,
	resolveThreadPostCursor,
	validateReturnTo,
} from "@/viewmodels/forum/thread-list";
import { getThreadTitle } from "@/viewmodels/forum/title.server";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import { parseIntParam } from "@/viewmodels/shared/params";
import { getThreadBadges } from "@ellie/types";
import type { Metadata } from "next";
import Link from "next/link";

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

export default async function ThreadDetailPage({ params, searchParams }: ThreadDetailPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const threadId = parseIntParam(id);

	if (threadId == null) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">无效的主题 ID</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	let data: ThreadDetailPageData;
	let error: string | null = null;

	// Parallel: loader + self-user fetch. Both are independent.
	// self uses fail-soft (.catch → null) so it never breaks the page.
	const selfPromise = getSelfForumUser().catch(() => null);

	// Resolve cursor: explicit cursor takes priority over ?page=N.
	// ?page=N is converted to a position-based cursor for the post handler.
	const postsPerPage = await getCachedPostsPerPage();
	const { cursor, isLastPage } = resolveThreadPostCursor(sp, postsPerPage);

	try {
		data = await loadThreadDetail({
			threadId,
			cursor,
			direction: sp.direction === "backward" ? "backward" : "forward",
			last: isLastPage,
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load thread";
		data = {
			thread: null,
			forum: null,
			forums: [],
			posts: [],
			nextCursor: null,
			prevCursor: null,
			total: 0,
			breadcrumbs: [],
			canModerateForum: false,
			canManageThread: false,
			canMoveThread: false,
			canDeleteThread: false,
			currentUser: null,
		};
	}

	const self = await selfPromise;

	if (error || !data.thread) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">{error ?? "主题不存在"}</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
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
	const currentPage = resolveCurrentPage(sp, postsPerPage, threadPages);

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
			{/* Breadcrumbs */}
			<BreadcrumbBar items={data.breadcrumbs} />

			{/* Thread header (simplified — views/replies now in first post sidebar) */}
			<Card size="sm" className="bg-gradient-to-br from-muted/40 via-background to-muted/20">
				<CardContent>
					<div className="flex items-start gap-2 flex-wrap">
						<div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
							<ThreadBadgeList badges={badges} />
							<h1 className="text-base font-semibold text-foreground">{thread.subject}</h1>
						</div>
						<ThreadReportButton
							threadId={thread.id}
							authorId={thread.authorId}
							currentUserId={data.currentUser?.id ?? null}
						/>
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
						<span>{formatRelativeTime(thread.createdAt)}</span>
					</div>
				</CardContent>
			</Card>

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
