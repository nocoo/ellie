// Admin content moderation page — thread list with delete actions
// Ref: 04c §内容审核 — threads/posts tab, filter by forum, delete
//
// Server component: fetches recent threads at request time.
// Delete buttons are client components that call admin API.

import { AdminContentActions } from "@/components/admin/admin-content-actions";
import { createRepositories } from "@/data/index";
import { fetchThreads } from "@/viewmodels/admin/content-moderation";

export default async function AdminContentPage() {
	const repos = createRepositories();
	const result = await fetchThreads(repos, null);

	return (
		<div className="space-y-6">
			<h2 className="text-2xl font-semibold">Content Moderation</h2>

			<div className="rounded-[14px] bg-card">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left text-muted-foreground">
								<th className="p-4">Subject</th>
								<th className="p-4">Author</th>
								<th className="p-4">Forum</th>
								<th className="p-4 text-right">Replies</th>
								<th className="p-4 text-right">Date</th>
								<th className="p-4 text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{result.items.map((thread) => (
								<tr key={thread.id} className="border-b border-border last:border-0">
									<td className="max-w-xs truncate p-4 font-medium">{thread.subject}</td>
									<td className="p-4 text-muted-foreground">{thread.authorName}</td>
									<td className="p-4 text-muted-foreground">#{thread.forumId}</td>
									<td className="p-4 text-right text-muted-foreground">{thread.replies}</td>
									<td className="p-4 text-right text-muted-foreground">
										{new Date(thread.createdAt * 1000).toLocaleDateString()}
									</td>
									<td className="p-4 text-right">
										<AdminContentActions type="thread" id={thread.id} />
									</td>
								</tr>
							))}
							{result.items.length === 0 && (
								<tr>
									<td colSpan={6} className="p-8 text-center text-muted-foreground">
										No threads found.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>

			<p className="text-xs text-muted-foreground">
				Showing {result.items.length} of {result.total} threads
			</p>
		</div>
	);
}
