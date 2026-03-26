// (forum)/forums/[id]/page.tsx — Thread list page for a forum
// Ref: 04d §版块帖子列表 — threads with sort/filter/pagination
// Client component: sort/filter/pagination state needs interactivity.

"use client";

import { ForumPagination } from "@/components/forum-pagination";
import { ThreadList } from "@/components/forum/thread-list";
import type { ThreadSort } from "@/viewmodels/forum/thread-list";
import { useParams } from "next/navigation";
import { useState } from "react";

/**
 * Thread list page for a specific forum.
 *
 * Phase 2: Will use server actions + streaming for real D1 data.
 * Mock phase: Placeholder UI with sort/filter controls (data via ViewModel).
 */
export default function ForumThreadListPage() {
	const params = useParams();
	const forumId = Number(params.id);
	const [sort, setSort] = useState<ThreadSort>("latest");
	const [digestOnly, setDigestOnly] = useState(false);

	return (
		<div className="space-y-4">
			{/* Forum info placeholder */}
			<div className="rounded-[14px] bg-card p-6">
				<h1 className="text-2xl font-bold">Forum #{forumId}</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Thread list — sort: {sort}, digest only: {digestOnly ? "yes" : "no"}
				</p>
			</div>

			{/* Thread list — placeholder: data will be loaded via ViewModel in Phase 2 */}
			<div className="rounded-[14px] bg-card p-4">
				<ThreadList
					items={[]}
					sort={sort}
					onSortChange={setSort}
					digestOnly={digestOnly}
					onDigestToggle={() => setDigestOnly((prev) => !prev)}
				/>
			</div>

			{/* Pagination placeholder — no cursors in mock phase */}
			<ForumPagination prevCursor={null} nextCursor={null} />
		</div>
	);
}
