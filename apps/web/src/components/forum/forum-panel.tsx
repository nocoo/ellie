import type { ForumTreeNode } from "@ellie/types";
import { GRID_THRESHOLD } from "@/viewmodels/forum/forum-list";
import { ForumCard } from "./forum-card";

export function ForumPanel({
	forums,
	layout = "auto",
}: {
	forums: ForumTreeNode[];
	layout?: "auto" | "wide" | "grid";
}) {
	const grid = layout === "grid" || (layout === "auto" && forums.length > GRID_THRESHOLD);
	if (!grid)
		return (
			<div className="divide-y divide-border/70">
				{forums.map((forum) => (
					<ForumCard key={forum.id} forum={forum} layout="wide" />
				))}
			</div>
		);
	return (
		<div className="grid grid-cols-1 gap-px bg-border/70 sm:grid-cols-2">
			{forums.map((forum, index) => (
				<div
					key={forum.id}
					className={`min-w-0 bg-card ${index === forums.length - 1 && forums.length % 2 ? "sm:col-span-2" : ""}`}
				>
					<ForumCard forum={forum} layout="grid" />
				</div>
			))}
		</div>
	);
}
