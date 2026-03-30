// Ref: 04f §6 — RSC page, inline ThreadItem + KeysetPagination, sort via searchParams

import { KeysetPagination } from "@/components/forum/keyset-pagination";
import { ThreadItem } from "@/components/forum/thread-item";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ThreadSort } from "@/viewmodels/forum/thread-list";
import { sortLabel } from "@/viewmodels/forum/thread-list";
import { type ThreadListData, loadThreadList } from "@/viewmodels/forum/thread-list.server";
import Link from "next/link";

interface ForumThreadsPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ sort?: string; digest?: string; cursor?: string }>;
}

const SORT_OPTIONS: ThreadSort[] = ["latest", "newest", "hot"];

export default async function ForumThreadsPage({ params, searchParams }: ForumThreadsPageProps) {
	const { id } = await params;
	const sp = await searchParams;
	const forumId = Number.parseInt(id, 10);
	const currentSort = (sp.sort as ThreadSort) || "latest";
	const digestOnly = sp.digest === "1";

	let data: ThreadListData;
	let error: string | null = null;

	try {
		data = await loadThreadList({
			forumId,
			sort: currentSort,
			digestOnly,
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
									<span>{data.forum.description}</span>
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
					{/* Sort + Filter bar */}
					<div className="flex items-center justify-between gap-2 pb-3 border-b border-border/50">
						<div className="flex items-center gap-1">
							{SORT_OPTIONS.map((option) => (
								<Link
									key={option}
									href={`/forums/${forumId}?sort=${option}${digestOnly ? "&digest=1" : ""}`}
									className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium transition-colors ${
										currentSort === option
											? "bg-primary text-primary-foreground"
											: "text-muted-foreground hover:bg-muted hover:text-foreground"
									}`}
								>
									{sortLabel(option)}
								</Link>
							))}
						</div>
						<Link
							href={`/forums/${forumId}?sort=${currentSort}${digestOnly ? "" : "&digest=1"}`}
							className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium transition-colors ${
								digestOnly
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:bg-muted hover:text-foreground"
							}`}
						>
							只看精华
						</Link>
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
						prevHref={
							data.prevCursor
								? `/forums/${forumId}?sort=${currentSort}&cursor=${data.prevCursor}${digestOnly ? "&digest=1" : ""}`
								: null
						}
						nextHref={
							data.nextCursor
								? `/forums/${forumId}?sort=${currentSort}&cursor=${data.nextCursor}${digestOnly ? "&digest=1" : ""}`
								: null
						}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
