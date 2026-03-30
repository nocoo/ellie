"use client";

// components/forum/mod-action-bar.tsx — Moderator action bar placeholder
// All buttons are UI-only with console.log stubs

import { Button } from "@/components/ui/button";

const MOD_ACTIONS = [
	{ label: "置顶", action: "sticky" },
	{ label: "高亮", action: "highlight" },
	{ label: "精华", action: "digest" },
	{ label: "关闭", action: "close" },
	{ label: "移动", action: "move" },
	{ label: "删除", action: "delete" },
] as const;

export function ModActionBar() {
	return (
		<div className="flex items-center gap-1.5 border rounded-lg bg-muted/30 px-3 py-1.5 flex-wrap">
			<span className="text-xs text-muted-foreground mr-1">管理操作</span>
			{MOD_ACTIONS.map(({ label, action }) => (
				<Button
					key={action}
					variant="ghost"
					size="xs"
					onClick={() => console.log(`TODO: ${action}`)}
				>
					{label}
				</Button>
			))}
		</div>
	);
}
