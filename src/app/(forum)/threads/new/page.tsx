// (forum)/threads/new/page.tsx — New thread page
// Ref: 04d §发帖流程 — subject + content + forum selection

"use client";

import { PostEditor } from "@/components/forum/post-editor";
import { useSearchParams } from "next/navigation";

/**
 * New thread creation page.
 * Accepts ?forumId= search param for pre-selecting forum.
 *
 * Phase 2: Will check auth and redirect to /login if not logged in.
 */
export default function NewThreadPage() {
	const searchParams = useSearchParams();
	const forumId = Number(searchParams.get("forumId") ?? 0);

	return (
		<div className="space-y-4">
			<div className="rounded-[14px] bg-card p-6">
				<h1 className="text-2xl font-bold">New Thread</h1>
				{forumId > 0 && (
					<p className="mt-1 text-sm text-muted-foreground">Posting in Forum #{forumId}</p>
				)}
			</div>

			<div className="rounded-[14px] bg-card p-6">
				<PostEditor
					mode="thread"
					onSubmit={(data) => {
						// Phase 2: Call submitPost() and redirect
						console.log("Submit:", { forumId, ...data });
					}}
				/>
			</div>
		</div>
	);
}
