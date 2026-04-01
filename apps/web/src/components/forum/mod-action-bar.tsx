"use client";

// components/forum/mod-action-bar.tsx — Moderator action bar for thread management
// Appears at the bottom of the first post for moderators/admins.
// All buttons are UI-only with console.log stubs (API integration pending).

import { Button } from "@/components/ui/button";

const MOD_ACTIONS = [
	{ label: "置顶", action: "sticky" },
	{ label: "高亮", action: "highlight" },
	{ label: "精华", action: "digest" },
	{ label: "关闭", action: "close" },
	{ label: "移动", action: "move" },
	{ label: "删除", action: "delete" },
] as const;

interface ModActionBarProps {
	forumId: number;
	threadId: number;
}

export function ModActionBar({ forumId, threadId }: ModActionBarProps) {
	return (
		<div className="flex items-center gap-1.5 border-t border-dashed border-border bg-muted/30 px-3 py-1.5 flex-wrap">
			<span className="text-xs text-muted-foreground mr-1">管理操作</span>
			{MOD_ACTIONS.map(({ label, action }) => (
				<Button
					key={action}
					variant="ghost"
					size="xs"
					onClick={() => console.log(`TODO: ${action}`, { forumId, threadId })}
				>
					{label}
				</Button>
			))}
		</div>
	);
}
