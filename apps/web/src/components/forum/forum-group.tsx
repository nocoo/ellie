"use client";

import type { ForumTreeNode } from "@ellie/types";
import { ChevronDown, Layers3 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GRID_THRESHOLD } from "@/viewmodels/forum/forum-list";
import { ForumPanel } from "./forum-panel";
import { SafeHtml } from "./safe-html";

export function ForumGroup({ group }: { group: ForumTreeNode }) {
	const layout = group.children.length > GRID_THRESHOLD ? "grid" : "wide";
	const [collapsed, setCollapsed] = useState(false);
	return (
		<Collapsible
			render={<section />}
			open={!collapsed}
			onOpenChange={(open) => setCollapsed(!open)}
			id={`forum-group-${group.id}`}
			className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card"
		>
			<div className="flex items-center gap-3 bg-muted/40 px-4 py-3">
				<Layers3 className="size-4 shrink-0 text-primary" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<h2 className="text-sm font-semibold">
						<Link
							prefetch={false}
							href={`/forums/${group.id}`}
							className="text-foreground hover:text-primary"
						>
							{group.name}
						</Link>
					</h2>
					{group.description && (
						<SafeHtml
							html={group.description}
							className="mt-0.5 line-clamp-2 text-xs text-muted-foreground"
						/>
					)}
				</div>
				{group.children.length > 0 && (
					<>
						<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
							{group.children.length} 个版块
						</span>
						<CollapsibleTrigger
							render={<Button variant="ghost" size="icon-sm" />}
							aria-label={`${collapsed ? "展开" : "收起"}${group.name}`}
						>
							<ChevronDown
								className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${collapsed ? "-rotate-90" : ""}`}
								aria-hidden="true"
							/>
						</CollapsibleTrigger>
					</>
				)}
			</div>
			<CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-200 ease-out data-starting-style:h-0 data-starting-style:opacity-0 data-ending-style:h-0 data-ending-style:opacity-0 motion-reduce:transition-none">
				<div className={group.children.length ? "border-t border-border" : undefined}>
					<ForumPanel forums={group.children} layout={layout} />
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
