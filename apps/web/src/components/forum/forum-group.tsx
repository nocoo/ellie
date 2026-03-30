// components/forum/forum-group.tsx — Forum group card with adaptive layout
// Classic style: solid border, dashed row dividers, tinted header bar
// ≤10 children → wide rows, >10 children → 2-col grid

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
		<div className="overflow-hidden rounded-md border border-border bg-card">
			{/* Group header — tinted bar */}
			<div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2">
				<h2 className="text-sm font-semibold text-primary">{group.name}</h2>
				{group.description && (
					<SafeHtml html={group.description} className="text-xs text-muted-foreground" />
				)}
			</div>

			{/* Forum list */}
			{useGrid ? (
				<div className="grid grid-cols-1 sm:grid-cols-2">
					{group.children.map((forum, i) => (
						<div
							key={forum.id}
							className={`${i > 1 ? "border-t border-dashed border-border/60" : ""} ${i % 2 === 1 ? "sm:border-l sm:border-dashed sm:border-border/60" : ""} ${i === 1 ? "max-sm:border-t max-sm:border-dashed max-sm:border-border/60" : ""}`}
						>
							<ForumCard forum={forum} layout="grid" />
						</div>
					))}
				</div>
			) : (
				<div className="divide-y divide-dashed divide-border/60">
					{group.children.map((forum) => (
						<ForumCard key={forum.id} forum={forum} layout="wide" />
					))}
				</div>
			)}
		</div>
	);
}
