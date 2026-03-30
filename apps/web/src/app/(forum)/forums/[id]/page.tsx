// Ref: 04f §6 — RSC page, inline ThreadItem + KeysetPagination

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { SafeHtml } from "@/components/forum/safe-html";
import { ThreadItem } from "@/components/forum/thread-item";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sortLabel } from "@/viewmodels/forum/thread-list";
import { type ThreadListData, loadThreadList } from "@/viewmodels/forum/thread-list.server";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ cursor?: string }>;
}

export default async function ForumThreadsPage({ params, searchParams }: ForumThreadsPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const forumId = Number.parseInt(id, 10);

	let data: ThreadListData;
	let error: string | null = null;

	try {
		data = await loadThreadList({
			forumId,
			cursor: sp.cursor,
		});
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load threads";
		data = { forum: null, items: [], nextCursor: null, prevCursor: null, total: 0 };
	}

	return (
		<div className="space-y-4">
			{/* Forum header */}
			{data.forum && (
				<Card size="sm">
					<CardHeader className="pb-0">
						<CardTitle>{data.forum.name}</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex items-center gap-4 text-xs text-muted-foreground">
							{data.forum.description && (
								<>
									<SafeHtml html={data.forum.description} />
									<span>·</span>
								</>
							)}
							<span>帖子 {data.forum.threads.toLocaleString()}</span>
							<span>回帖 {data.forum.posts.toLocaleString()}</span>
						</div>
					</CardContent>
				</Card>
			)}

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{/* Thread list card */}
			<Card>
				<CardContent className="pt-4">
					{/* Sort + Filter bar (disabled — Worker v1 does not support sort/digest) */}
					<div className="flex items-center justify-between gap-2 pb-3 border-b border-border/50">
						<div className="flex items-center gap-1">
							<span
								title="排序功能即将上线"
								className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs font-medium text-foreground"
							>
								{sortLabel("latest")}
							</span>
							<span
								title="排序功能即将上线"
								className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium text-muted-foreground/50 cursor-not-allowed"
							>
								{sortLabel("newest")}
							</span>
							<span
								title="排序功能即将上线"
								className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium text-muted-foreground/50 cursor-not-allowed"
							>
								{sortLabel("hot")}
							</span>
						</div>
						<span
							title="精华筛选功能即将上线"
							className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium text-muted-foreground/50 cursor-not-allowed"
						>
							只看精华
						</span>
					</div>

					{/* Thread rows */}
					{data.items.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">暂无帖子</div>
					) : (
						<div className="mt-1">
							{data.items.map((item) => (
								<ThreadItem key={item.thread.id} item={item} />
							))}
						</div>
					)}

					{/* Pagination */}
					<KeysetPagination
						total={data.total}
						prevHref={data.prevCursor ? `/forums/${forumId}?cursor=${data.prevCursor}` : null}
						nextHref={data.nextCursor ? `/forums/${forumId}?cursor=${data.nextCursor}` : null}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
