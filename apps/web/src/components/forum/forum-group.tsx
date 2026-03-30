// components/forum/forum-group.tsx — Forum group card with adaptive layout
// ≤10 children → wide rows (divide-y), >10 children → 2-col grid

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ForumTreeNode } from "@ellie/types";
import { ForumCard } from "./forum-card";
import { SafeHtml } from "./safe-html";

/** Threshold: groups with more children than this use grid layout */
const GRID_THRESHOLD = 10;

interface ForumGroupProps {
	group: ForumTreeNode;
}

export function ForumGroup({ group }: ForumGroupProps) {
	const useGrid = group.children.length > GRID_THRESHOLD;

	return (
		<Card>
			<CardHeader className="pb-0">
				<CardTitle className="text-sm">{group.name}</CardTitle>
				{group.description && (
					<SafeHtml html={group.description} className="text-xs text-muted-foreground" as="p" />
				)}
			</CardHeader>
			<CardContent className="pt-0">
				{useGrid ? (
					<div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:gap-x-px sm:border-t border-border/50 [&>*:nth-child(-n+2)]:sm:border-t-0 [&>*]:sm:border-b [&>*]:sm:border-border/50">
						{group.children.map((forum) => (
							<ForumCard key={forum.id} forum={forum} layout="grid" />
						))}
					</div>
				) : (
					<div className="divide-y divide-border/50">
						{group.children.map((forum) => (
							<ForumCard key={forum.id} forum={forum} layout="wide" />
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
