// components/forum/forum-group.tsx — Forum group section
// Ref: 04d §ForumGroup — Group title + child ForumCard list

import type { ForumTreeNode } from "@ellie/types";
import { ForumCard } from "./forum-card";

interface ForumGroupProps {
	group: ForumTreeNode;
}

export function ForumGroup({ group }: ForumGroupProps) {
	return (
		<section className="rounded-[14px] bg-card p-6">
			<h2 className="text-base font-semibold text-foreground">{group.name}</h2>
			{group.description && (
				<p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
			)}
			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{group.children.map((forum) => (
					<ForumCard key={forum.id} forum={forum} />
				))}
			</div>
		</section>
	);
}
