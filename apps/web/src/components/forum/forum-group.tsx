// components/forum/forum-group.tsx — Forum group card with adaptive layout
// Classic style: solid border, dashed row dividers, gradient header bar
// ≤10 children → wide rows, >10 children → 2-col grid

"use client";

import type { ForumTreeNode } from "@ellie/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { GRID_THRESHOLD } from "@/viewmodels/forum/forum-list";
import { ForumPanel } from "./forum-panel";
import { SafeHtml } from "./safe-html";

interface ForumGroupProps {
	group: ForumTreeNode;
}

export function ForumGroup({ group }: ForumGroupProps) {
	const layout = group.children.length > GRID_THRESHOLD ? "grid" : "wide";
	const [collapsed, setCollapsed] = useState(false);

	return (
		<div className="overflow-hidden rounded-sm border border-border bg-card">
			{/* Group header — gradient bar matching classic Discuz style */}
			<button
				type="button"
				onClick={() => setCollapsed((prev) => !prev)}
				className="flex w-full items-center gap-2 border-b border-border bg-gradient-to-r from-forum-header-from to-forum-header-to px-4 py-2 text-left cursor-pointer"
			>
				<h2 className="text-sm font-semibold text-forum-link">
					<Link
						href={`/forums/${group.id}`}
						onClick={(e) => e.stopPropagation()}
						className="hover:underline"
					>
						{group.name}
					</Link>
				</h2>
				{group.description && (
					<SafeHtml html={group.description} className="text-xs text-forum-text-muted" />
				)}
				{collapsed ? (
					<ChevronRight className="ml-auto h-4 w-4 text-forum-text-muted shrink-0" />
				) : (
					<ChevronDown className="ml-auto h-4 w-4 text-forum-text-muted shrink-0" />
				)}
			</button>

			{/* Forum list — collapsible, delegated to ForumPanel */}
			{!collapsed && <ForumPanel forums={group.children} layout={layout} />}
		</div>
	);
}
