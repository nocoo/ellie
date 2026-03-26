// (forum)/forums/[id]/page.tsx — Thread list page for a forum
// Ref: 04d §版块帖子列表 — threads with sort/filter/pagination
//
// Server component: fetches thread list at request time.
// Sort/filter controlled via URL search params (ThreadSortControls handles
// navigation on the client side).

import { ForumPagination } from "@/components/forum-pagination";
import { ThreadItem } from "@/components/forum/thread-item";
import { ThreadSortControls } from "@/components/forum/thread-sort-controls";
import { createRepositories } from "@/data/index";
import type { ThreadSort } from "@/viewmodels/forum/thread-list";
import { fetchThreadList } from "@/viewmodels/forum/thread-list";
import Link from "next/link";
import { notFound } from "next/navigation";

interface PageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ sort?: string; digest?: string }>;
}

export default async function ForumThreadListPage({ params, searchParams }: PageProps) {
	const { id } = await params;
	const forumId = Number(id);
	const sp = await searchParams;

	const sort = (sp.sort as ThreadSort) || "latest";
	const digestOnly = sp.digest === "true";

	const repos = createRepositories();
	const data = await fetchThreadList(repos, forumId, { sort, digestOnly });

	if (!data) notFound();

	return (
		<div className="space-y-4">
			{/* Forum info */}
			<div className="rounded-[14px] bg-card p-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold">{data.forum.name}</h1>
						{data.forum.description && (
							<p className="mt-1 text-sm text-muted-foreground">{data.forum.description}</p>
						)}
						<p className="mt-1 text-xs text-muted-foreground">
							{data.total} thread{data.total !== 1 ? "s" : ""}
						</p>
					</div>
					<Link
						href={`/threads/new?forumId=${forumId}`}
						className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>
						New Thread
					</Link>
				</div>
			</div>

			{/* Thread list with sort controls */}
			<div className="rounded-[14px] bg-card p-4">
				<ThreadSortControls sort={sort} digestOnly={digestOnly} />

				<div className="space-y-2">
					{data.items.map((item) => (
						<ThreadItem
							key={item.thread.id}
							thread={item.thread}
							badges={item.badges}
							highlightStyle={item.highlightStyle}
						/>
					))}
					{data.items.length === 0 && (
						<div className="rounded-[10px] bg-secondary p-6 text-center text-muted-foreground">
							No threads found.
						</div>
					)}
				</div>
			</div>

			{/* Pagination */}
			<ForumPagination prevCursor={data.prevCursor} nextCursor={data.nextCursor} />
		</div>
	);
}
