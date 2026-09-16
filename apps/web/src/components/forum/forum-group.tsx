"use client";

import type { ForumTreeNode } from "@ellie/types";
import { ChevronDown, Layers3 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { GRID_THRESHOLD } from "@/viewmodels/forum/forum-list";
import { ForumPanel } from "./forum-panel";
import { SafeHtml } from "./safe-html";

export function ForumGroup({ group }: { group: ForumTreeNode }) {
	const layout = group.children.length > GRID_THRESHOLD ? "grid" : "wide";
	const [collapsed, setCollapsed] = useState(false);
	const panelId = useId();
	return (
		<section
			id={`forum-group-${group.id}`}
			className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card"
		>
			<div className="flex items-center gap-3 bg-muted/40 px-4 py-3">
				<Layers3 className="size-4 shrink-0 text-primary" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<h2 className="text-sm font-semibold">
						<Link href={`/forums/${group.id}`} className="text-foreground hover:text-primary">
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
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`${collapsed ? "展开" : "收起"}${group.name}`}
							aria-expanded={!collapsed}
							aria-controls={panelId}
							onClick={() => setCollapsed(!collapsed)}
						>
							<ChevronDown
								className={`size-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
								aria-hidden="true"
							/>
						</Button>
					</>
				)}
			</div>
			<div
				id={panelId}
				hidden={collapsed}
				className={group.children.length ? "border-t border-border" : undefined}
			>
				<ForumPanel forums={group.children} layout={layout} />
			</div>
		</section>
	);
}
