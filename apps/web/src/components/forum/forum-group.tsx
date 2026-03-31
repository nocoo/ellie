// components/forum/forum-group.tsx — Forum group card with adaptive layout
// Classic style: solid border, dashed row dividers, gradient header bar
// ≤10 children → wide rows, >10 children → 2-col grid

"use client";

import type { ForumTreeNode } from "@ellie/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { ForumCard } from "./forum-card";
import { SafeHtml } from "./safe-html";

/** Threshold: groups with more children than this use grid layout */
const GRID_THRESHOLD = 10;

interface ForumGroupProps {
	group: ForumTreeNode;
}

export function ForumGroup({ group }: ForumGroupProps) {
	const useGrid = group.children.length > GRID_THRESHOLD;
	const [collapsed, setCollapsed] = useState(false);

	return (
		<div className="overflow-hidden rounded-sm border border-[#CFCFCF] bg-white">
			{/* Group header — gradient bar matching classic Discuz style */}
			<button
				type="button"
				onClick={() => setCollapsed((prev) => !prev)}
				className="flex w-full items-center gap-2 border-b border-[#CFCFCF] bg-gradient-to-r from-[#E8EEF2] to-[#F6F7F8] px-4 py-2 text-left cursor-pointer"
			>
				<h2 className="text-sm font-semibold text-[#2E6B9A]">{group.name}</h2>
				{group.description && <SafeHtml html={group.description} className="text-xs text-[#999]" />}
				{collapsed ? (
					<ChevronRight className="ml-auto h-4 w-4 text-[#AAA] shrink-0" />
				) : (
					<ChevronDown className="ml-auto h-4 w-4 text-[#AAA] shrink-0" />
				)}
			</button>

			{/* Forum list — collapsible */}
			{!collapsed &&
				(useGrid ? (
					<div className="grid grid-cols-1 sm:grid-cols-2">
						{group.children.map((forum, i) => (
							<div
								key={forum.id}
								className={`${i > 1 ? "border-t border-dashed border-[#DDD]" : ""} ${i % 2 === 1 ? "sm:border-l sm:border-dashed sm:border-[#DDD]" : ""} ${i === 1 ? "max-sm:border-t max-sm:border-dashed max-sm:border-[#DDD]" : ""}`}
							>
								<ForumCard forum={forum} layout="grid" />
							</div>
						))}
					</div>
				) : (
					<div className="divide-y divide-dashed divide-[#DDD]">
						{group.children.map((forum) => (
							<ForumCard key={forum.id} forum={forum} layout="wide" />
						))}
					</div>
				))}
		</div>
	);
}
