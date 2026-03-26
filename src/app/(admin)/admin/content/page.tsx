// Admin content moderation page — threads + posts with tab switch and forum filter
// Ref: 04c §内容审核 — threads/posts tab, filter by forum, delete
//
// Server component: reads tab/forumId from URL searchParams, fetches data.
// Filter controls and delete buttons are client components.

import { AdminContentActions } from "@/components/admin/admin-content-actions";
import { AdminContentFilters } from "@/components/admin/admin-content-filters";
import { createRepositories } from "@/data/index";
import type { ContentTab } from "@/viewmodels/admin/content-moderation";
import { fetchPosts, fetchThreads } from "@/viewmodels/admin/content-moderation";

interface PageProps {
	searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AdminContentPage({ searchParams }: PageProps) {
	const params = await searchParams;
	const repos = createRepositories();

	const tab: ContentTab = params.tab === "posts" ? "posts" : "threads";
	const forumId = params.forumId ? Number(params.forumId) : null;

	// Fetch forum list for the filter dropdown
	const allForums = await repos.forums.listAll();
	const forumOptions = allForums
		.filter((f) => f.type !== "group")
		.map((f) => ({ id: f.id, name: f.name }));

	// Fetch content based on active tab
	const result =
		tab === "posts" ? await fetchPosts(repos, forumId) : await fetchThreads(repos, forumId);

	return (
		<div className="space-y-6">
			<h2 className="text-2xl font-semibold">Content Moderation</h2>

			{/* Filters: tab switch + forum filter */}
			<AdminContentFilters tab={tab} forumId={params.forumId ?? ""} forums={forumOptions} />

			<div className="rounded-[14px] bg-card">
				<div className="overflow-x-auto">
					{tab === "threads" ? (
						<ThreadTable items={result.items as ThreadItem[]} />
					) : (
						<PostTable items={result.items as PostItem[]} />
					)}
				</div>
			</div>

			<p className="text-xs text-muted-foreground">
				Showing {result.items.length} of {result.total} {tab}
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Thread table
// ---------------------------------------------------------------------------

interface ThreadItem {
	id: number;
	subject: string;
	authorName: string;
	forumId: number;
	replies: number;
	createdAt: number;
}

function ThreadTable({ items }: { items: ThreadItem[] }) {
	return (
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
				{items.map((thread) => (
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
				{items.length === 0 && (
					<tr>
						<td colSpan={6} className="p-8 text-center text-muted-foreground">
							No threads found.
						</td>
					</tr>
				)}
			</tbody>
		</table>
	);
}

// ---------------------------------------------------------------------------
// Post table
// ---------------------------------------------------------------------------

interface PostItem {
	id: number;
	threadId: number;
	authorId: number;
	authorName: string;
	content: string;
	createdAt: number;
}

function PostTable({ items }: { items: PostItem[] }) {
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-b border-border text-left text-muted-foreground">
					<th className="p-4">Content</th>
					<th className="p-4">Author</th>
					<th className="p-4">Thread</th>
					<th className="p-4 text-right">Date</th>
					<th className="p-4 text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{items.map((post) => (
					<tr key={post.id} className="border-b border-border last:border-0">
						<td className="max-w-sm truncate p-4 font-medium">
							{post.content.length > 80 ? `${post.content.slice(0, 80)}...` : post.content}
						</td>
						<td className="p-4 text-muted-foreground">{post.authorName}</td>
						<td className="p-4 text-muted-foreground">#{post.threadId}</td>
						<td className="p-4 text-right text-muted-foreground">
							{new Date(post.createdAt * 1000).toLocaleDateString()}
						</td>
						<td className="p-4 text-right">
							<AdminContentActions type="post" id={post.id} />
						</td>
					</tr>
				))}
				{items.length === 0 && (
					<tr>
						<td colSpan={5} className="p-8 text-center text-muted-foreground">
							No posts found.
						</td>
					</tr>
				)}
			</tbody>
		</table>
	);
}
