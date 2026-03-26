// Admin forum management page — forum tree view with full actions
// Ref: 04c §版块管理 — tree view, edit name/description, hide/show, display order
//
// Server component: fetches forum tree at request time.
// Action buttons (edit/visibility/order) are client components.

import { AdminForumActions } from "@/components/admin/admin-forum-actions";
import { fetchForumTree } from "@/viewmodels/admin/forum-management";
import { createRepositories } from "@ellie/repositories";
import type { ForumTreeNode } from "@ellie/types";

export default async function AdminForumsPage() {
	const repos = createRepositories();
	const { tree } = await fetchForumTree(repos);

	return (
		<div className="space-y-6">
			<h2 className="text-2xl font-semibold">Forum Management</h2>

			{tree.length === 0 ? (
				<div className="rounded-[14px] bg-card p-8 text-center text-muted-foreground">
					No forums configured.
				</div>
			) : (
				<div className="space-y-4">
					{tree.map((category) => (
						<ForumCategory key={category.id} node={category} />
					))}
				</div>
			)}
		</div>
	);
}

/** Render a category group with its child forums */
function ForumCategory({ node }: { node: ForumTreeNode }) {
	return (
		<div className="rounded-[14px] bg-card">
			{/* Category header */}
			<div className="flex items-center justify-between border-b border-border p-4">
				<div className="min-w-0 flex-1">
					<h3 className="font-medium">{node.name}</h3>
					{node.description && (
						<p className="mt-0.5 text-sm text-muted-foreground">{node.description}</p>
					)}
				</div>
				<div className="ml-4 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
					<StatusBadge status={node.status} />
					<span>Order: {node.displayOrder}</span>
					<AdminForumActions
						forumId={node.id}
						status={node.status}
						name={node.name}
						description={node.description}
						displayOrder={node.displayOrder}
					/>
				</div>
			</div>

			{/* Child forums */}
			{node.children.length > 0 ? (
				<ul className="divide-y divide-border">
					{node.children.map((forum) => (
						<li key={forum.id} className="flex items-center justify-between p-4 pl-8">
							<div className="min-w-0 flex-1">
								<span className="text-sm font-medium">{forum.name}</span>
								{forum.description && (
									<p className="mt-0.5 text-xs text-muted-foreground">{forum.description}</p>
								)}
							</div>
							<div className="ml-4 flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
								<StatusBadge status={forum.status} />
								<span>{forum.threads} threads</span>
								<span>Order: {forum.displayOrder}</span>
								<AdminForumActions
									forumId={forum.id}
									status={forum.status}
									name={forum.name}
									description={forum.description}
									displayOrder={forum.displayOrder}
								/>
							</div>
						</li>
					))}
				</ul>
			) : (
				<p className="p-4 pl-8 text-sm text-muted-foreground">No child forums.</p>
			)}
		</div>
	);
}

/** Status badge: active/hidden */
function StatusBadge({ status }: { status: number }) {
	return status === 1 ? (
		<span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">
			Active
		</span>
	) : (
		<span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
			Hidden
		</span>
	);
}
