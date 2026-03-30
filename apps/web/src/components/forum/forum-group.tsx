// components/forum/forum-group.tsx — Forum group card with dense rows
// Ref: 04f §5 — Card/CardHeader/CardContent + divide-y row list

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ForumTreeNode } from "@ellie/types";
import { ForumCard } from "./forum-card";
import { SafeHtml } from "./safe-html";

interface ForumGroupProps {
	group: ForumTreeNode;
}

export function ForumGroup({ group }: ForumGroupProps) {
	return (
		<Card>
			<CardHeader className="pb-0">
				<CardTitle className="text-sm">{group.name}</CardTitle>
				{group.description && (
					<SafeHtml html={group.description} className="text-xs text-muted-foreground" as="p" />
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
