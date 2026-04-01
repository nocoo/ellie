// Ref: 04f §6 — RSC page, Discuz classic thread list layout with page-number pagination

import { ForumPanel } from "@/components/forum/forum-panel";
import { PagePagination } from "@/components/forum/page-pagination";
import { SafeHtml } from "@/components/forum/safe-html";
import { ThreadItem } from "@/components/forum/thread-item";
import { ThreadListHeader } from "@/components/forum/thread-list-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import {
	type ThreadListPagedData,
	loadThreadListPaged,
} from "@/viewmodels/forum/thread-list.server";
import { ForumType } from "@ellie/types";
import Link from "next/link";
import { parseIntParam, parsePageParam } from "@/viewmodels/shared/params";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ page?: string }>;
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

	try {
		data = await loadThreadListPaged({ forumId, page });
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load threads";
		data = { forum: null, forums: [], items: [], page: 1, pages: 1, total: 0, limit: 100, breadcrumbs: [] };
	}

	const basePath = `/forums/${forumId}`;
	const isGroup = data.forum?.type === ForumType.Group;

	return (
		<div className="space-y-2">
			{/* Breadcrumbs */}
			{data.breadcrumbs.length > 1 && (
				<div className="py-2">
					<Breadcrumbs items={data.breadcrumbs} />
				</div>
			)}
			{/* Forum header */}
			{data.forum && (
				<div>
					<h1 className="text-lg font-semibold">{data.forum.name}</h1>
					<div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
						{data.forum.description && <SafeHtml html={data.forum.description} />}
						{!isGroup && (
							<>
								<span>帖子 {data.forum.threads.toLocaleString()}</span>
								<span>回帖 {data.forum.posts.toLocaleString()}</span>
							</>
						)}
					</div>
				</div>
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

					<PagePagination
						page={data.page}
						pages={data.pages}
						total={data.total}
						basePath={basePath}
					/>

					<Card className="py-0">
						<CardContent className="p-0">
							<ThreadListHeader />

							{data.items.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">暂无帖子</div>
							) : (
								<div>
									{data.items.map((item) => (
										<ThreadItem key={item.thread.id} item={item} />
									))}
								</div>
							)}
						</CardContent>
					</Card>

					<PagePagination
						page={data.page}
						pages={data.pages}
						total={data.total}
						basePath={basePath}
					/>
				</>
			)}
		</div>
	);
}
