// Ref: 04f §6 — RSC page, Discuz classic thread list layout with page-number pagination

import { PagePagination } from "@/components/forum/page-pagination";
import { SafeHtml } from "@/components/forum/safe-html";
import { ThreadItem } from "@/components/forum/thread-item";
import { ThreadListHeader } from "@/components/forum/thread-list-header";
import { Card, CardContent } from "@/components/ui/card";
import {
	type ThreadListPagedData,
	loadThreadListPaged,
} from "@/viewmodels/forum/thread-list.server";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ page?: string }>;
}

export default async function ForumThreadsPage({ params, searchParams }: ForumThreadsPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const forumId = Number.parseInt(id, 10);
	const page = sp.page ? Math.max(1, Number.parseInt(sp.page, 10) || 1) : 1;

	let data: ThreadListPagedData;
	let error: string | null = null;

	try {
		data = await loadThreadListPaged({ forumId, page });
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load threads";
		data = { forum: null, items: [], page: 1, pages: 1, total: 0, limit: 100 };
	}

	const basePath = `/forums/${forumId}`;

	return (
		<div className="space-y-2">
			{/* Forum header */}
			{data.forum && (
				<div>
					<h1 className="text-lg font-semibold">{data.forum.name}</h1>
					<div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
						{data.forum.description && <SafeHtml html={data.forum.description} />}
						<span>帖子 {data.forum.threads.toLocaleString()}</span>
						<span>回帖 {data.forum.posts.toLocaleString()}</span>
					</div>
				</div>
			)}

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{/* Top pagination */}
			<PagePagination page={data.page} pages={data.pages} total={data.total} basePath={basePath} />

			{/* Thread list card */}
			<Card>
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

			{/* Bottom pagination */}
			<PagePagination page={data.page} pages={data.pages} total={data.total} basePath={basePath} />
		</div>
	);
}
