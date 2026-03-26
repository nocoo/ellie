// components/forum/forum-group.tsx — Forum group in the forum list
// Ref: 04d §ForumGroup — Group title + forum cards

import type { ForumTreeNode } from "@ellie/types";
import { ForumCard } from "./forum-card";

export interface ForumGroupProps {
	group: ForumTreeNode;
}

export function ForumGroup({ group }: ForumGroupProps) {
	return (
		<section className="rounded-[14px] bg-card p-4">
			<h2 className="mb-3 text-lg font-semibold">{group.name}</h2>
			<div className="space-y-3">
				{group.children.map((forum) => (
					<ForumCard key={forum.id} forum={forum} />
				))}
			</div>
		</section>
	);
}
