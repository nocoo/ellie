// (forum)/forums/[id]/page.tsx — Thread list page for a forum
// Ref: 04d §版块帖子列表 — threads with sort/filter/pagination
//
// Server component: fetches thread list at request time.
// Sort/filter controlled via URL search params (page reload on change).

import { ForumPagination } from "@/components/forum-pagination";
import { ThreadList } from "@/components/forum/thread-list";
import { createRepositories } from "@/data/index";
import type { ThreadSort } from "@/viewmodels/forum/thread-list";
import { fetchThreadList } from "@/viewmodels/forum/thread-list";
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
				<h1 className="text-2xl font-bold">{data.forum.name}</h1>
				{data.forum.description && (
					<p className="mt-1 text-sm text-muted-foreground">{data.forum.description}</p>
				)}
				<p className="mt-1 text-xs text-muted-foreground">
					{data.total} thread{data.total !== 1 ? "s" : ""}
				</p>
			</div>

			{/* Thread list with sort controls */}
			<div className="rounded-[14px] bg-card p-4">
				<ThreadList
					items={data.items}
					sort={sort}
					onSortChange={() => {}}
					digestOnly={digestOnly}
					onDigestToggle={() => {}}
				/>
			</div>

			{/* Pagination */}
			<ForumPagination prevCursor={data.prevCursor} nextCursor={data.nextCursor} />
		</div>
	);
}
