// components/forum/forum-group.tsx — Forum group card with dense rows
// Ref: 04f §5 — Card/CardHeader/CardContent + divide-y row list

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ForumTreeNode } from "@ellie/types";
import { ForumCard } from "./forum-card";

interface ForumGroupProps {
	group: ForumTreeNode;
}

export function ForumGroup({ group }: ForumGroupProps) {
	return (
		<Card>
			<CardHeader className="pb-0">
				<CardTitle className="text-sm">{group.name}</CardTitle>
				{group.description && (
					<CardDescription className="text-xs">{group.description}</CardDescription>
				)}
			</CardHeader>
			<CardContent className="pt-0">
				<div className="divide-y divide-border/50">
					{group.children.map((forum) => (
						<ForumCard key={forum.id} forum={forum} />
					))}
				</div>
			</CardContent>
		</Card>
	);
}
