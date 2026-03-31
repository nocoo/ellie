// components/forum/forum-panel.tsx — Unified forum list panel (server component)
// Renders ForumTreeNode[] in two modes:
// - "wide": full-width rows with dashed dividers
// - "grid": 2-col grid with dashed borders (includes odd-count placeholder)
// - "auto": wide if ≤10 forums, grid if >10

import type { ForumTreeNode } from "@ellie/types";
import { ForumCard } from "./forum-card";

interface ForumPanelProps {
	forums: ForumTreeNode[];
	layout?: "auto" | "wide" | "grid";
}

/** Threshold: more children than this use grid layout (matches ForumGroup) */
const GRID_THRESHOLD = 10;

export function ForumPanel({ forums, layout = "auto" }: ForumPanelProps) {
	const resolved = layout === "auto" ? (forums.length <= GRID_THRESHOLD ? "wide" : "grid") : layout;

	if (resolved === "wide") {
		return (
			<div className="divide-y divide-dashed divide-border">
				{forums.map((forum) => (
					<ForumCard key={forum.id} forum={forum} layout="wide" />
				))}
			</div>
		);
	}

	// Grid layout — 2 columns on sm+, 1 column on mobile
	const isOdd = forums.length % 2 === 1;

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2">
			{forums.map((forum, i) => (
				<div
					key={forum.id}
					className={`${i > 1 ? "border-t border-dashed border-border" : ""} ${i % 2 === 1 ? "sm:border-l sm:border-dashed sm:border-border" : ""} ${i === 1 ? "max-sm:border-t max-sm:border-dashed max-sm:border-border" : ""}`}
				>
					<ForumCard forum={forum} layout="grid" />
				</div>
			))}
			{/* Placeholder cell for odd count — completes grid border lines */}
			{isOdd && (
				<div className="hidden sm:block border-t border-dashed border-border sm:border-l sm:border-dashed sm:border-border" />
			)}
		</div>
	);
}
