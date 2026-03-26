// (forum)/digest/page.tsx — Digest (featured threads) page
// Ref: 04d §精华列表 — cross-forum digest threads

import { ForumPagination } from "@/components/forum-pagination";
import { ThreadItem } from "@/components/forum/thread-item";
import { createRepositories } from "@/data/index";
import { fetchDigestList } from "@/viewmodels/forum/digest";

/**
 * Digest page — server component showing featured threads.
 */
export default async function DigestPage() {
	const repos = createRepositories();
	const data = await fetchDigestList(repos);

	return (
		<div className="space-y-4">
			<div className="rounded-[14px] bg-card p-6">
				<h1 className="text-2xl font-bold">Digest</h1>
				<p className="mt-1 text-sm text-muted-foreground">Featured threads across all forums</p>
			</div>

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
					<div className="rounded-[14px] bg-card p-6 text-center text-muted-foreground">
						No digest threads found.
					</div>
				)}
			</div>

			<ForumPagination
				prevCursor={data.prevCursor}
				nextCursor={data.nextCursor}
				total={data.total}
			/>
		</div>
	);
}
